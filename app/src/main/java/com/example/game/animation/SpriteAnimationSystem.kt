package com.example.game.animation

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF

/**
 * Reusable 2D Sprite Animation System.
 *
 * Responsibilities:
 * - Manages sprite sheets for all player actions.
 * - Manages playback time and computes current frame index.
 * - Prevents restarting animations on every game frame.
 * - Handles priority and state transitions.
 * - Renders frames with nearest-neighbor filtering and horizontal flipping.
 */
class SpriteAnimationSystem(
    private val context: Context,
    configs: Map<PlayerAction, AnimationConfig> = DefaultAnimationConfigs.createDefaults()
) {
    private val sheets: MutableMap<PlayerAction, SpriteSheet> = mutableMapOf()
    private val activeConfigs: MutableMap<PlayerAction, AnimationConfig> = configs.toMutableMap()

    // State tracking
    var currentAction: PlayerAction = PlayerAction.IDLE
        private set

    var currentFrameIndex: Int = 0
        private set

    var elapsedTimeSeconds: Float = 0f
        private set

    var isFinished: Boolean = false
        private set

    // Destination rect buffer to avoid allocations in draw loop
    private val destRect = RectF()

    init {
        reloadAll()
    }

    /**
     * Loads or reloads all sprite sheets according to activeConfigs.
     */
    fun reloadAll() {
        sheets.clear()
        for ((action, config) in activeConfigs) {
            val sheet = SpriteSheet.load(context, config)
            if (sheet != null) {
                sheets[action] = sheet
            }
        }
    }

    /**
     * Updates an animation's configuration at runtime (e.g. FPS or frame count).
     */
    fun updateConfig(config: AnimationConfig) {
        activeConfigs[config.action] = config
        val sheet = SpriteSheet.load(context, config)
        if (sheet != null) {
            sheets[config.action] = sheet
        }
    }

    fun getConfig(action: PlayerAction): AnimationConfig? = activeConfigs[action]

    fun getSheet(action: PlayerAction): SpriteSheet? = sheets[action]

    fun getAllActions(): List<PlayerAction> = PlayerAction.entries

    /**
     * Requests an action transition.
     *
     * Rule: Does NOT restart the animation if the action is already active,
     * unless explicitly forced by [restartIfSame].
     */
    fun playAction(newAction: PlayerAction, restartIfSame: Boolean = false): Boolean {
        if (currentAction == newAction && !restartIfSame) {
            return false // Already playing, do not restart every frame!
        }

        // Respect priority: higher priority action cannot be interrupted unless finished
        // Base locomotion states (IDLE and WALK) can freely transition
        val isLocomotion = (currentAction == PlayerAction.IDLE || currentAction == PlayerAction.WALK) &&
                (newAction == PlayerAction.IDLE || newAction == PlayerAction.WALK)

        val currentConfig = activeConfigs[currentAction]
        val newConfig = activeConfigs[newAction]

        if (!isFinished && !isLocomotion && currentConfig != null && newConfig != null) {
            if (newConfig.priority < currentConfig.priority) {
                return false
            }
        }

        currentAction = newAction
        elapsedTimeSeconds = 0f
        currentFrameIndex = 0
        isFinished = false
        return true
    }

    /**
     * Progresses animation time. Call once per game tick.
     */
    fun update(deltaTimeSeconds: Float) {
        val sheet = sheets[currentAction] ?: return
        val config = activeConfigs[currentAction] ?: sheet.config

        elapsedTimeSeconds += deltaTimeSeconds
        val totalFrames = sheet.frameCount
        val fps = config.fps.coerceAtLeast(1)

        val rawFrame = (elapsedTimeSeconds * fps).toInt()

        if (config.loop) {
            currentFrameIndex = if (totalFrames > 0) rawFrame % totalFrames else 0
            isFinished = false
        } else {
            if (rawFrame >= totalFrames - 1) {
                currentFrameIndex = (totalFrames - 1).coerceAtLeast(0)
                isFinished = true
            } else {
                currentFrameIndex = rawFrame
                isFinished = false
            }
        }
    }

    /**
     * Renders the current sprite frame onto the canvas.
     *
     * @param canvas Android graphics canvas.
     * @param centerX World X position of character base.
     * @param bottomY World Y position of character feet.
     * @param displayWidth Rendered width in logical pixels.
     * @param displayHeight Rendered height in logical pixels.
     * @param isFacingRight If false, flips the sprite horizontally using canvas matrix.
     * @param paint Pre-configured paint with nearest-neighbor filtering (isFilterBitmap = false).
     */
    fun render(
        canvas: Canvas,
        centerX: Float,
        bottomY: Float,
        displayWidth: Float,
        displayHeight: Float,
        isFacingRight: Boolean,
        paint: Paint
    ) {
        val sheet = sheets[currentAction] ?: sheets[PlayerAction.IDLE] ?: return
        val srcRect = sheet.getFrameRect(currentFrameIndex)

        canvas.save()

        // Flip horizontally around the character's horizontal center if facing left
        if (!isFacingRight) {
            canvas.scale(-1f, 1f, centerX, bottomY)
        }

        val left = centerX - (displayWidth / 2f)
        val top = bottomY - displayHeight
        val right = left + displayWidth
        val bottom = bottomY

        destRect.set(left, top, right, bottom)
        canvas.drawBitmap(sheet.bitmap, srcRect, destRect, paint)

        canvas.restore()
    }
}
