package com.example.game.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlin.random.Random

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
    /**
     * For a clip that plays intermittently rather than looping: the seconds range between
     * repeats, picked at random each time. Null means the clip does not repeat itself.
     *
     * This is what separates the two ambience clips. The fire is a bed and loops; the menu
     * ambience is a mood that arrives and leaves, and a bed under a title screen stops being
     * noticed within about half a minute, which is the opposite of what it is for.
     */
    val every: Pair<Float, Float>? = null,
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
    every: Pair<Float, Float>? = null,
) = AudioClip(id, category, "$AUDIO_ROOT/$file", loop, volume, minInterval, every)

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
    // Not a bed. `loop = false` with an `every` range means this plays as occasional one-shots
    // at random moments rather than running under the menu forever.
    clip(
        "main_menu_ambience", AudioCategory.AMBIENCE, "ambience/main_menu_ambience.ogg",
        volume = 0.45f, every = 9f to 26f,
    ),
    // The fire is the opposite: a continuous bed, because a fire does not stop and start.
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

    /** Where the repeating clips' delays are scheduled. Created lazily, see [handler]. */
    private var handlerOrNull: Handler? = null

    /**
     * Injected rather than calling [Random] inline so a test can hand in a fixed sequence and
     * assert the exact schedule. Defaulting to the real thing keeps production unchanged.
     */
    var random: () -> Float = { Random.nextFloat() }

    /** Sound ids for the clips that decoded, keyed by clip id. */
    private val loadedSfx = mutableMapOf<String, Int>()

    /** Ids of clips that are currently looping. */
    private val loops = mutableMapOf<String, MediaPlayer>()

    private val missing = mutableSetOf<String>()
    private val played = mutableSetOf<String>()
    private val lastPlayed = mutableMapOf<String, Long>()

    /**
     * Timers for the clips that repeat themselves, one runnable per clip.
     *
     * A [Handler] on the main looper rather than a background thread: the delay is tens of
     * seconds, so there is nothing to gain from waking a worker, and a one-shot `MediaPlayer`
     * has to be driven from the thread the engine was built on anyway.
     */
    private val repeating = mutableMapOf<String, Runnable>()

    /**
     * The main-looper handler, created on first use.
     *
     * Lazy because a `Handler` needs a looper that is prepared, and constructing the engine
     * during composition must never fail. Returning null rather than throwing is what lets
     * that promise hold.
     */
    private fun handler(): Handler? {
        handlerOrNull?.let { return it }
        if (Looper.myLooper() == null) return null
        return Handler(Looper.getMainLooper()).also { handlerOrNull = it }
    }

    /**
     * Clips something has asked for that are not running yet -- their file had not decoded,
     * or they are parked behind a mute. Survives a mute so unmuting can bring them back.
     */
    private val wanted = mutableSetOf<String>()

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
        if (entry.loop || entry.category == AudioCategory.MUSIC) return false
        val isRepeating = entry.every != null && entry.category == AudioCategory.AMBIENCE
        if (!isRepeating && entry.category != AudioCategory.SFX) return false
        if (!sfxEnabled) return false
        if (suspended) return false
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
     * Starts a music or ambience clip, looping or not.
     *
     * Restarting a loop in progress is not idempotent -- two copies a fraction of a second
     * apart beat against each other -- so this is a no-op when the id is already sounding.
     *
     * A looping clip opens a player and holds it. A clip with an `every` range is scheduled
     * instead: it fires once as a one-shot and rearms itself, which is what makes the menu
     * ambience arrive and leave rather than sitting under the title forever.
     */
    fun start(id: String): Boolean {
        val entry = byId[id] ?: return false
        if (entry.category == AudioCategory.SFX) return false
        if (entry.every != null && !entry.loop) return scheduleRepeating(id)
        if (!entry.loop) return false
        // A loop for a muted category is not opened at all, which is what stops the fire
        // being started behind an FX switch that is off. The intent is still recorded, so
        // unmuting can open it: a menu entered with FX already off has to get its fire when
        // the player switches FX on, not stay silent until they leave and come back.
        //
        // A clip muted *later* is a different path -- the player is already open and
        // [applyVolumes] takes it to zero, so unmuting brings the same player back rather
        // than restarting the clip from the top.
        if (mutedFor(entry)) {
            wanted.add(id)
            return false
        }
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

    /**
     * Whether a clip's category is currently muted.
     *
     * Ambience answers to the FX switch and music to the music switch, so the two toggles are
     * not two halves of one "sound" setting: turning music off leaves the fire burning, and
     * turning FX off leaves the music playing.
     */
    private fun mutedFor(entry: AudioClip): Boolean =
        if (entry.category == AudioCategory.MUSIC) !musicEnabled else !sfxEnabled

    /**
     * Arms a repeating clip, and rearms it after each firing.
     *
     * The gap is drawn from the clip's range rather than fixed, because a fixed gap is audible
     * as a pulse: the player settles into the rhythm and stops hearing the sound as an event.
     * The first play is immediate rather than delayed, so opening the menu has its ambience
     * with it instead of starting in silence.
     */
    private fun scheduleRepeating(id: String): Boolean {
        val entry = byId[id] ?: return false
        if (entry.every == null) return false
        // Recorded for the same reason as a muted loop: FX off, then on, must bring the
        // ambience back rather than losing it for the rest of the visit.
        if (!sfxEnabled) {
            wanted.add(id)
            return false
        }
        if (suspended) return false
        if (repeating.containsKey(id)) return true
        val h = handler() ?: return false
        // Immediate first firing, then the random gaps. Posting rather than playing inline so
        // the runnable is already in the map when it runs -- otherwise a stop() between the
        // two would leave a clip that could never be cancelled.
        val fire = Runnable { fire(id, entry) }
        repeating[id] = fire
        h.post(fire)
        return true
    }

    /**
     * Fires a repeating clip once and rearms it.
     *
     * The runnable is dropped before playing so a `stop()` inside the play path -- or a clip
     * that has since been stopped -- cannot be undone by the rearm that follows.
     */
    private fun fire(id: String, entry: AudioClip) {
        repeating.remove(id)
        play(id)
        if (wanted.contains(id)) arm(id, entry)
    }

    /** Schedules the next firing of a repeating clip that is still wanted. */
    private fun arm(id: String, entry: AudioClip) {
        val h = handler() ?: return
        val (lo, hi) = entry.every ?: return
        val wait = lo + random() * maxOf(0f, hi - lo)
        val next = Runnable { fire(id, entry) }
        repeating[id] = next
        h.postDelayed(next, (wait * 1000f).toLong())
    }

    /** Repeating clips currently scheduled. Exposed so the harness can assert on them. */
    fun repeatingIds(): List<String> = repeating.keys.toList()

    /**
     * Stops one clip, or everything.
     *
     * Cancels repeating clips' timers as well as their players, and forgets the intent either
     * way. Forgetting it matters most for a repeating clip: a menu ambience left wanted after
     * the menu is torn down would keep firing one-shots at a screen nobody is on.
     *
     * The intent is forgotten *before* the timers are walked, not inside that walk. Clearing
     * it per-timer meant a `stop()` over an empty [repeating] map forgot nothing at all, which
     * is exactly the state the menu is torn down in whenever its ambience had already come and
     * gone -- a title screen the player sat on past the first firing. The title cues stayed
     * wanted, and the next thing that consults `wanted` (a category being unmuted, or a resume)
     * started the menu music and the campfire under the first walk of the game.
     */
    fun stop(id: String? = null) {
        val h = handler()
        if (id != null) wanted.remove(id) else wanted.clear()
        for ((key, runnable) in repeating.toList()) {
            if (id != null && key != id) continue
            h?.removeCallbacks(runnable)
            repeating.remove(key)
        }

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

    /**
     * Turns the music mixer on or off, which is the menu music and nothing else.
     *
     * The volume alone is enough for the looping clips, and doing it that way rather than
     * stopping the players is the whole point: `stop()` takes every loop with it, the fire
     * included, so muting music used to silence the campfire as well and leave both silent for
     * good. Taking the volume to zero mutes what is already playing and unmuting brings the
     * very same players back, still in phase.
     *
     * The fire and the menu ambience are not touched here. They belong to the FX switch, which
     * is what a player reaches for when they want a silent campfire.
     */
    fun setMusicEnabled(on: Boolean) {
        musicEnabled = on
        applyVolumes()
        if (on && !suspended) {
            // A menu entered with music already off has to pick its music up when the player
            // switches it on.
            for (id in wanted.toList()) start(id)
        }
    }

    /**
     * Turns the effects on or off: sound effects and the ambience bed together.
     *
     * The repeating clips are the awkward part. A looping clip is scaled by [applyVolumes],
     * but a repeating clip fires a fresh one-shot off the sound pool each time, and the pool
     * volume is sampled at play -- so the flag in [play] is the only thing that gates it, and
     * without parking the timers the ambience would keep firing. Parked here, and restarted
     * on the way back from [wanted], so FX off and on again does not shorten the loop.
     */
    fun setSfxEnabled(on: Boolean) {
        sfxEnabled = on
        applyVolumes()
        val h = handler()
        if (!on) {
            for ((key, runnable) in repeating.toList()) {
                h?.removeCallbacks(runnable)
                repeating.remove(key)
                // Remembered rather than dropped: `wanted` is the only thing that survives
                // the mute, so losing it here would mean unmuting could not bring it back.
                wanted.add(key)
            }
        } else if (!suspended) {
            // Replay through start(), which already knows the difference between a loop and a
            // repeating clip, rather than re-deciding it here.
            for (id in wanted.toList()) start(id)
        }
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

    /**
     * The music bus. Applies live, so a volume change reaches what is already sounding.
     */
    var musicVolume: Float = 1f
        set(value) {
            field = value.coerceIn(0f, 1f)
            applyVolumes()
        }

    /**
     * The effects bus, which the ambience bed now shares.
     *
     * The apply call is what makes this match the web: without it a volume change on this bus
     * only affected one-shots fired after it, leaving the campfire and any loop on the old
     * level until they were restarted.
     */
    var sfxVolume: Float = 1f
        set(value) {
            field = value.coerceIn(0f, 1f)
            applyVolumes()
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
            // Ambience takes the FX switch and music takes the music switch, so turning
            // effects off actually silences the fire and turning music off leaves it burning.
            val mixer = if (entry.category == AudioCategory.AMBIENCE) sfxVolume else musicVolume
            val on = if (entry.category == AudioCategory.AMBIENCE) sfxEnabled else musicEnabled
            val volume = ((if (on) mixer else 0f) * entry.volume).coerceIn(0f, 1f)
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