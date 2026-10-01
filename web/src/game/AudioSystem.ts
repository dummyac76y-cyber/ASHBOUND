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
 * Nothing here is required. Two of the twelve clips are installed so far and the rest are
 * absent, and `loadAll` resolves with those ten in `missing` while the game runs exactly as
 * it did before this file: silent where it should be, and loud where the assets are. That is
 * the state this system is built for, not a fallback bolted on afterwards -- an audio layer
 * that only works once every asset arrives is an audio layer nobody has tested.
 *
 * The installed files are Ogg Vorbis, verified from the container header rather than the
 * extension: both engines decode Vorbis-in-Ogg and neither will decode a MP3 renamed to `.ogg`,
 * so a file that merely claims to be Ogg is the failure this guards against.
 *
 * Mirrors AudioEngine.kt.
 */

import { assetUrl, hasAsset } from '../assetUrl'

export type AudioCategory = 'music' | 'ambience' | 'sfx'

export interface AudioClip {
  readonly id: string
  readonly category: AudioCategory
  readonly file: string
  readonly loop: boolean
  readonly volume: number
  readonly minInterval: number
  /**
   * For a clip that plays intermittently rather than looping: the seconds range between
   * repeats, picked at random each time. Null means the clip does not repeat itself.
   *
   * This is what separates the two ambience clips. The fire is a bed and loops; the menu
   * ambience is a mood that arrives and leaves, and a bed under a title screen stops being
   * noticed within about half a minute, which is the opposite of what it is for.
   */
  readonly every: readonly [number, number] | null
}

export const AUDIO_ROOT = 'audio'

const clip = (
  id: string,
  category: AudioCategory,
  file: string,
  options: { loop?: boolean; volume?: number; minInterval?: number; every?: readonly [number, number] } = {},
): AudioClip => ({
  id,
  category,
  file: `${AUDIO_ROOT}/${file}`,
  loop: options.loop ?? false,
  volume: options.volume ?? 1,
  minInterval: options.minInterval ?? 0,
  every: options.every ?? null,
})

