package com.example.game.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.util.Log

/**
 * The audio bank and player.
 *
 * Every clip is named here once, and the name is the whole contract: the id below is what
 * the game asks for, the file beside it is what has to exist, and the web engine declares
 * the same ids against the same filenames so one script can check that both platforms are
 * asking for the same audio. Nothing is discovered by scanning a directory, because a
 * missing file that nobody mentioned is invisible, and a file nobody plays is just as broken
 * -- a fixed table makes both show up in [inventory]'s missing and unplayed lists.
 *
 * Nothing here is required. No clip exists yet, so [loadAll] reports every id as missing and
 * the game runs exactly as it did before this file: silent, and with nothing in the log but
 * one warning per file. That is the state this system is built for, not a fallback bolted on
 * afterwards.
 *
 * Two players, because the two kinds of sound want opposite things. Short effects go through
 * a [SoundPool], which preloads and decodes once and can then overlap a hundred copies from
 * memory without touching the disk. Anything long goes through a [MediaPlayer] per clip,
 * because a looping pool entry cannot be faded, restarted mid-bar, or stopped and resumed
 * without the gap that a MediaPlayer handles as the ordinary case.
 *
 * Mirrors AudioSystem.ts.
 */

/** Which mixer a clip belongs to, and therefore what it obeys. */
enum class AudioCategory {
    MUSIC,
    AMBIENCE,
    SFX,
}

data class AudioClip(
    /** What the game asks for. Stable, and shared with the web engine. */
    val id: String,
    val category: AudioCategory,
    /** Path under the audio root. The same string on both platforms. */
    val file: String,
    /** Looping clips are held open and stopped explicitly; one-shots are fire and forget. */
    val loop: Boolean,
    /** Per-clip trim, before the category's own volume. */
    val volume: Float,
    /**
     * The shortest gap before this clip may play again, in seconds.
     *
     * Held-input attacks and a walk cycle both fire far faster than a sound should repeat, and
     * without this they stack into a buzz louder than the music they sit under.
     */
    val minInterval: Float = 0f,
)

/**
 * The folder every path below is relative to, and the root the web engine resolves against.
 *
 * `audio/` rather than `audio/music` etc. as the root, so a clip's `file` reads the same in
 * both trees and can be compared as a string.
 */
const val AUDIO_ROOT = "audio"

private fun clip(
    id: String,
    category: AudioCategory,
    file: String,
    loop: Boolean = false,
    volume: Float = 1f,
    minInterval: Float = 0f,
) = AudioClip(id, category, "$AUDIO_ROOT/$file", loop, volume, minInterval)

/**
 * Every clip the game knows about.
 *
 * Grouped by mixer in the order the folders are named, because that grouping is the only
 * thing that decides whether a clip loops, how loud it is allowed to be, and whether a volume
 * change reaches it. Anything added here also has to be added to `AUDIO_CLIPS` in
 * AudioSystem.ts, which verify-audio.mjs checks by comparing the two tables.
 */
val AUDIO_CLIPS: List<AudioClip> = listOf(
    clip("main_menu_music", AudioCategory.MUSIC, "music/main_menu_music.ogg", loop = true, volume = 0.5f),
    clip("main_menu_ambience", AudioCategory.AMBIENCE, "ambience/main_menu_ambience.ogg", loop = true, volume = 0.45f),
    clip("campfire", AudioCategory.AMBIENCE, "ambience/campfire.ogg", loop = true, volume = 0.4f),
    clip("sword_attack", AudioCategory.SFX, "sfx/sword_attack.ogg", minInterval = 0.08f),
    clip("heavy_attack", AudioCategory.SFX, "sfx/heavy_attack.ogg", minInterval = 0.15f),
    clip("sword_hit", AudioCategory.SFX, "sfx/sword_hit.ogg", minInterval = 0.05f),
    clip("footsteps_stone", AudioCategory.SFX, "sfx/footsteps_stone.ogg", minInterval = 0.12f),
    clip("jump", AudioCategory.SFX, "sfx/jump.ogg"),
    clip("dash", AudioCategory.SFX, "sfx/dash.ogg", minInterval = 0.1f),
    clip("block", AudioCategory.SFX, "sfx/block.ogg", minInterval = 0.1f),
    clip("hurt", AudioCategory.SFX, "sfx/hurt.ogg", minInterval = 0.15f),
    clip("death", AudioCategory.SFX, "sfx/death.ogg"),
)

/** The ids that play over the main menu, started when the menu appears. */
const val MAIN_MENU_MUSIC = "main_menu_music"
const val MAIN_MENU_AMBIENCE = "main_menu_ambience"

