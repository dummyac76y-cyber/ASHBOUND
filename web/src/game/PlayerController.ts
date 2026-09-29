import { PlayerAction } from '../game/PlayerAction'
import type { SpriteAnimationSystem } from '../game/SpriteAnimationSystem'

/** Axis-aligned rectangle used for hit detection. */
export interface RectF {
  left: number
  top: number
  right: number
  bottom: number
}

export function rectsIntersect(a: RectF, b: RectF): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Controller connecting player physics, state machine, and SpriteAnimationSystem.
 * Decoupled from input mechanisms (touch, joystick, keyboard).
 * Mirrors PlayerController.kt.
 */
export class PlayerController {
  constructor(
    readonly animationSystem: SpriteAnimationSystem,
    public x = 200,
    public groundY = 260,
  ) {}

  // Spatial dimensions
  readonly width = 44
  readonly height = 70

  // Motion physics
  vx = 0
  vy = 0
  isGrounded = true
  isFacingRight = true

  // Combat Stats
  maxHp = 100
  hp = 100
  maxStamina = 100
  stamina = 100
  isInvulnerable = false
  isBlocking = false

  // Constants
  private readonly walkSpeed = 150
  private readonly jumpImpulse = -360
  private readonly gravity = 880
  private readonly dashSpeed = 380
  private readonly dashDuration = 0.22

  // Internal state timers
  private dashTimer = 0
  private attackHitboxProcessed = false
  private heavyAttackHitboxProcessed = false

  // Input buffer
  private inputMoveX = 0
  private isBlockInputActive = false

  /** Hitbox for damage detection. */
  get hitbox(): RectF {
    return { left: this.x - this.width / 2, top: this.groundY - this.height, right: this.x + this.width / 2, bottom: this.groundY }
  }

  /** Sword attack reach rectangle, facing in the current direction. */
  get attackHitbox(): RectF {
    const reach = 54
    return this.isFacingRight
      ? { left: this.x, top: this.groundY - this.height * 0.85, right: this.x + reach, bottom: this.groundY - this.height * 0.1 }
      : { left: this.x - reach, top: this.groundY - this.height * 0.85, right: this.x, bottom: this.groundY - this.height * 0.1 }
  }

  setMovementInput(horizontal: number): void {
    this.inputMoveX = Math.min(1, Math.max(-1, horizontal))
    if (Math.abs(this.inputMoveX) > 0.08 && this.canTurn()) {
      this.isFacingRight = this.inputMoveX > 0
    }
  }

  setBlockActive(active: boolean): void {
    this.isBlockInputActive = active
  }

  onJump(): boolean {
    if (!this.isGrounded || this.isAttacking() || this.dashTimer > 0) return false
    this.vy = this.jumpImpulse
    this.isGrounded = false
    this.animationSystem.playAction(PlayerAction.JUMP)
    return true
  }

  onDash(): boolean {
    if (this.dashTimer > 0 || this.stamina < 25 || this.isAttacking()) return false
    this.stamina -= 25
    this.dashTimer = this.dashDuration
    this.isInvulnerable = true
    this.animationSystem.playAction(PlayerAction.DASH, true)
    return true
  }

  onAttack(): boolean {
    if (this.dashTimer > 0 || !this.isGrounded) return false
    this.attackHitboxProcessed = false
    const switched = this.animationSystem.playAction(PlayerAction.ATTACK, true)
    if (switched) this.vx = this.isFacingRight ? 40 : -40 // slight forward lunge
    return switched
  }

  onHeavyAttack(): boolean {
    if (this.dashTimer > 0 || !this.isGrounded || this.stamina < 20) return false
    this.stamina -= 20
    this.heavyAttackHitboxProcessed = false
    const switched = this.animationSystem.playAction(PlayerAction.HEAVY_ATTACK, true)
    if (switched) this.vx = 0
    return switched
  }

  onHurt(damage: number): boolean {
    if (this.isInvulnerable || this.hp <= 0) return false
    if (this.isBlocking && this.stamina >= 10) {
      // Block deflecting
      this.stamina -= 15
      this.hp -= Math.trunc(damage * 0.2)
      return false // Deflected!
    }
    this.hp = Math.max(0, this.hp - damage)
    if (this.hp <= 0) {
      this.animationSystem.playAction(PlayerAction.DEATH)
    } else {
      this.animationSystem.playAction(PlayerAction.HURT, true)
    }
    return true
  }

