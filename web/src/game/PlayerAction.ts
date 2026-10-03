/**
 * All actions and states available to the player character.
 * Mirrors PlayerAction.kt in the Android app.
 */
export enum PlayerAction {
  IDLE = 'IDLE',
  /**
   * The occasional fidget while standing still.
   *
   * Not a locomotion state: it is the idle pose with something extra on top, and it must give
   * way the instant the player moves or acts. Separate from IDLE rather than an extra IDLE
   * variant because it has its own sheet, and a variant of a sheet the player sees every
   * other second cannot be expressed as more frames of that sheet.
   */
  IDLE_VARIANT = 'IDLE_VARIANT',
  WALK = 'WALK',
  ATTACK = 'ATTACK',
  HEAVY_ATTACK = 'HEAVY_ATTACK',
  BLOCK = 'BLOCK',
  DASH = 'DASH',
  JUMP = 'JUMP',
  HURT = 'HURT',
  DEATH = 'DEATH',
}

export const PLAYER_ACTIONS: PlayerAction[] = Object.values(PlayerAction)

export function displayName(action: PlayerAction): string {
  switch (action) {
    case PlayerAction.IDLE:
      return 'Idle'
    case PlayerAction.IDLE_VARIANT:
      return 'Idle Variant'
    case PlayerAction.WALK:
      return 'Walk'
    case PlayerAction.ATTACK:
      return 'Attack'
    case PlayerAction.HEAVY_ATTACK:
      return 'Heavy Attack'
    case PlayerAction.BLOCK:
      return 'Block'
    case PlayerAction.DASH:
      return 'Dash'
    case PlayerAction.JUMP:
      return 'Jump'
    case PlayerAction.HURT:
      return 'Hurt'
    case PlayerAction.DEATH:
      return 'Death'
  }
}
