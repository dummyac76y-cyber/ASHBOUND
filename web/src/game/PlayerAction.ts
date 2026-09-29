/**
 * All actions and states available to the player character.
 * Mirrors PlayerAction.kt in the Android app.
 */
export enum PlayerAction {
  IDLE = 'IDLE',
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
