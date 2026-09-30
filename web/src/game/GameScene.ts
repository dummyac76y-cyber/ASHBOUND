/**
 * Scene definitions and the geometry that fits a backdrop to a scene.
 *
 * Every environment is its own full-screen scene: exactly one backdrop is drawn at
 * a time, scaled to cover that scene's world. Environments are never placed beside
 * one another, so no seam, black gap or mismatched-scale step can exist between
 * them -- they are not in the same picture at all.
 *
 * The player is deliberately absent from this module. Sprite size is a property of
 * the character, not of the scenery behind it, so the knight keeps one logical size
 * in every scene regardless of how the backdrop had to be scaled to fill.
 *
 * Mirrors GameScene.kt.
 */

/** How a backdrop plate is scaled and positioned to cover a scene's world. */
export interface SceneBackdropFit {
  /**
   * Uniform scale applied to the source image. One value for both axes, so the
   * artwork is never stretched.
   */
  readonly scale: number
  /** Scaled size of the plate. Both are >= the area they must cover. */
  readonly drawWidth: number
  readonly drawHeight: number
  /**
   * World-space position of the plate's top-left corner.
   *
   * Negative on an axis that overflows, which is how the excess is cropped: the
   * artwork grows past the viewport and the overhang is trimmed evenly on both
   * sides. It is never positive on a covering axis, because positive offset would
   * leave an unfilled gap at the near edge.
   */
  readonly offsetX: number
  readonly offsetY: number
  /**
   * World Y of the visible floor surface, i.e. where the source row [floorRow]
   * ends up after scaling and offsetting.
   *
   * This is the scene's ground plane: the player's visible feet rest exactly here,
   * so it is derived from the artwork rather than chosen independently of it.
   */
  readonly floorY: number
}

/**
 * Scales a backdrop to completely cover a scene, preserving aspect ratio.
 *
 * Height drives the scale, because that is what makes a background read as
 * "full screen"; the result is then widened only if covering the height alone would
 * leave a horizontal gap. Either way exactly one uniform scale is used on both
 * axes, so the picture is never distorted, mirrored, tiled or squashed -- only
 * uniformly scaled, and the excess cropped.
 *
 * The overflow is centred on each axis, which crops evenly at both edges instead of
 * biasing the artwork to one side.
 */
export function fitBackdrop(
  imageWidth: number,
  imageHeight: number,
  floorRow: number,
  worldWidth: number,
  viewportHeight: number,
): SceneBackdropFit {
  // Cover on height first...
  let scale = viewportHeight / imageHeight
  // ...then raise it if that would leave the world horizontally uncovered.
  if (imageWidth * scale < worldWidth) scale = worldWidth / imageWidth

  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  // Centred, so overflow crops evenly. Negative on any axis that overflows.
  const offsetX = (worldWidth - drawWidth) / 2
  const offsetY = (viewportHeight - drawHeight) / 2

  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
    floorY: offsetY + floorRow * scale,
  }
}

/** Static description of one environment. */
export interface SceneDefinition {
  /** Stable identifier, used by tests and by the Android/web scene maps. */
  readonly id: string
  /** Display name shown on the transition card, e.g. "THE UNDERGROUND CAVERN". */
  readonly title: string
  /** Resource name of the backdrop, matching the synced asset filename stem. */
  readonly asset: string
  /**
   * Native pixel size of the backdrop artwork.
   *
   * Declared rather than read off the decoded image so a scene's geometry -- its
   * scale, crop and floor plane -- is fully determined by its definition. That keeps
   * it computable without loading anything, checkable in unit tests, and directly
   * comparable between the two engines.
   */
  readonly sourceWidth: number
  readonly sourceHeight: number
  /**
   * Row of the visible floor surface in the source artwork, measured from the top.
   *
   * Both backdrops share one structure: dark wall, then a lit floor band, then a
   * dark foreground that runs off the bottom. The floor is the row where the band
   * begins, which is a real step in the image rather than a guessed fraction of it.
   */
  readonly floorRow: number
  /** Width of this scene's world, in logical pixels. Each scene bounds itself. */
  readonly worldWidth: number
  /** World X the player is placed at when this scene loads. */
  readonly spawnX: number
  /**
   * World X of this scene's training dummies, in world units.
   *
   * Explicit per scene: objects belong to the scene that declares them and are
   * rebuilt on entry, so one scene's fixtures never carry into the next unless that
   * scene lists its own.
   */
  readonly dummyXs: readonly number[]
  /**
   * World X at which this scene hands over to the next one, or null when the scene
   * is a dead end and has nowhere to go.
   *
   * Reaching it stops normal movement and starts the scene transition.
   */
  readonly exitX: number | null
}

