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
 * @param footRows Bottom-most opaque source row per frame, in the same order as the sheet's
 *   frames. Defaults to the measured data for [sourceFileName]; frames beyond the list fall
 *   back to the rest-pose row. This is what keeps the visible feet on the floor when the
 *   art is not bottom-aligned.
 * @param columns Cells per row, for sheets packed as a grid. Null means a single strip.
 * @param cellSize Native cell side in source pixels, for grid-packed sheets. Null means the
 *   sheet is a strip of square cells as wide as it is tall.
 * @param displayScale On-screen size multiplier, used to keep a grid-packed sheet's
 *   character the same on-screen size as the strip sheets.
 * @param hitFrames First and last frame of the window in which the attack is live, as
 *   [first, last] inclusive, or null for a sheet that deals no damage. Damage is dealt
 *   when the animation enters this window rather than on the input frame, so the hit
 *   lands while the blade is actually out. Measured from the artwork by finding where
 *   the sword reaches furthest from the body.
 */
data class AnimationConfig(
    val action: PlayerAction,
    val sourceFileName: String,
    val frameCount: Int? = null,
    val fps: Int = 12,
    val loop: Boolean = true,
    val priority: Int = 0,
    val canBeCancelledByMovement: Boolean = true,
    val footRows: List<Int> = SpriteMetrics.footRowsFor(sourceFileName),
    val columns: Int? = null,
    val cellSize: Int? = null,
    val displayScale: Float = 1f,
    val hitFrames: List<Int>? = null
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
            canBeCancelledByMovement = true,
            // walk.png draws its character slightly smaller than idle.png does.
            displayScale = 1.091f
        ),
        PlayerAction.ATTACK to AnimationConfig(
            action = PlayerAction.ATTACK,
            sourceFileName = "attack.png",
            frameCount = 16,
            fps = 24,
            loop = false,
            priority = 3,
            canBeCancelledByMovement = false,
            // Packed as a 4x4 grid of 256px cells rather than a strip of 128px
            // ones, so the cell geometry is declared explicitly. displayScale
            // keeps the character the same on-screen size as the strip sheets.
            // The blade is furthest out on frames 8 and 9 and stays out through
            // 11, so that is the window in which the hit is live.
            columns = 4,
            cellSize = 256,
            displayScale = 1.461f,
            hitFrames = listOf(8, 11)
        ),
        PlayerAction.HEAVY_ATTACK to AnimationConfig(
            action = PlayerAction.HEAVY_ATTACK,
            sourceFileName = "heavy_attack.png",
            frameCount = 25,
            fps = 20,
            loop = false,
            priority = 4,
            canBeCancelledByMovement = false,
            // Packed as a 5x5 grid of 256px cells rather than a strip of 128px
            // ones, so the cell geometry is declared explicitly. The long windup
            // occupies frames 0..13; the blade first reaches full extension on
            // frame 14 and is still out through 19.
            columns = 5,
            cellSize = 256,
            displayScale = 1.569f,
            hitFrames = listOf(14, 18)
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
            sourceFileName = "jump.png",
            frameCount = 10,
            fps = 12,
            loop = false,
            priority = 1,
            canBeCancelledByMovement = true,
            // jump.png draws its character larger than idle.png does.
            displayScale = 0.918f
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