  resetPlayer(spawnX: number, spawnGroundY: number): void {
    this.x = spawnX
    this.groundY = spawnGroundY
    this.vx = 0
    this.vy = 0
    this.hp = this.maxHp
    this.stamina = this.maxStamina
    this.isGrounded = true
    this.isFacingRight = true
    this.dashTimer = 0
    this.isInvulnerable = false
    this.isBlocking = false
    this.animationSystem.playAction(PlayerAction.IDLE, true)
  }

  update(dt: number, worldMinX: number, worldMaxX: number, floorY: number): void {
    // Regenerate stamina
    if (!this.isBlocking) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 20 * dt)
    }

    // Handle dash state
    if (this.dashTimer > 0) {
      this.dashTimer -= dt
      this.vx = this.isFacingRight ? this.dashSpeed : -this.dashSpeed
      if (this.dashTimer <= 0) {
        this.isInvulnerable = false
      }
    } else if (this.isAttacking()) {
      // Decelerate during attack animations
      this.vx *= 0.8
    } else if (this.isBlockInputActive && this.isGrounded) {
      this.isBlocking = true
      this.vx = 0
    } else {
      this.isBlocking = false
      // Normal horizontal movement
      this.vx = Math.abs(this.inputMoveX) > 0.08 ? this.inputMoveX * this.walkSpeed : 0
    }

    // Apply horizontal motion
    this.x += this.vx * dt
    this.x = Math.min(Math.max(this.x, worldMinX + this.width / 2), worldMaxX - this.width / 2)

    // Apply gravity & vertical motion
    if (!this.isGrounded) {
      this.vy += this.gravity * dt
      this.groundY += this.vy * dt
      if (this.groundY >= floorY) {
        this.groundY = floorY
        this.vy = 0
        this.isGrounded = true
      }
    }

    // Advance animation system clock, then resolve the animation state machine.
    this.animationSystem.update(dt)
    this.updateAnimationState()
  }

  /**
   * Determines which animation should be active based on physics and action states.
   * Crucially: avoids restarting animation every frame when remaining in the same state.
   */
  private updateAnimationState(): void {
    if (this.hp <= 0) {
      this.animationSystem.playAction(PlayerAction.DEATH)
      return
    }

    // If currently playing a non-looping action, let it finish uninterrupted.
    const current = this.animationSystem.currentAction
    if (
      current === PlayerAction.ATTACK ||
      current === PlayerAction.HEAVY_ATTACK ||
      current === PlayerAction.DASH ||
      current === PlayerAction.HURT
    ) {
      if (!this.animationSystem.isFinished) {
        return
      }
    }

    if (this.isBlocking) {
      this.animationSystem.playAction(PlayerAction.BLOCK)
      return
    }

    if (!this.isGrounded) {
      this.animationSystem.playAction(PlayerAction.JUMP)
      return
    }

    if (Math.abs(this.vx) > 10 || Math.abs(this.inputMoveX) > 0.08) {
      this.animationSystem.playAction(PlayerAction.WALK)
      return
    }

    // Stopped: smoothly return to IDLE
    this.animationSystem.playAction(PlayerAction.IDLE)
  }

  isAttacking(): boolean {
    const a = this.animationSystem.currentAction
    return (a === PlayerAction.ATTACK || a === PlayerAction.HEAVY_ATTACK) && !this.animationSystem.isFinished
  }

  private canTurn(): boolean {
    return !this.isAttacking() && this.dashTimer <= 0
  }

  /** True exactly once, when the attack reaches its active damage frame. */
  shouldCheckAttackHit(): boolean {
    if (this.animationSystem.currentAction === PlayerAction.ATTACK) {
      const frame = this.animationSystem.currentFrameIndex
      if (frame >= 3 && frame <= 5 && !this.attackHitboxProcessed) {
        this.attackHitboxProcessed = true
        return true
      }
    }
    return false
  }

  shouldCheckHeavyAttackHit(): boolean {
    if (this.animationSystem.currentAction === PlayerAction.HEAVY_ATTACK) {
      const frame = this.animationSystem.currentFrameIndex
      if (frame >= 4 && frame <= 7 && !this.heavyAttackHitboxProcessed) {
        this.heavyAttackHitboxProcessed = true
        return true
      }
    }
    return false
  }
}