export const AUDIO_CLIPS: readonly AudioClip[] = [
  clip('main_menu_music', 'music', 'music/main_menu_music.ogg', { loop: true, volume: 0.5 }),

  // Not a bed. `loop: false` with an `every` range means this plays as occasional one-shots
  // at random moments rather than running under the menu forever -- see the `every` field below.
  clip('main_menu_ambience', 'ambience', 'ambience/main_menu_ambience.ogg', {
    loop: false,
    volume: 0.45,
    every: [9, 26],
  }),
  // The fire is the opposite: a continuous bed, because a fire does not stop and start.
  clip('campfire', 'ambience', 'ambience/campfire.ogg', { loop: true, volume: 0.4 }),

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

export interface AudioInventory {
  readonly loaded: readonly string[]
  readonly missing: readonly string[]
  readonly unplayed: readonly string[]
}

export class AudioSystem {
  private readonly byId = new Map<string, AudioClip>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly missing = new Set<string>()
  private readonly played = new Set<string>()
  private readonly loops = new Map<string, AudioBufferSourceNode>()

  /**
   * Loops something has asked for that are not running yet, because their file had not
   * finished decoding, or because the context could not play yet, or because they are parked
   * behind a mute. Replayed by `loadAll` once the table has decoded and by `unlock` once the
   * context can play; cleared by `stop`.
   *
   * It is also what keeps a repeating clip alive between firings, so an id here is not by
   * itself a claim that the clip is silent -- see `pending`, which filters that case out.
   */
  private readonly wanted = new Set<string>()

  private gains: Record<AudioCategory, GainNode> | null = null
  private context: AudioContext | null = null
  private musicEnabled = true
  private sfxEnabled = true
  private suspended = false
  private readonly lastPlayed = new Map<string, number>()

  /**
   * Timers for the clips that repeat themselves: one per clip, each rearmed after it fires.
   *
   * Kept as a map of ids rather than of clips so `stop()` can cancel by id, and so `dispose`
   * can prove it left nothing running. A clip asked for more than once reuses its timer.
   */
  private readonly repeating = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Where the random gap comes from.
   *
   * Injected rather than calling `Math.random()` inline so a test can hand in a fixed
   * sequence and assert the exact schedule. Defaulting to the real thing keeps the production
   * path unchanged.
   */
  constructor(
    private readonly now: () => number = () => performance.now() / 1000,
    private readonly random: () => number = Math.random,
  ) {
    for (const c of AUDIO_CLIPS) this.byId.set(c.id, c)
  }

  unlock(): void {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext === 'undefined'
        ? typeof (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === 'undefined'
          ? undefined
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : AudioContext
    if (!Ctor) return
    if (!this.context) {
      this.context = new Ctor()
      this.gains = {
        music: this.context.createGain(),
        ambience: this.context.createGain(),
        sfx: this.context.createGain(),
      }
      for (const gain of Object.values(this.gains)) gain.connect(this.context.destination)
      this.applyGains()
    }
    if (this.context.state === 'suspended') {
      // resume() is async, and this is the one moment the bank is able to start something
      // that was refused earlier. The cues asked for before the first gesture are sitting in
      // `wanted` right now: the menu asks for its music and its fire before the player has
      // touched anything, `start()` records the intent and declines, and only this resume can
      // turn that memory into sound. Without the replay the intent is remembered and never
      // acted on, so the game opens silent and stays silent however many times it is clicked.
      void this.context
        .resume()
        .then(() => this.replayWanted())
        .catch(() => {})
      return
    }
    this.replayWanted()
  }

  /**
   * Starts everything the game asked for while the context was not yet able to play.
   *
   * Best effort by design: a clip whose file never arrived is skipped, and `start` is
   * idempotent for a clip that is already running, so this is safe to call on every gesture
   * and whenever the page comes back from being hidden.
   */
  private replayWanted(): void {
    if (this.context?.state !== 'running') return
    for (const id of [...this.wanted]) this.start(id)
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running'
  }

  async loadAll(): Promise<AudioInventory> {
    await Promise.all(
      AUDIO_CLIPS.map(async (c) => {
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
          this.missing.delete(c.id)
        } catch (err) {
          this.missing.add(c.id)
          console.warn(`[AudioSystem] no usable audio for '${c.id}' at ${c.file}:`, err)
        }
      }),
    )
    // Anything asked for before its file finished decoding gets a second chance now. Done
    // after the whole table rather than per clip, so a retry cannot race a decode still in
    // flight, and skipped for clips known to be absent so nothing logs a warning twice.
    for (const id of [...this.wanted]) {
      if (this.missing.has(id)) continue
      this.start(id)
    }
    return this.inventory()
  }

  inventory(): AudioInventory {
    const loaded = AUDIO_CLIPS.filter((c) => this.buffers.has(c.id)).map((c) => c.id)
    const missing = AUDIO_CLIPS.filter((c) => !this.buffers.has(c.id)).map((c) => c.id)
    return { loaded, missing, unplayed: loaded.filter((id) => !this.played.has(id)) }
  }

  has(id: string): boolean {
    return this.buffers.has(id)
  }

  /**
   * Plays a clip once.
   *
   * Effects are the usual caller. The ambience clips that carry an `every` range can be played
   * this way too, which is how their own timer fires them -- they are one-shots with a
   * schedule attached, not loops.
   */
  play(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || entry.loop || entry.category === 'music') return false
    const isRepeating = entry.every !== null && entry.category === 'ambience'
    if (!isRepeating && entry.category !== 'sfx') return false
    if (!this.sfxEnabled) return false
    if (this.suspended) return false
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
    trim.connect(this.gains?.[entry.category] ?? context.destination)
    source.start()
    this.played.add(id)
    return true
  }

  /**
   * Whether a clip's category is currently muted.
   *
   * Ambience answers to the FX switch and music to the music switch, so the two toggles are
   * not two halves of one "sound" setting: turning music off leaves the fire burning, and
   * turning FX off leaves the music playing.
   */
  private mutedFor(entry: AudioClip): boolean {
    return entry.category === 'music' ? !this.musicEnabled : !this.sfxEnabled
  }

  /**
   * Arms a repeating clip, and rearms it after each firing.
   *
   * The gap is drawn from the clip's range rather than fixed, because a fixed gap is audible
   * as a pulse: the player settles into the rhythm and stops hearing the sound as an event.
   * The first play is immediate rather than delayed, so opening the menu has its ambience
   * with it instead of starting in silence.
   */
  private scheduleRepeating(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry?.every) return false
    // Recorded for the same reason as a muted loop: FX off, then on, must bring the ambience
    // back rather than losing it for the rest of the visit.
    if (!this.sfxEnabled) {
      this.wanted.add(id)
      return false
    }
    // And for the same reason a locked context is. Scheduling here would arm a timer whose
    // first firing is refused because the context cannot play, which then rearms itself and
    // goes round again -- a silent loop that looks like it is working, and which the replay
    // in unlock() would never learn about because it is not in `wanted`. Deferring the whole
    // schedule until the context can play is what makes the ambience arrive with the gesture
    // that unlocked audio, rather than being quietly swallowed by it.
    if (this.context?.state !== 'running') {
      this.wanted.add(id)
      return false
    }
    if (this.suspended) return false
    if (this.repeating.has(id)) return true

    // Immediate first firing, then the random gaps. `setTimeout(…, 0)` rather than calling
    // play() inline so the first play happens on a fresh task, after this method returns and
    // with the timer already in the map -- otherwise a stop() between the two would leave a
    // clip that could never be cancelled.
    this.repeating.set(id, setTimeout(() => this.fire(id, entry), 0))
    return true
  }

  /**
   * Fires a repeating clip once and rearms it.
   *
   * The timer is dropped before playing so a `stop()` inside the play path -- or a clip that
   * has since been stopped -- cannot be undone by the rearm that follows.
   */
  private fire(id: string, entry: AudioClip): void {
    this.repeating.delete(id)
    this.play(id)
    if (this.wanted.has(id) || this.repeating.has(id)) this.arm(id, entry)
  }

  /** Schedules the next firing of a repeating clip that is still wanted. */
  private arm(id: string, entry: AudioClip): void {
    const [lo, hi] = entry.every ?? [0, 0]
    const wait = lo + this.random() * Math.max(0, hi - lo)
    this.repeating.set(id, setTimeout(() => this.fire(id, entry), Math.round(wait * 1000)))
  }

  /** Repeating clips currently scheduled. Exposed so the harness can assert on them. */
  get repeatingIds(): readonly string[] {
    return [...this.repeating.keys()]
  }

  /**
   * Starts a music or ambience clip, looping or not.
   *
   * A looping clip opens a source and holds it. A clip with an `every` range is scheduled
   * instead: it fires once as a one-shot and rearms itself, which is what makes the menu
   * ambience arrive and leave rather than sitting under the title forever.
   */
  start(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || entry.category === 'sfx') return false
    if (entry.every && !entry.loop) return this.scheduleRepeating(id)
    if (!entry.loop) return false
    // A loop for a muted category is not opened at all, which is what stops the fire being
    // started behind an FX switch that is off. The intent is still recorded, so unmuting can
    // open it: a menu that was entered with FX already off has to get its fire when the
    // player switches FX on, not stay silent until they leave and come back.
    //
    // A clip that is muted *later* is a different path -- the source is already open and the
    // mixer takes it to zero, so unmuting brings the same source back rather than restarting
    // the clip from the top.
    if (this.mutedFor(entry)) {
      this.wanted.add(id)
      return false
    }
    if (this.suspended || this.loops.has(id)) return this.loops.has(id)

    const buffer = this.buffers.get(id)
    const context = this.context
    if (!buffer || !context || context.state !== 'running') {
      // Remember the intent instead of dropping it. Decoding is asynchronous and the menu
      // asks for its cues while the last clips are still in flight, so a cue asked for early
      // used to return false and then never sound at all: the ambience won that race and the
      // music simply never played. `loadAll` replays whatever was wanted once the table has
      // finished, so the answer to "asked too soon" is "asked again", not "never".
      this.wanted.add(id)
      return false
    }
    this.wanted.delete(id)

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

  /**
   * Stops one clip, or everything.
   *
   * Cancels repeating clips' timers as well as their sources, and forgets the intent either
   * way. Forgetting it matters most for a repeating clip: a menu ambience left wanted after
   * the menu is torn down would keep firing one-shots at a screen nobody is on.
   */
  stop(id?: string): void {
    if (id) this.wanted.delete(id)
    else this.wanted.clear()

    for (const [key, timer] of [...this.repeating]) {
      if (id && key !== id) continue
      clearTimeout(timer)
      this.repeating.delete(key)
    }

    const targets = id ? [id] : [...this.loops.keys()]
    for (const target of targets) {
      const source = this.loops.get(target)
      if (!source) continue
      this.loops.delete(target)
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
  }

  playing(): readonly string[] {
    return [...this.loops.keys()]
  }

  /**
   * Turns the music mixer on or off, which is the menu music and nothing else.
   *
   * The gain alone is enough, and doing it that way rather than stopping the sources is the
   * whole point: `stop()` takes every loop with it, so muting used to silence the fire as
   * well, and turning it back on left both silent for good. Taking the mixer to zero mutes
   * what is already playing and unmuting brings the very same sources back, still in phase
   * and still where they were.
   *
   * The fire and the menu ambience are not touched here. They belong to the FX switch, which
   * is what a player reaches for when they want a silent campfire.
   */
  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on
    this.applyGains()
    if (on && !this.suspended) {
      // Same reason as the FX switch: a menu entered with music already off has to pick its
      // music up when the player switches it on.
      for (const id of [...this.wanted]) this.start(id)
    }
  }

  /**
   * Turns the effects on or off: sound effects and the ambience bed together.
   *
   * The repeating clips are the awkward part. A looping clip is scaled by the mixer, but a
   * repeating clip fires a fresh one-shot each time, and the mixer only scales what is
   * already connected -- so the gate in `play` alone would leave it firing silently, forever,
   * at a steady rate. Their timers are parked instead, and restarted on the way back from
   * `wanted`, so FX off and on again does not shorten the loop or lose the ambience for good.
   */
  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on
    this.applyGains()
    if (!on) {
      // A repeating clip's one-shots are unaffected by the mixer, since the mixer only scales
      // what is already connected. Park their timers rather than leaving them firing silently
      // at a steady rate forever.
      for (const [key, timer] of [...this.repeating]) {
        clearTimeout(timer)
        this.repeating.delete(key)
        this.wanted.add(key)
      }
    } else if (!this.suspended) {
      // Replay through start(), which already knows the difference between a loop and a
      // repeating clip, rather than re-deciding it here.
      for (const id of [...this.wanted]) this.start(id)
    }
  }

  isMusicEnabled(): boolean { return this.musicEnabled }
  isSfxEnabled(): boolean { return this.sfxEnabled }

  suspend(): void {
    this.suspended = true
    void this.context?.suspend().catch(() => {})
  }

  resume(): void {
    this.suspended = false
    this.unlock()
  }

  /**
   * Loops something has asked for that are not running yet. Exposed so the harness can see them.
   *
   * A repeating clip is excluded once it is armed. It lives in `wanted` for a different
   * reason -- `fire` checks that to decide whether to re-arm itself, since a repeating clip
   * is never in `loops` -- so listing it here would report an ambience that is playing
   * perfectly as something still waiting to play.
   */
  get pending(): readonly string[] {
    return [...this.wanted].filter((id) => !this.repeating.has(id))
  }

  /**
   * The decoded audio for a clip, or null. Exposed so a test can measure a real file's
   * duration and peak level rather than trusting that a file which loaded is a file with
   * sound in it -- a silent placeholder decodes perfectly.
   */
  bufferFor(id: string): AudioBuffer | null {
    return this.buffers.get(id) ?? null
  }

  get isSuspended(): boolean { return this.suspended }

  private applyGains(): void {
    if (!this.gains) return
    this.gains.music.gain.value = this.musicEnabled ? 1 : 0
    // Ambience rides the FX switch, not the music one. The fire and the menu ambience are
    // effects on the scene, and a player who turns effects off does not expect to still be
    // listening to a crackling fire. Keeping this a separate node rather than routing
    // ambience into the sfx node is what lets it carry its own per-category volume.
    this.gains.ambience.gain.value = this.sfxEnabled ? 1 : 0
    this.gains.sfx.gain.value = this.sfxEnabled ? 1 : 0
  }

  dispose(): void {
    this.stop()
    this.buffers.clear()
    this.loops.clear()
    this.repeating.clear()
    const context = this.context
    this.context = null
    if (context) void context.close().catch(() => {})
  }
}
