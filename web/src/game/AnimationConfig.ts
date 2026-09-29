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
   * strip whose cells are as tall as the image. The attack sheet is a 4x4 grid
   * of 256px cells rather than a strip of 128px ones.
   */
  cellSize: number | null
  /**
   * Multiplier applied to SPRITE_DISPLAY_SIZE for this sheet, so a sheet drawn
   * at a different native resolution still renders its character at the same
   * on-screen size as every other action.
   */
  displayScale: number
}

/**
 * Frame counts match the sprite sheets shipped in app/src/main/assets/sprites
 * (12 frames for idle, 12 for walk, 10 for jump). The attack sheet is packed as a
 * 4x4 grid of 256px cells rather than a horizontal strip of 128px ones, so it
 * declares `columns`, `cellSize` and a `displayScale` that keeps its character
 * the same on-screen size as the strip sheets. HEAVY_ATTACK / DASH / HURT /
 * DEATH / BLOCK sheets are not present yet, so those actions fall back to the
 * idle sheet and reuse the same 12 frames until new art is added.
 */
export function createDefaultConfigs(): Map<PlayerAction, AnimationConfig> {
  const config = (
    action: PlayerAction,
    sourceFileName: string,
    frameCount: number,
    fps: number,
    loop: boolean,
    priority: number,
    grid: { columns?: number; cellSize?: number; displayScale?: number } = {},
  ): AnimationConfig => ({
    action,
    sourceFileName,
    frameCount,
    fps,
    loop,
    priority,
    footRows: footRowsFor(sourceFileName) ?? [],
    columns: grid.columns ?? null,
    cellSize: grid.cellSize ?? null,
    displayScale: grid.displayScale ?? 1,
  })

  return new Map<PlayerAction, AnimationConfig>([
    [PlayerAction.IDLE, config(PlayerAction.IDLE, 'idle.png', 12, 10, true, 0)],
    [PlayerAction.WALK, config(PlayerAction.WALK, 'walk.png', 12, 12, true, 1)],
    [PlayerAction.ATTACK, config(PlayerAction.ATTACK, 'attack.png', 16, 24, false, 3, { columns: 4, cellSize: 256, displayScale: 1.366 })],
    [PlayerAction.HEAVY_ATTACK, config(PlayerAction.HEAVY_ATTACK, 'idle.png', 10, 14, false, 4)],
    [PlayerAction.BLOCK, config(PlayerAction.BLOCK, 'idle.png', 6, 12, true, 2)],
    [PlayerAction.DASH, config(PlayerAction.DASH, 'idle.png', 6, 15, false, 5)],
    [PlayerAction.JUMP, config(PlayerAction.JUMP, 'jump.png', 10, 12, false, 1)],
    [PlayerAction.HURT, config(PlayerAction.HURT, 'idle.png', 4, 12, false, 6)],
    [PlayerAction.DEATH, config(PlayerAction.DEATH, 'idle.png', 8, 8, false, 10)],
  ])
}