/**
 * The fire's own crackle.
 *
 * Started with the menu rather than by a world object: the loop lives where the visible fire
 * is, and there is no campfire entity in the game yet. When one exists this becomes its loop
 * instead, at the same id and the same path, so nothing else has to change.
 */
const val CAMPFIRE = "campfire"

/** What [AudioEngine.loadAll] found, so the settings screen and the verifier can report it. */
data class AudioInventory(
    /** Ids whose file loaded. */
    val loaded: List<String>,
    /** Ids whose file is absent or unusable. The expected state until assets are added. */
    val missing: List<String>,
    /** Ids present but never asked to play, which is a bug rather than a gap. */
    val unplayed: List<String>,
)

/**
 * Plays the bank, or does nothing at all.
 *
 * Every entry point is safe to call at any time, in any state. That is not defensiveness for
 * its own sake: the assets may never arrive, a file may be present but undecodable, and a
 * cue may be asked for while the engine is suspended. None of those are exceptional, and none
 * of them may reach the game's frame loop as a throw.
 *
 * Not thread safe by design, and does not need to be: it is constructed in the composition
 * and called from the main thread, which is where Compose frames and input both already are.
 * Loading is deferred to the first call rather than done in a constructor, because a
 * constructor cannot report failure and this system must never fail at construction time.
 */
class AudioEngine(private val context: Context) {
    private val byId = AUDIO_CLIPS.associateBy { it.id }

    /** Sound ids for the clips that decoded, keyed by clip id. */
    private val loadedSfx = mutableMapOf<String, Int>()

    /** Ids of clips that are currently looping. */
    private val loops = mutableMapOf<String, MediaPlayer>()

    private val missing = mutableSetOf<String>()
    private val played = mutableSetOf<String>()
    private val lastPlayed = mutableMapOf<String, Long>()

    private var musicEnabled = true
    private var sfxEnabled = true
    private var suspended = false

    /** Built on first use. A SoundPool costs a native pool, so it is not paid for up front. */
    private var pool: SoundPool? = null

    /**
     * Loads every clip that exists.
     *
     * A missing file is the normal case and is logged once, not thrown: this is called while
     * the game is starting and starting the game is not conditional on optional audio. A file
     * that exists but cannot be loaded is recorded exactly as if it were absent, because from
     * the game's point of view the two are the same thing.
     *
     * Safe to call again after files are added without restarting; clips already loaded are
     * kept, and anything newly present is picked up.
     */
    fun loadAll(): AudioInventory {
        ensurePool()
        for (entry in AUDIO_CLIPS) {
            if (entry.category != AudioCategory.SFX) continue
            if (loadedSfx.containsKey(entry.id)) continue
            val exists = runCatching {
                context.assets.open(entry.file).close()
            }.isSuccess
            if (!exists) {
                if (!missing.contains(entry.id)) {
                    missing.add(entry.id)
                    Log.w(TAG, "no audio for '${entry.id}' at ${entry.file}; that sound stays silent")
                }
                continue
            }
            val id = pool?.load(entry.file, 1)
            if (id == null || id == 0) {
                missing.add(entry.id)
                Log.w(TAG, "could not load ${entry.file} into the sound pool")
            } else {
                loadedSfx[entry.id] = id
                missing.remove(entry.id)
            }
        }
        return inventory()
    }

    /** What was found. The honest state of the bank, for the settings screen and for tests. */
    fun inventory(): AudioInventory {
        val looping = loops.keys
        val loaded = AUDIO_CLIPS.filter { it.category == AudioCategory.SFX && loadedSfx.containsKey(it.id) }
            .map { it.id } + AUDIO_CLIPS.filter { it.loop && looping.contains(it.id) }.map { it.id }
        val missing = AUDIO_CLIPS.filter { it.id !in loaded }.map { it.id }
        return AudioInventory(
            loaded = loaded.distinct(),
            missing = missing,
            unplayed = loaded.distinct().filter { it !in played },
        )
    }

    /** True when the named clip loaded and can be played. */
    fun has(id: String): Boolean = byId.containsKey(id)

    /**
     * Plays a one-shot.
     *
     * Returns whether it actually sounded, which is what makes this testable: with no assets
     * every call is a no-op that reports false rather than throwing, so the caller can tell
     * the difference between "the sound played" and "there was no sound".
     */
    fun play(id: String): Boolean {
        val entry = byId[id] ?: return false
        if (entry.loop || entry.category != AudioCategory.SFX) return false
        if (!sfxEnabled || suspended) return false
        val soundId = loadedSfx[id] ?: return false

        val now = System.currentTimeMillis()
        val last = lastPlayed[id]
        if (last != null && entry.minInterval > 0f && (now - last) < entry.minInterval * 1000f) return false
        lastPlayed[id] = now

        val volume = (entry.volume * sfxVolume).coerceIn(0f, 1f)
        pool?.play(soundId, volume, volume, 1, 0, 1f)
        played.add(id)
        return true
    }

