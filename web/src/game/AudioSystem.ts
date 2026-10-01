/**
 * The audio bank and player.
 *
 * Every clip is named here once, and the name is the whole contract: the id below is what
 * the game asks for, the file beside it is what has to exist, and the Android engine
 * declares the same ids against the same filenames so one script can check that both
 * platforms are asking for the same audio. Nothing is discovered by scanning a directory,
 * because a missing file that nobody mentioned is invisible, and a file nobody plays is
 * just as broken -- a fixed table makes both show up in `missing` and `unplayed`.
 *
 * Nothing here is required. No clip exists yet, so `loadAll` resolves with every id in
 * `missing`, and the game runs exactly as it did before this file: silent, and with no
 * errors in the console beyond one warning per file. That is the state this system is
 * built for, not a fallback bolted on afterwards -- an audio layer that only works once
 * the assets arrive is an audio layer nobody has tested.
 *
 * Mirrors AudioEngine.kt.
 */

/** Which mixer a clip belongs to, and therefore what it obeys. */
import { assetUrl, hasAsset } from '../assetUrl'

export type AudioCategory = 'music' | 'ambience' | 'sfx'

export interface AudioClip {
  /** What the game asks for. Stable, and shared with the Android engine. */
  readonly id: string
  readonly category: AudioCategory
  /** Path under the audio root. The same string on both platforms. */
  readonly file: string
  /** Looping clips are held open and stopped explicitly; one-shots are fire and forget. */
  readonly loop: boolean
  /** Per-clip trim, before the category's own volume. */
  readonly volume: number
  /**
   * The shortest gap before this clip may play again, in seconds.
   *
   * Held-input attacks and a walk cycle both fire far faster than a sound should repeat, and
   * without this they stack into a buzz that is louder than the music it sits under. Zero
   * means no limit, which is right for anything that cannot retrigger itself.
   */
  readonly minInterval: number
}

/**
 * The folder every path below is relative to, and the root the Android engine opens.
 *
 * `audio/` rather than `audio/music` etc. as the root, so a clip's `file` reads the same in
 * both trees and can be compared as a string.
 */
export const AUDIO_ROOT = 'audio'

const clip = (
  id: string,
  category: AudioCategory,
  file: string,
  options: { loop?: boolean; volume?: number; minInterval?: number } = {},
): AudioClip => ({
  id,
  category,
  file: `${AUDIO_ROOT}/${file}`,
  loop: options.loop ?? false,
  volume: options.volume ?? 1,
  minInterval: options.minInterval ?? 0,
})

/**
 * Every clip the game knows about.
 *
 * Grouped by mixer in the order the folders are named, because that grouping is the only
 * thing that decides whether a clip loops, how loud it is allowed to be, and whether a
 * volume change reaches it. Anything added here also has to be added to `AUDIO_CLIPS` in
 * AudioEngine.kt, which verify-audio.mjs checks by comparing the two tables.
 */
export const AUDIO_CLIPS: readonly AudioClip[] = [
  // music -- one track at a time, ducked under everything else
  clip('main_menu_music', 'music', 'music/main_menu_music.ogg', { loop: true, volume: 0.5 }),

  // ambience -- loops that share time with the music and with each other
  clip('main_menu_ambience', 'ambience', 'ambience/main_menu_ambience.ogg', { loop: true, volume: 0.45 }),
  clip('campfire', 'ambience', 'ambience/campfire.ogg', { loop: true, volume: 0.4 }),

  // sfx -- fire and forget
  clip('sword_attack', 'sfx', 'sfx/sword_attack.ogg', { minInterval: 0.08 }),
  clip('heavy_attack', 'sfx', 'sfx/heavy_attack.ogg', { minInterval: 0.15 }),
  clip('sword_hit', 'sfx', 'sfx/sword_hit.ogg', { minInterval: 0.05 }),
  clip('footsteps_stone', 'sfx', 'sfx/footsteps_stone.ogg', { minInterval: 0.12 }),
  clip('jump', 'sfx', 'sfx/jump.ogg'),
  clip('dash', 'sfx', 'sfx/dash.ogg', { minInterval: 0.1 }),
  clip('block', 'sfx', 'sfx/block.ogg', { minInterval: 0.1 }),
  clip('hurt', 'sfx', 'sfx/hurt.ogg', { minInterval: 0.15 }),
  clip('death', 'sfx', 'sfx/death.ogg'),
]

