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
}

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

export const AUDIO_CLIPS: readonly AudioClip[] = [
  // Main-menu music is intentionally MP3: this is the supplied source file.
  clip('main_menu_music', 'music', 'music/main_menu_music.mp3', { loop: true, volume: 0.5 }),

  clip('main_menu_ambience', 'ambience', 'ambience/main_menu_ambience.mp3', { loop: true, volume: 0.45 }),
  clip('campfire', 'ambience', 'ambience/campfire.mp3', { loop: true, volume: 0.4 }),

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

  private gains: Record<AudioCategory, GainNode> | null = null
  private context: AudioContext | null = null
  private musicEnabled = true
  private sfxEnabled = true
  private suspended = false
  private readonly lastPlayed = new Map<string, number>()

  constructor(private readonly now: () => number = () => performance.now() / 1000) {
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
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
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

  play(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || entry.loop || entry.category === 'music' || entry.category === 'ambience') return false
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

  start(id: string): boolean {
    const entry = this.byId.get(id)
    if (!entry || !entry.loop || entry.category === 'sfx') return false
    if (entry.category === 'music' && !this.musicEnabled) return false
    if (this.suspended || this.loops.has(id)) return this.loops.has(id)

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

  stop(id?: string): void {
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

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on
    if (!on) this.stop()
    this.applyGains()
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on
    this.applyGains()
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

  get isSuspended(): boolean { return this.suspended }

  private applyGains(): void {
    if (!this.gains) return
    this.gains.music.gain.value = this.musicEnabled ? 1 : 0
    this.gains.ambience.gain.value = this.musicEnabled ? 1 : 0
    this.gains.sfx.gain.value = this.sfxEnabled ? 1 : 0
  }

  dispose(): void {
    this.stop()
    this.buffers.clear()
    this.loops.clear()
    const context = this.context
    this.context = null
    if (context) void context.close().catch(() => {})
  }
}
