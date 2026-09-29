package com.example.game.animation

/**
 * Modular animation configuration for a 2D sprite action.
 *
 * @param action PlayerAction associated with this animation.
 * @param sourceFileName Name of the sprite sheet file in assets/sprites/ (e.g. "idle.png").
 * @param frameCount Total frames in sprite sheet. If null, automatically determined by width / height.
 * @param fps Target playback speed in frames per second.
 * @param loop Whether the animation loops continuously or stops at the final frame.
 * @param priority Higher priority actions cannot be interrupted by lower priority actions.
 * @param canBeCancelledByMovement Whether user movement immediately cancels this animation back to WALK.
 */
data class AnimationConfig(
    val action: PlayerAction,
    val sourceFileName: String,
    val frameCount: Int? = null,
    val fps: Int = 12,
    val loop: Boolean = true,
    val priority: Int = 0,
    val canBeCancelledByMovement: Boolean = true
)

object DefaultAnimationConfigs {
    /**
     * Standard animation mapping for the Exiled Knight character.
     * Frame counts match the provided sprite sheets (12 frames for idle, 12 for walk).
     * If new assets such as attack.png or death.png are introduced, they can be configured here.
     */
    fun createDefaults(): Map<PlayerAction, AnimationConfig> = mapOf(
        PlayerAction.IDLE to AnimationConfig(
            action = PlayerAction.IDLE,
            sourceFileName = "idle.png",
            frameCount = 12,
            fps = 10,
            loop = true,
            priority = 0,
            canBeCancelledByMovement = true
        ),
        PlayerAction.WALK to AnimationConfig(
            action = PlayerAction.WALK,
            sourceFileName = "walk.png",
            frameCount = 12,
            fps = 12,
            loop = true,
            priority = 1,
            canBeCancelledByMovement = true
        ),
        PlayerAction.ATTACK to AnimationConfig(
            action = PlayerAction.ATTACK,
            sourceFileName = "attack.png",
            frameCount = 8,
            fps = 16,
            loop = false,
            priority = 3,
            canBeCancelledByMovement = false
        ),
        PlayerAction.HEAVY_ATTACK to AnimationConfig(
            action = PlayerAction.HEAVY_ATTACK,
            sourceFileName = "heavy_attack.png",
            frameCount = 10,
            fps = 14,
            loop = false,
            priority = 4,
            canBeCancelledByMovement = false
        ),
        PlayerAction.BLOCK to AnimationConfig(
            action = PlayerAction.BLOCK,
            sourceFileName = "block.png",
            frameCount = 6,
            fps = 12,
            loop = true,
            priority = 2,
            canBeCancelledByMovement = true
        ),
        PlayerAction.DASH to AnimationConfig(
            action = PlayerAction.DASH,
            sourceFileName = "dash.png",
            frameCount = 6,
            fps = 15,
            loop = false,
            priority = 5,
            canBeCancelledByMovement = false
        ),
        PlayerAction.JUMP to AnimationConfig(
            action = PlayerAction.JUMP,
            sourceFileName = "walk.png",
            frameCount = 12,
            fps = 8,
            loop = false,
            priority = 1,
            canBeCancelledByMovement = true
        ),
        PlayerAction.HURT to AnimationConfig(
            action = PlayerAction.HURT,
            sourceFileName = "hurt.png",
            frameCount = 4,
            fps = 12,
            loop = false,
            priority = 6,
            canBeCancelledByMovement = false
        ),
        PlayerAction.DEATH to AnimationConfig(
            action = PlayerAction.DEATH,
            sourceFileName = "death.png",
            frameCount = 8,
            fps = 8,
            loop = false,
            priority = 10,
            canBeCancelledByMovement = false
        )
    )
}