/** The ids that play over the main menu, started when the menu appears. */
export const MAIN_MENU_MUSIC = 'main_menu_music'
export const MAIN_MENU_AMBIENCE = 'main_menu_ambience'

/**
 * The fire's own crackle.
 *
 * Started with the menu rather than by a world object: the loop lives where the visible fire
 * is, and there is no campfire entity in the game yet. When one exists this becomes its loop
 * instead, at the same id and the same path, so nothing else has to change.
 */
export const CAMPFIRE = 'campfire'

/** What `loadAll` found. Kept so the settings screen and the verifier can report it. */
export interface AudioInventory {
  /** Ids whose file decoded. */
  readonly loaded: readonly string[]
  /** Ids whose file is absent or undecodable. The expected state until assets are added. */
  readonly missing: readonly string[]
  /** Ids present but never asked to play, which is a bug rather than a gap. */
  readonly unplayed: readonly string[]
}

/**
 * Plays the bank, or does nothing at all.
 *
 * The whole class is written so that every entry point is safe to call at any time, in any
 * state, on any browser. That is not defensiveness for its own sake: an AudioContext cannot
 * be created until the user has interacted with the page, the assets may never arrive, a
 * decode may fail on a file that exists, and the tab may be hidden when a sound is due. None
 * of those are exceptional, and none of them may reach the game's frame loop as a throw.
 */
export class AudioSystem {
  private readonly byId = new Map<string, AudioClip>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly missing = new Set<string>()
  private readonly played = new Set<string>()

  /** Sources for the clips that are currently looping, so they can be stopped by id. */
  private readonly loops = new Map<string, AudioBufferSourceNode>()

  private gains: Record<AudioCategory, GainNode> | null = null
  private context: AudioContext | null = null

  /** Set while the tab is hidden or the game has not started, so cues are not lost. */
  private musicEnabled = true
  private sfxEnabled = true
  private suspended = false
  private readonly lastPlayed = new Map<string, number>()

  constructor(private readonly now: () => number = () => performance.now() / 1000) {
    for (const c of AUDIO_CLIPS) this.byId.set(c.id, c)
  }

  /**
   * Creates the audio graph, or returns the one that already exists.
   *
   * Browsers refuse to start an AudioContext before the page has been interacted with, and
   * the refusal is silent: a context created too early sits at `suspended` and every sound
   * afterwards is dropped without a word. So this is called from the first gesture, and the
   * context is resumed again on every gesture until it reports `running` -- which is why
   * `unlock` is safe to call as often as the player clicks.
   */
  unlock(): void {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext === 'undefined'
        ? typeof (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ===
            'undefined'
          ? undefined
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : AudioContext
    if (!Ctor) return
    if (!this.context) {
      this.context = new Ctor()
      // One gain per mixer, so a volume change is a single assignment rather than a walk
      // over every source, and so turning a mixer off can silence what is already looping.
      this.gains = {
        music: this.context.createGain(),
        ambience: this.context.createGain(),
        sfx: this.context.createGain(),
      }
      for (const gain of Object.values(this.gains)) gain.connect(this.context.destination)
      this.applyGains()
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
  }

  /** True once there is a context that is allowed to make noise. */
  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running'
  }

  /**
   * Fetches and decodes every clip.
   *
   * One warning per missing file and no rejection, ever: this is awaited during boot, and
   * boot is not the place to find out that an optional sound is not there yet. A decode
   * failure is treated exactly like an absent file, because from the game's point of view
   * they are the same thing.
   */
  async loadAll(): Promise<AudioInventory> {
    await Promise.all(
      AUDIO_CLIPS.map(async (c) => {
        // Absent is the expected state for most of these, so it is established from the
        // build manifest instead of by requesting the file and watching it 404. The clip is
        // recorded as missing either way, which is what the settings screen reports.
        if (!hasAsset(c.file)) {
          this.missing.add(c.id)
          return
        }
        if (!this.context) this.unlock()
        const context = this.context
        if (!context) {
          this.missing.add(c.id)
          return
        }
        try {
          const response = await fetch(assetUrl(c.file))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          const decoded = await context.decodeAudioData(bytes)
          this.buffers.set(c.id, decoded)
        } catch (err) {
          this.missing.add(c.id)
          console.warn(`[AudioSystem] no usable audio for '${c.id}' at ${c.file}:`, err)
        }
      }),
    )
    return this.inventory()
  }

  /** What was found. The honest state of the bank, for the settings screen and for tests. */
  inventory(): AudioInventory {
    const loaded = AUDIO_CLIPS.filter((c) => this.buffers.has(c.id)).map((c) => c.id)
    const missing = AUDIO_CLIPS.filter((c) => !this.buffers.has(c.id)).map((c) => c.id)
    return { loaded, missing, unplayed: loaded.filter((id) => !this.played.has(id)) }
  }

  /** True when the named clip decoded and can be played. */
  has(id: string): boolean {
    return this.buffers.has(id)
  }

  /**
   * Plays a one-shot.
   *
   * Returns whether it actually sounded, which is what makes this testable: with no assets
   * every call is a no-op that reports false rather than throwing, so the caller can tell
   * the difference between "the sound played" and "there was no sound".
   */
  play(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || entry.loop) return false
    if (entry.category === 'music' || entry.category === 'ambience') return false
    if (!this.sfxEnabled || this.suspended) return false
    const buffer = this.buffers.get(id)
    const context = this.context
    if (!buffer || !context || context.state !== 'running') return false

    const now = this.now()
    const last = this.lastPlayed.get(id)
    if (last !== undefined && entry.minInterval > 0 && now - last < entry.minInterval) return false
    this.lastPlayed.set(id, now)

    const source = context.createBufferSource()
    source.buffer = buffer
    const trim = context.createGain()
    trim.gain.value = entry.volume
    source.connect(trim)
    trim.connect(this.gains?.sfx ?? context.destination)
    source.start()
    this.played.add(id)
    return true
  }

