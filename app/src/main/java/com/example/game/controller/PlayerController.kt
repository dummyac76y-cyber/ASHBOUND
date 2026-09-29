package com.example.game.controller

import android.graphics.RectF
import com.example.game.animation.PlayerAction
import com.example.game.animation.SpriteAnimationSystem
import kotlin.math.abs

/**
 * Controller connecting player physics, state machine, and SpriteAnimationSystem.
 * Decoupled from input mechanisms (touch, joystick, keyboard).
 */
class PlayerController(
    val animationSystem: SpriteAnimationSystem,
    var x: Float = 200f,
    var groundY: Float = 260f
) {
    // Spatial dimensions
    val width: Float = 44f
    val height: Float = 70f

    // Motion physics
    var vx: Float = 0f
    var vy: Float = 0f
    var isGrounded: Boolean = true
    var isFacingRight: Boolean = true

    // Combat Stats
    var maxHp: Int = 100
    var hp: Int = 100
    var maxStamina: Float = 100f
    var stamina: Float = 100f
    var isInvulnerable: Boolean = false
    var isBlocking: Boolean = false

    // Constants
    private val walkSpeed: Float = 150f
    private val jumpImpulse: Float = -360f
    private val gravity: Float = 880f
    private val dashSpeed: Float = 380f
    private val dashDuration: Float = 0.22f

    // Internal state timers
    private var dashTimer: Float = 0f
    private var attackHitboxProcessed: Boolean = false
    private var heavyAttackHitboxProcessed: Boolean = false

    // Input buffer
    private var inputMoveX: Float = 0f
    private var isBlockInputActive: Boolean = false

    /**
     * Hitbox for damage detection.
     */
    val hitbox: RectF
        get() = RectF(x - width / 2f, groundY - height, x + width / 2f, groundY)

    /**
     * Sword attack reach rectangle facing in the current direction.
     */
    val attackHitbox: RectF
        get() {
            val reach = 54f
            return if (isFacingRight) {
                RectF(x, groundY - height * 0.85f, x + reach, groundY - height * 0.1f)
            } else {
                RectF(x - reach, groundY - height * 0.85f, x, groundY - height * 0.1f)
            }
        }

    fun setMovementInput(horizontal: Float) {
        inputMoveX = horizontal.coerceIn(-1f, 1f)
        if (abs(inputMoveX) > 0.08f && canTurn()) {
            isFacingRight = inputMoveX > 0f
        }
    }

    fun setBlockActive(active: Boolean) {
        isBlockInputActive = active
    }

    fun onJump(): Boolean {
        if (!isGrounded || isAttacking() || dashTimer > 0) return false
        vy = jumpImpulse
        isGrounded = false
        animationSystem.playAction(PlayerAction.JUMP)
        return true
    }

    fun onDash(): Boolean {
        if (dashTimer > 0 || stamina < 25f || isAttacking()) return false
        stamina -= 25f
        dashTimer = dashDuration
        isInvulnerable = true
        animationSystem.playAction(PlayerAction.DASH, restartIfSame = true)
        return true
    }

    fun onAttack(): Boolean {
        if (dashTimer > 0 || !isGrounded) return false
        attackHitboxProcessed = false
        val switched = animationSystem.playAction(PlayerAction.ATTACK, restartIfSame = true)
        if (switched) vx = (if (isFacingRight) 40f else -40f) // slight forward lunge
        return switched
    }

    fun onHeavyAttack(): Boolean {
        if (dashTimer > 0 || !isGrounded || stamina < 20f) return false
        stamina -= 20f
        heavyAttackHitboxProcessed = false
        val switched = animationSystem.playAction(PlayerAction.HEAVY_ATTACK, restartIfSame = true)
        if (switched) vx = 0f
        return switched
    }

    fun onHurt(damage: Int): Boolean {
        if (isInvulnerable || hp <= 0) return false
        if (isBlocking && stamina >= 10f) {
            // Block deflecting
            stamina -= 15f
            hp -= (damage * 0.2f).toInt()
            return false // Deflected!
        }
        hp = (hp - damage).coerceAtLeast(0)
        if (hp <= 0) {
            animationSystem.playAction(PlayerAction.DEATH)
        } else {
            animationSystem.playAction(PlayerAction.HURT, restartIfSame = true)
        }
        return true
    }

    fun resetPlayer(spawnX: Float, spawnGroundY: Float) {
        x = spawnX
        groundY = spawnGroundY
        vx = 0f
        vy = 0f
        hp = maxHp
        stamina = maxStamina
        isGrounded = true
        isFacingRight = true
        dashTimer = 0f
        isInvulnerable = false
        isBlocking = false
        animationSystem.playAction(PlayerAction.IDLE, restartIfSame = true)
    }

    fun update(dt: Float, worldMinX: Float, worldMaxX: Float, floorY: Float) {
        // Regenerate stamina
        if (!isBlocking) {
            stamina = (stamina + 20f * dt).coerceAtMost(maxStamina)
        }

        // Handle dash state
        if (dashTimer > 0) {
            dashTimer -= dt
            vx = if (isFacingRight) dashSpeed else -dashSpeed
            if (dashTimer <= 0) {
                isInvulnerable = false
            }
        } else if (isAttacking()) {
            // Decelerate during attack animations
            vx *= 0.8f
        } else if (isBlockInputActive && isGrounded) {
            isBlocking = true
            vx = 0f
        } else {
            isBlocking = false
            // Normal horizontal movement
            if (abs(inputMoveX) > 0.08f) {
                vx = inputMoveX * walkSpeed
            } else {
                vx = 0f
            }
        }

        // Apply horizontal motion
        x += vx * dt
        x = x.coerceIn(worldMinX + width / 2f, worldMaxX - width / 2f)

        // Apply gravity & vertical motion
        if (!isGrounded) {
            vy += gravity * dt
            groundY += vy * dt
            if (groundY >= floorY) {
                groundY = floorY
                vy = 0f
                isGrounded = true
            }
        }

        // Advance animation system clock
        animationSystem.update(dt)

        // Update animation state machine
        updateAnimationState()
    }

    /**
     * Determines which animation should be active based on physics and action states.
     * Crucially: avoids restarting animation every frame when remaining in the same state.
     */
    private fun updateAnimationState() {
        if (hp <= 0) {
            animationSystem.playAction(PlayerAction.DEATH)
            return
        }

        // If currently playing a non-looping action (Attack, Heavy Attack, Dash, Hurt)
        val current = animationSystem.currentAction
        if (current == PlayerAction.ATTACK || current == PlayerAction.HEAVY_ATTACK ||
            current == PlayerAction.DASH || current == PlayerAction.HURT
        ) {
            if (!animationSystem.isFinished) {
                return // Let the active combat animation play its frames without interruption
            }
        }

        // Blocking stance
        if (isBlocking) {
            animationSystem.playAction(PlayerAction.BLOCK)
            return
        }

        // In air / jumping
        if (!isGrounded) {
            animationSystem.playAction(PlayerAction.JUMP)
            return
        }

        // Moving left or right
        if (abs(vx) > 10f || abs(inputMoveX) > 0.08f) {
            animationSystem.playAction(PlayerAction.WALK)
            return
        }

        // Stopped: smoothly return to IDLE
        animationSystem.playAction(PlayerAction.IDLE)
    }

    fun isAttacking(): Boolean {
        val a = animationSystem.currentAction
        return (a == PlayerAction.ATTACK || a == PlayerAction.HEAVY_ATTACK) && !animationSystem.isFinished
    }

    private fun canTurn(): Boolean {
        return !isAttacking() && dashTimer <= 0
    }

    /**
     * Checks if the attack has reached its active damage frame.
     */
    fun shouldCheckAttackHit(): Boolean {
        if (animationSystem.currentAction == PlayerAction.ATTACK) {
            val frame = animationSystem.currentFrameIndex
            if (frame in 3..5 && !attackHitboxProcessed) {
                attackHitboxProcessed = true
                return true
            }
        }
        return false
    }

    fun shouldCheckHeavyAttackHit(): Boolean {
        if (animationSystem.currentAction == PlayerAction.HEAVY_ATTACK) {
            val frame = animationSystem.currentFrameIndex
            if (frame in 4..7 && !heavyAttackHitboxProcessed) {
                heavyAttackHitboxProcessed = true
                return true
            }
        }
        return false
    }
}
