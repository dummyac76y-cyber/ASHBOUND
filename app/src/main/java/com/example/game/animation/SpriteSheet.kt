package com.example.game.animation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Log

/**
 * Encapsulates a loaded sprite sheet bitmap and its horizontal frame slices.
 */
class SpriteSheet(
    val action: PlayerAction,
    val bitmap: Bitmap,
    val frameCount: Int,
    val frameWidth: Int,
    val frameHeight: Int,
    val config: AnimationConfig
) {
    private val frameRects: Array<Rect> = Array(frameCount) { index ->
        Rect(index * frameWidth, 0, (index + 1) * frameWidth, frameHeight)
    }

    fun getFrameRect(frameIndex: Int): Rect {
        val clamped = frameIndex.coerceIn(0, frameCount - 1)
        return frameRects[clamped]
    }

    companion object {
        private const val TAG = "SpriteSheet"

        /**
         * Loads a sprite sheet from Android assets or drawable resources.
         * If frameCount is null in the config, it automatically determines frame count
         * by dividing the bitmap's width by its height.
         */
        fun load(context: Context, config: AnimationConfig): SpriteSheet? {
            val bitmap = loadBitmap(context, config.sourceFileName)
            if (bitmap == null) {
                Log.w(TAG, "Unable to load bitmap for file: ${config.sourceFileName}")
                return null
            }

            // Automatic layout detection if frameCount is not explicitly set
            val detectedFrameCount = config.frameCount ?: run {
                val ratio = if (bitmap.height > 0) bitmap.width / bitmap.height else 1
                ratio.coerceAtLeast(1)
            }

            val validFrameCount = detectedFrameCount.coerceAtLeast(1)
            val fWidth = (bitmap.width / validFrameCount).coerceAtLeast(1)
            val fHeight = bitmap.height.coerceAtLeast(1)

            Log.i(
                TAG,
                "Loaded ${config.action}: file=${config.sourceFileName}, " +
                        "dimensions=${bitmap.width}x${bitmap.height}, " +
                        "frames=$validFrameCount, frameSize=${fWidth}x${fHeight}, " +
                        "fps=${config.fps}, loop=${config.loop}"
            )

            return SpriteSheet(
                action = config.action,
                bitmap = bitmap,
                frameCount = validFrameCount,
                frameWidth = fWidth,
                frameHeight = fHeight,
                config = config
            )
        }

        private fun loadBitmap(context: Context, filename: String): Bitmap? {
            val options = BitmapFactory.Options().apply {
                inScaled = false // Crucial for pixel-art: prevents density resizing
            }

            // 1. Try loading from assets/sprites/
            try {
                val assetPath = "sprites/$filename"
                context.assets.open(assetPath).use { stream ->
                    val bm = BitmapFactory.decodeStream(stream, null, options)
                    if (bm != null) return bm
                }
            } catch (_: Exception) {
                // Asset not found, fall back to drawable
            }

            // 2. Try loading from root assets/
            try {
                context.assets.open(filename).use { stream ->
                    val bm = BitmapFactory.decodeStream(stream, null, options)
                    if (bm != null) return bm
                }
            } catch (_: Exception) {
                // Not found
            }

            // 3. Try loading from res/drawable/<nameWithoutExtension>
            try {
                val resName = filename.substringBeforeLast(".")
                val resId = context.resources.getIdentifier(resName, "drawable", context.packageName)
                if (resId != 0) {
                    val bm = BitmapFactory.decodeResource(context.resources, resId, options)
                    if (bm != null) return bm
                }
            } catch (_: Exception) {
                // Not found
            }

            return null
        }
    }
}