  /**
   * Starts a looping clip, or does nothing if it is already playing.
   *
   * Restarting a loop in progress is not idempotent -- two copies a fraction of a second
   * apart beat against each other -- so this is a no-op when the id is already sounding.
   */
  start(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || !entry.loop) return false
    if (entry.category === 'sfx') return false
    if (entry.category === 'music' && !this.musicEnabled) return false
    if (this.suspended) return false
    if (this.loops.has(id)) return true

    const buffer = this.buffers.get(id)
    const context = this.context
    if (!buffer || !context || context.state !== 'running') return false

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const trim = context.createGain()
    trim.gain.value = entry.volume
    source.connect(trim)
    trim.connect(this.gains?.[entry.category] ?? context.destination)
    source.start()
    this.loops.set(id, source)
    this.played.add(id)
    return true
  }

  /** Stops one looping clip, or every looping clip when called with no id. */
  stop(id?: string): void {
    const targets = id ? [id] : [...this.loops.keys()]
    for (const target of targets) {
      const source = this.loops.get(target)
      if (!source) continue
      this.loops.delete(target)
      try {
        source.stop()
      } catch {
        // Already stopped. Calling stop() twice throws in some browsers, and a sound that
        // has already ended is not an error worth surfacing.
      }
      source.disconnect()
    }
  }

  /** Ids currently looping. Used by the verifier to assert a cue stops when it should. */
  playing(): readonly string[] {
    return [...this.loops.keys()]
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on
    if (!on) this.stop()
    this.applyGains()
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on
    this.applyGains()
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled
  }

  isSfxEnabled(): boolean {
    return this.sfxEnabled
  }

  /**
   * Silences the graph without tearing it down.
   *
   * Used for a hidden tab and for the moment before the game starts. Suspending the context
   * rather than stopping each source means resuming is instant and phase-accurate, and it
   * holds for clips that have not loaded yet -- so a cue asked for while suspended is simply
   * dropped, not queued up to ambush the player the moment they alt-tab back.
   */
  suspend(): void {
    this.suspended = true
    void this.context?.suspend().catch(() => {})
  }

  resume(): void {
    this.suspended = false
    this.unlock()
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  /**
   * One assignment per mixer rather than one per source.
   *
   * The ambience mixer follows the music switch: a player who turns music off means the
   * soundtrack, not the room the character is standing in, and leaving a fire crackling
   * behind a silent menu is the sort of thing that makes a mute button feel broken.
   */
  private applyGains(): void {
    if (!this.gains) return
    this.gains.music.gain.value = this.musicEnabled ? 1 : 0
    this.gains.ambience.gain.value = this.musicEnabled ? 1 : 0
    this.gains.sfx.gain.value = this.sfxEnabled ? 1 : 0
  }

  /** Tears everything down: stops loops, drops buffers, closes the context. */
  dispose(): void {
    this.stop()
    this.buffers.clear()
    this.loops.clear()
    const context = this.context
    this.context = null
    if (context) void context.close().catch(() => {})
  }
}
