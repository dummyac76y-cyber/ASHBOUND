import { PlayerAction } from './PlayerAction'
import { footRowsFor } from './spriteMetrics'

/**
 * Modular animation configuration for a 2D sprite action.
 * Mirrors AnimationConfig.kt in the Android app.
 */
export interface AnimationConfig {
  action: PlayerAction
  /** Asset URL, resolved against BASE_PATH (defaults to /sprites). */
  sourceFileName: string
  /** Total frames in the sheet. If null, derived from bitmap width / height. */
  frameCount: number | null
  fps: number
  loop: boolean
  /** Higher priority actions cannot be interrupted by lower priority actions. */
  priority: number
  /**
   * Bottom-most opaque source row per frame, in the same order as the sheet's
   * frames. Defaults to the measured data for sourceFileName; frames beyond the
   * list fall back to the rest-pose row. This is what keeps the visible feet on
   * the floor when the art is not bottom-aligned.
   */
  footRows: readonly number[]
  /**
   * Frames per row. Sheets that pack a grid (several rows of cells) set this so
   * frames advance across and then down. Null means a single horizontal strip,
   * which is how idle, walk and jump are laid out.
   */
  columns: number | null
  /**
   * Native size of one cell, in sheet pixels. Null means the sheet is a single
   * strip whose cells are as tall as the image. The attack sheets are grids of
   * 256px cells rather than strips of 128px ones.
   */
  cellSize: number | null
  /**
   * Multiplier applied to SPRITE_DISPLAY_SIZE for this sheet, so a sheet drawn
   * at a different native resolution still renders its character at the same
   * on-screen size as every other action.
   */
  displayScale: number
  /**
   * First and last frame of the window in which the attack is live, as
   * `[first, last]` inclusive, or null for a sheet that deals no damage.
   *
   * Damage is dealt when the animation enters this window rather than on the
   * input frame, so the hit lands while the blade is actually out. The window is
   * measured from the artwork by finding where the sword reaches furthest from
   * the body, which is the frame of contact.
   */
  hitFrames: readonly [number, number] | null
}

/**
 * Frame counts match the sprite sheets shipped in app/src/main/assets/sprites
 * (12 frames for idle, 12 for walk, 10 for jump).
 *
 * `displayScale` normalises every sheet so the character is the same on-screen size
 * in all of them, which is what stops it visibly popping as the state changes. The
 * artwork does not draw the character at a consistent size: the 128px strip sheets
 * leave different amounts of headroom, and the 256px attack cells were drawn with
 * room for a large weapon, so the character occupies a much smaller fraction of
 * their cell. Each scale is the ratio that makes that sheet render the same as idle.
 *
 * The values are calibrated on the *median* rendered character height across a
 * sheet's frames, not on its first or tallest frame. The tallest frame of an attack
 * is the one with the sword overhead, which measures the weapon rather than the
 * character, and the character also crouches through part of each swing. The median
 * is robust to both, and is asserted against the real rendered pixels by
 * scripts/verify-attack.mjs, which measures far more reliably than a formula over
 * source-pixel bounds can.
 *
 * DASH / HURT / DEATH / BLOCK sheets are not present yet, so those actions fall
 * back to the idle sheet and reuse its 12 frames until new art is added.
 */
export function createDefaultConfigs(): Map<PlayerAction, AnimationConfig> {
  const config = (
    action: PlayerAction,
    sourceFileName: string,
    frameCount: number,
    fps: number,
    loop: boolean,
    priority: number,
    opts: {
      columns?: number
      cellSize?: number
      displayScale?: number
      hitFrames?: readonly [number, number]
    } = {},
  ): AnimationConfig => ({
    action,
    sourceFileName,
    frameCount,
    fps,
    loop,
    priority,
    footRows: footRowsFor(sourceFileName) ?? [],
    columns: opts.columns ?? null,
    cellSize: opts.cellSize ?? null,
    displayScale: opts.displayScale ?? 1,
    hitFrames: opts.hitFrames ?? null,
  })

  return new Map<PlayerAction, AnimationConfig>([
    // idle.png is the reference: its scale is 1 and every other sheet is scaled to
    // match it. The actions still standing in on idle.png keep scale 1 for the
    // same reason, so they render identically.
    [PlayerAction.IDLE, config(PlayerAction.IDLE, 'idle.png', 12, 10, true, 0)],
    // walk.png draws its character a little smaller than idle.png does, and
    // jump.png draws its character larger, so both need a correction to stop the
    // character visibly resizing as the state changes.
    [PlayerAction.WALK, config(PlayerAction.WALK, 'walk.png', 12, 12, true, 1, { displayScale: 1.091 })],
    [PlayerAction.JUMP, config(PlayerAction.JUMP, 'jump.png', 10, 12, false, 1, { displayScale: 0.918 })],
    // 4x4 grid of 256px cells. The blade is furthest out on frames 8 and 9, and
    // stays out through 11, so that is the window in which the hit is live.
    [PlayerAction.ATTACK, config(PlayerAction.ATTACK, 'attack.png', 16, 24, false, 3, {
      columns: 4, cellSize: 256, displayScale: 1.461, hitFrames: [8, 11],
    })],
    // 5x5 grid of 256px cells. The long windup occupies frames 0..13; the blade
    // first reaches full extension on frame 14 and is still out through 19.
    // Scaled a little past the size every other sheet renders at, so the heavy
    // swing reads as more weight than a light one; see verify-attack.mjs.
    [PlayerAction.HEAVY_ATTACK, config(PlayerAction.HEAVY_ATTACK, 'heavy_attack.png', 25, 20, false, 4, {
      columns: 5, cellSize: 256, displayScale: 1.68, hitFrames: [14, 18],
    })],
    [PlayerAction.BLOCK, config(PlayerAction.BLOCK, 'idle.png', 6, 12, true, 2)],
    [PlayerAction.DASH, config(PlayerAction.DASH, 'idle.png', 6, 15, false, 5)],
    [PlayerAction.HURT, config(PlayerAction.HURT, 'idle.png', 4, 12, false, 6)],
    [PlayerAction.DEATH, config(PlayerAction.DEATH, 'idle.png', 8, 8, false, 10)],
  ])
}