/**
 * The Forgotten Prison: the opening scene.
 *
 * Its 1536x864 artwork covers a 640-wide scene at exactly 5/12, which is the same
 * scale and the same alignment the prison has always used, so this scene renders
 * pixel-for-pixel as before. Only what surrounds it has changed.
 */
export const FORGOTTEN_PRISON: SceneDefinition = {
  id: 'forgotten_prison',
  title: 'THE FORGOTTEN PRISON',
  asset: 'img_arena_bg_hd',
  sourceWidth: 1536,
  sourceHeight: 864,
  floorRow: 533,
  worldWidth: 640,
  spawnX: 320,
  dummyXs: [450, 570],
  // The player is clamped to worldWidth - width/2, so the exit sits exactly where
  // walking into the right-hand wall brings them to a stop.
  exitX: 618,
}

/**
 * The Underground Cavern: the scene that follows the prison.
 *
 * The cavern art is 1536x512, so covering 360 logical rows of height needs 45/64
 * rather than the prison's 5/12 -- about 1.69x larger. That is expected here and is
 * precisely why the two are separate scenes: the scenery is drawn at whatever scale
 * fills the screen, while the knight keeps his own fixed size and simply stands on
 * this scene's own floor plane.
 */
export const UNDERGROUND_CAVERN: SceneDefinition = {
  id: 'underground_cavern',
  title: 'THE UNDERGROUND CAVERN',
  asset: 'img_underground_cavern_hd',
  sourceWidth: 1536,
  sourceHeight: 512,
  floorRow: 391,
  worldWidth: 640,
  // Entered from the left, at the mouth of the cave.
  spawnX: 120,
  // Deliberately not the prison's 450/570: the cavern declares its own fixtures.
  dummyXs: [400, 520],
  exitX: null,
}

/**
 * Scenes in travel order.
 *
 * Walking off the right edge of a scene advances to the next entry; the last scene
 * has no successor and simply stops the player at its boundary.
 */
export const SCENES: readonly SceneDefinition[] = [FORGOTTEN_PRISON, UNDERGROUND_CAVERN]

/** Index of the scene the game opens on. */
export const STARTING_SCENE_INDEX = 0

/** Duration of the whole scene handover, in seconds. */
export const TRANSITION_FADE_OUT = 0.3
export const TRANSITION_TITLE_HOLD = 0.4
export const TRANSITION_FADE_IN = 0.3
export const TRANSITION_TOTAL = TRANSITION_FADE_OUT + TRANSITION_TITLE_HOLD + TRANSITION_FADE_IN

/** Stage of a scene handover. */
export type SceneTransitionPhase = 'idle' | 'fadingOut' | 'title' | 'fadingIn'

/**
 * A single drifting mote of cave fog, used only while a scene is handing over.
 *
 * Kept as plain data so both engines can animate and draw it identically from the
 * same seed.
 */
export interface FogMote {
  x: number
  y: number
  vx: number
  vy: number
  size: number
}

/**
 * Builds the fog mote field for a transition.
 *
 * Deterministic in [seed] so both engines, and the headless harness, produce the
 * same drift rather than each drawing different weather.
 */
export function buildFogMotes(seed: number, count: number, worldWidth: number, viewportHeight: number): FogMote[] {
  const motes: FogMote[] = []
  // Small local LCG: identical arithmetic in JS and Kotlin, no RNG library needed.
  let state = (seed * 1103515245 + 12345) >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < count; i++) {
    motes.push({
      x: next() * worldWidth,
      y: next() * viewportHeight,
      vx: (next() - 0.5) * 14,
      vy: -6 - next() * 10,
      size: 1 + next() * 2,
    })
  }
  return motes
}

/** Advances a fog mote field, wrapping motes that leave the viewport. */
export function updateFogMotes(motes: FogMote[], dt: number, worldWidth: number, viewportHeight: number): void {
  for (const m of motes) {
    m.x += m.vx * dt
    m.y += m.vy * dt
    if (m.y < -8) {
      m.y = viewportHeight + 8
      m.x = ((m.x + worldWidth * 0.37) % worldWidth + worldWidth) % worldWidth
    }
    if (m.x < -8) m.x += worldWidth + 16
    if (m.x > worldWidth + 8) m.x -= worldWidth + 16
  }
}
