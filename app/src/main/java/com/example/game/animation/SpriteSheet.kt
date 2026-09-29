package com.example.game.animation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Log

/**
 * Encapsulates a loaded sprite sheet bitmap and its frame slices.
 *
 * Two layouts are supported. A strip sheet (idle, walk, jump) is a single row of
 * square cells. A grid sheet (attack) declares its cell size and column count in
 * [AnimationConfig] and is addressed row-major, wrapping onto the next row at
 * [columns].
 */
class SpriteSheet(
    val action: PlayerAction,
    val bitmap: Bitmap,
    val frameCount: Int,
    val frameWidth: Int,
    val frameHeight: Int,
    val columns: Int,
    val cellHeight: Int,
    val displayScale: Float,
    val config: AnimationConfig
) {
    private val frameRects: Array<Rect> = Array(frameCount) { index ->
        val col = index % columns
        val row = index / columns
        val sx = col * frameWidth
        val sy = row * cellHeight
        Rect(sx, sy, sx + frameWidth, sy + cellHeight)
    }

    fun getFrameRect(frameIndex: Int): Rect {
        val clamped = frameIndex.coerceIn(0, frameCount - 1)
        return frameRects[clamped]
    }

    /**
     * Bottom-most opaque source row of a frame. The sprite cells are not filled to the
     * bottom edge, and the walk cycle's contact row drifts by a few rows, so this is
     * read per frame rather than baked into a single constant. Frames with no measured
     * row fall back to the idle rest pose.
     */
    fun footRowForFrame(frameIndex: Int): Int {
        val clamped = frameIndex.coerceIn(0, frameCount - 1)
        return config.footRows.getOrNull(clamped) ?: SpriteMetrics.DEFAULT_FOOT_ROW
    }

    companion object {
        private const val TAG = "SpriteSheet"

        /**
         * Loads a sprite sheet from Android assets or drawable resources and derives
         * its cell geometry. A config without [AnimationConfig.cellSize] is treated as
         * a single row of square cells; one with it is treated as a grid, with the
         * row count following from the bitmap's height.
         */
        fun load(context: Context, config: AnimationConfig): SpriteSheet? {
            val bitmap = loadBitmap(context, config.sourceFileName)
            if (bitmap == null) {
                Log.w(TAG, "Unable to load bitmap for file: ${config.sourceFileName}")
                return null
            }

            // Two layouts. Without a configured cell size the sheet is a single row
            // of square cells, so the cell side is the bitmap height and the frame
            // count follows from the width. With one, the sheet is a grid (attack:
            // 4 columns of 256px cells) and the row count follows from the height.
            val cellSide = (config.cellSize ?: bitmap.height).coerceAtLeast(1)
            val inferredColumns = (bitmap.width / cellSide).coerceAtLeast(1)
            val columns = (config.columns ?: inferredColumns).coerceAtLeast(1)
            val rows = if (config.cellSize != null) (bitmap.height / cellSide).coerceAtLeast(1) else 1
            val available = columns * rows
            val validFrameCount = (config.frameCount ?: available).coerceIn(1, available)
            val fWidth = (bitmap.width / columns).coerceAtLeast(1)

            Log.i(
                TAG,
                "Loaded ${config.action}: file=${config.sourceFileName}, " +
                        "dimensions=${bitmap.width}x${bitmap.height}, " +
                        "frames=$validFrameCount, frameSize=${fWidth}x${cellSide}, " +
                        "columns=$columns, scale=${config.displayScale}, " +
                        "fps=${config.fps}, loop=${config.loop}"
            )

            return SpriteSheet(
                action = config.action,
                bitmap = bitmap,
                frameCount = validFrameCount,
                frameWidth = fWidth,
                frameHeight = cellSide,
                columns = columns,
                cellHeight = cellSide,
                displayScale = config.displayScale,
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