    /**
     * Starts a looping clip, or does nothing if it is already playing.
     *
     * Restarting a loop in progress is not idempotent -- two copies a fraction of a second
     * apart beat against each other -- so this is a no-op when the id is already sounding.
     */
    fun start(id: String): Boolean {
        val entry = byId[id] ?: return false
        if (!entry.loop || entry.category == AudioCategory.SFX) return false
        if (entry.category == AudioCategory.MUSIC && !musicEnabled) return false
        if (suspended) return false
        if (loops.containsKey(id)) return true
        if (!fileExists(entry.file)) {
            if (!missing.contains(id)) {
                missing.add(id)
                Log.w(TAG, "no audio for '$id' at ${entry.file}; that cue stays silent")
            }
            return false
        }
        val player = MediaPlayer()
        return try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            // DataSource overload, so a missing or unreadable file throws here rather than
            // returning a player that fails later at the worst possible moment.
            player.setDataSource(context.assets.openFd(entry.file).fileDescriptor)
            player.isLooping = true
            player.setVolume(musicVolume * entry.volume, musicVolume * entry.volume)
            player.setOnCompletionListener { loops.remove(id) }
            player.prepare()
            player.start()
            loops[id] = player
            played.add(id)
            missing.remove(id)
            true
        } catch (err: Exception) {
            Log.w(TAG, "could not start ${entry.file}", err)
            missing.add(id)
            player.release()
            false
        }
    }

    /** Stops one looping clip, or every looping clip when called with no id. */
    fun stop(id: String? = null) {
        val targets = if (id != null) listOf(id) else loops.keys.toList()
        for (target in targets) {
            val player = loops.remove(target) ?: continue
            try {
                if (player.isPlaying) player.stop()
            } catch (_: IllegalStateException) {
                // Already stopped. Releasing below is still correct.
            }
            player.release()
        }
    }

    /** Ids currently looping. Used by the verifier to assert a cue stops when it should. */
    fun playing(): List<String> = loops.keys.toList()

    fun setMusicEnabled(on: Boolean) {
        musicEnabled = on
        if (!on) stop()
        applyVolumes()
    }

    fun setSfxEnabled(on: Boolean) {
        sfxEnabled = on
    }

    fun isMusicEnabled(): Boolean = musicEnabled

    fun isSfxEnabled(): Boolean = sfxEnabled

    /**
     * Silences the bank without tearing it down.
     *
     * Used for a hidden activity and for the moment before the game starts. A cue asked for
     * while suspended is dropped rather than queued, so coming back to the tab does not
     * ambush the player with a burst of sound that happened while they were away.
     */
    fun suspend() {
        suspended = true
        stop()
    }

    fun resume() {
        suspended = false
    }

    fun isSuspended(): Boolean = suspended

    /** The music/ambience bus, separate from effects so a mute can leave the fire audible. */
    var musicVolume: Float = 1f
        set(value) {
            field = value.coerceIn(0f, 1f)
            applyVolumes()
        }

    var sfxVolume: Float = 1f
        set(value) {
            field = value.coerceIn(0f, 1f)
        }

    /** Releases the native players. Safe to call more than once. */
    fun dispose() {
        stop()
        loadedSfx.clear()
        pool?.release()
        pool = null
    }

    private fun applyVolumes() {
        for ((id, player) in loops) {
            val entry = byId[id] ?: continue
            val volume = (musicVolume * entry.volume).coerceIn(0f, 1f)
            try {
                player.setVolume(volume, volume)
            } catch (_: IllegalStateException) {
                // The player was released underneath us; stop() will finish tidying.
            }
        }
    }

    private fun fileExists(file: String): Boolean =
        runCatching { context.assets.open(file).close() }.isSuccess

    private fun ensurePool() {
        if (pool != null) return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        pool = SoundPool.Builder()
            .setMaxStreams(MAX_STREAMS)
            .setAudioAttributes(attributes)
            .build()
    }

    private companion object {
        const val TAG = "AudioEngine"

        /**
         * Enough streams to overlap a swing, a hit and a footstep without cutting any of them
         * off. Effects are short and mostly silent by the end, so this is generous rather than
         * tuned; the [AudioClip.minInterval] caps do the real limiting.
         */
        const val MAX_STREAMS = 8
    }
}