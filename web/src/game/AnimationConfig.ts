import { PlayerAction } from './PlayerAction'

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
}

/**
 * Frame counts match the sprite sheets shipped in app/src/main/assets/sprites
 * (12 frames for idle, 12 for walk). ATTACK / HEAVY_ATTACK / DASH / HURT /
 * DEATH / BLOCK sheets are not present yet, so those actions fall back to the
 * idle sheet and reuse the same 12 frames until new art is added.
 */
export function createDefaultConfigs(): Map<PlayerAction, AnimationConfig> {
  return new Map<PlayerAction, AnimationConfig>([
    [
      PlayerAction.IDLE,
      {
        action: PlayerAction.IDLE,
        sourceFileName: 'idle.png',
        frameCount: 12,
        fps: 10,
        loop: true,
        priority: 0,
      },
    ],
    [
      PlayerAction.WALK,
      {
        action: PlayerAction.WALK,
        sourceFileName: 'walk.png',
        frameCount: 12,
        fps: 12,
        loop: true,
        priority: 1,
      },
    ],
    [
      PlayerAction.ATTACK,
      {
        action: PlayerAction.ATTACK,
        sourceFileName: 'idle.png',
        frameCount: 8,
        fps: 16,
        loop: false,
        priority: 3,
      },
    ],
    [
      PlayerAction.HEAVY_ATTACK,
      {
        action: PlayerAction.HEAVY_ATTACK,
        sourceFileName: 'idle.png',
        frameCount: 10,
        fps: 14,
        loop: false,
        priority: 4,
      },
    ],
    [
      PlayerAction.BLOCK,
      {
        action: PlayerAction.BLOCK,
        sourceFileName: 'idle.png',
        frameCount: 6,
        fps: 12,
        loop: true,
        priority: 2,
      },
    ],
    [
      PlayerAction.DASH,
      {
        action: PlayerAction.DASH,
        sourceFileName: 'idle.png',
        frameCount: 6,
        fps: 15,
        loop: false,
        priority: 5,
      },
    ],
    [
      PlayerAction.JUMP,
      {
        action: PlayerAction.JUMP,
        sourceFileName: 'walk.png',
        frameCount: 12,
        fps: 8,
        loop: false,
        priority: 1,
      },
    ],
    [
      PlayerAction.HURT,
      {
        action: PlayerAction.HURT,
        sourceFileName: 'idle.png',
        frameCount: 4,
        fps: 12,
        loop: false,
        priority: 6,
      },
    ],
    [
      PlayerAction.DEATH,
      {
        action: PlayerAction.DEATH,
        sourceFileName: 'idle.png',
        frameCount: 8,
        fps: 8,
        loop: false,
        priority: 10,
      },
    ],
  ])
}
