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
    val hitFrames: List<Int>? = null,
    /**
     * Plays the sheet forwards and then backwards, ending on the frame it started from.
     *
     * For a one-shot whose last frame is not the rest pose. A sheet drawn as an out-and-back
     * gesture -- leaning, settling, glancing -- reads correctly forwards and then sits on its
     * final frame, which is not where the character was before it started. Snapping back to the
     * idle pose at that point is a visible pop on the one animation whose entire job is to look
     * incidental. Returning along the same frames is what makes it settle instead.
     *
     * The endpoints are not doubled: the turnaround frame is held, not repeated, so the motion
     * pauses for exactly one frame at the extreme the way a hand reverses, and an 8-frame sheet
     * takes 15 frames to come back rather than 16.
     */
    val pingPong: Boolean = false
)

object DefaultAnimationConfigs {
    /**
     * Standard animation mapping for the Exiled Knight character.
     * Frame counts match the provided sprite sheets (6 frames for idle, 12 for walk).
     * If new assets such as death.png are introduced, they can be configured here.
     */
    fun createDefaults(): Map<PlayerAction, AnimationConfig> = mapOf(
        PlayerAction.IDLE to AnimationConfig(
            action = PlayerAction.IDLE,
            sourceFileName = "idle.png",
            frameCount = 6,
            fps = 5,
            loop = true,
            priority = 0,
            canBeCancelledByMovement = true,
            // idle.png draws its character a little smaller than the previous
            // sheet did, so it is scaled up to keep rendering at the size every
            // other sheet is calibrated against.
            displayScale = 1.063f
        ),
        // idle_variant.png is 8 frames of the 128px strip, played at random while the player
        // stands still. It is ping-ponged because its last frame is not the rest pose -- it is
        // measured to draw the character taller (111px median against idle's 97), so it is
        // standing up out of whatever it was doing, and stopping there would leave it stuck half
        // way up until the next action interrupted it.
        //
        // displayScale is idle's 1.063 scaled by the ratio of the two median heights, 97/111, so
        // this sheet's character occupies the same on-screen box as idle's. Using its own numbers
        // rather than copying idle's is what stops the character popping in size on a random
        // animation; verified against rendered pixels by scripts/verify-attack.mjs.
        PlayerAction.IDLE_VARIANT to AnimationConfig(
            action = PlayerAction.IDLE_VARIANT,
            sourceFileName = "idle_variant.png",
            frameCount = 8,
            fps = 12,
            loop = false,
            priority = 0,
            canBeCancelledByMovement = true,
            displayScale = 0.929f,
            pingPong = true
        ),
        PlayerAction.WALK to AnimationConfig(
            action = PlayerAction.WALK,
            sourceFileName = "walk.png",
            frameCount = 12,
            fps = 12,
            loop = true,
            priority = 1,
            canBeCancelledByMovement = true,
            // walk.png draws its character slightly smaller than idle.png does, and
            // is scaled down a little further than that correction alone, so the
            // walk cycle reads as lower and lighter than standing still.
            displayScale = 1.05f
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
            // frame 14 and is still out through 19. Scaled a little past the size
            // every other sheet renders at, so the heavy swing reads as more weight.
            columns = 5,
            cellSize = 256,
            displayScale = 1.78f,
            hitFrames = listOf(14, 18)
        ),
        // block.png is 8 frames of the 128px strip. It plays once and holds the
        // last frame, so the guard settles into a stance instead of cycling; a
        // looping guard visibly pulses for as long as it is held. It draws the
        // character slightly taller than idle.png, so it scales down to match, and
        // every frame plants its feet on the same row.
        PlayerAction.BLOCK to AnimationConfig(
            action = PlayerAction.BLOCK,
            sourceFileName = "block.png",
            frameCount = 8,
            fps = 12,
            loop = false,
            priority = 2,
            canBeCancelledByMovement = true,
            displayScale = 1.031f
        ),
        // These three have no art of their own yet, so they stand in on idle.png.
        // They must carry idle's scale or they would render at a different size.
        PlayerAction.DASH to AnimationConfig(
            action = PlayerAction.DASH,
            sourceFileName = "idle.png",
            frameCount = 6,
            fps = 15,
            loop = false,
            priority = 5,
            canBeCancelledByMovement = false,
            displayScale = 1.063f
        ),
        PlayerAction.JUMP to AnimationConfig(
            action = PlayerAction.JUMP,
            sourceFileName = "jump.png",
            frameCount = 8,
            fps = 10,
            loop = false,
            priority = 1,
            canBeCancelledByMovement = true,
            // The character compresses as it takes off rather than rising inside
            // the cell, so the whole sheet shares one foot row. This art draws the
            // character shorter than idle.png, so it scales up to match.
            displayScale = 1.069f
        ),
        PlayerAction.HURT to AnimationConfig(
            action = PlayerAction.HURT,
            sourceFileName = "idle.png",
            frameCount = 4,
            fps = 12,
            loop = false,
            priority = 6,
            canBeCancelledByMovement = false,
            displayScale = 1.063f
        ),
        PlayerAction.DEATH to AnimationConfig(
            action = PlayerAction.DEATH,
            sourceFileName = "idle.png",
            frameCount = 6,
            fps = 8,
            loop = false,
            priority = 10,
            canBeCancelledByMovement = false,
            displayScale = 1.063f
        )
    )
}
