package com.example.game.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.util.Log
import com.example.game.animation.DefaultAnimationConfigs
import com.example.game.animation.PlayerAction
import com.example.game.animation.SpriteAnimationSystem
import com.example.game.controller.PlayerController
import com.example.game.model.DamageText
import com.example.game.model.SparkParticle
import com.example.game.model.TrainingDummy
import kotlin.random.Random

/**
 * 2D Game World managing world bounds, logical resolution, arena scenery,
 * training combat targets, and particle systems.
 */
class GameWorld(val context: Context) {

    companion object {
        const val LOGICAL_WIDTH = 640f
        const val LOGICAL_HEIGHT = 360f
        const val WORLD_WIDTH = 1200f

        /**
         * Native pixel height of the arena backdrop (img_arena_bg_hd.png).
         * The backdrop is drawn scaled to fill LOGICAL_HEIGHT, so any row in the
         * artwork maps to logical Y via: row * LOGICAL_HEIGHT / this.
         */
        const val BACKGROUND_HEIGHT = 864f

        /**
         * Row of the visible stone floor surface, measured from the backdrop artwork.
         *
         * The floor is a hard horizontal edge running the full width of the image:
         * a dark ledge seam at row 618 (168/192 sampled columns agree) with the lit
         * flagstone surface starting at row 620 (111/158 columns; the remainder are
         * pillars and props occluding the edge). There is no perspective slope, so a
         * single world-space plane is exact across the whole arena.
         */
        const val BACKGROUND_FLOOR_ROW = 620f

        /**
         * World-space ground / collision plane, in logical pixels.
         *
         * The player's feet rest exactly on this Y at all times, and it is the Y the
         * jump impulse starts from and gravity returns to. Derived from the backdrop
         * rather than guessed, so the knight stands on the drawn stone floor instead
         * of an arbitrary line near the bottom of the screen.
         */
        val FLOOR_Y: Float = BACKGROUND_FLOOR_ROW * (LOGICAL_HEIGHT / BACKGROUND_HEIGHT)

        /** Native height of one sprite sheet cell, in source pixels. */
        const val SPRITE_CELL_HEIGHT = 128f

        /**
         * Fully transparent rows below the character's feet inside a 128px cell.
         * Measured from the art: opaque content ends at row 111 in every frame of
         * both idle.png and walk.png, leaving 16 empty rows.
         */
        const val SPRITE_FOOT_PADDING = 16f

        /** Logical size a 128px sprite cell is drawn at. */
        const val SPRITE_DISPLAY_SIZE = 100f

        /**
         * How far below [FLOOR_Y] the sprite's draw-rect bottom must sit so that the
         * visible feet — not the transparent padding — land on the ground plane.
         * Without this the knight floats by this amount every frame.
         */
        val SPRITE_FOOT_OFFSET: Float = SPRITE_FOOT_PADDING / SPRITE_CELL_HEIGHT * SPRITE_DISPLAY_SIZE
    }

    val animationSystem = SpriteAnimationSystem(context, DefaultAnimationConfigs.createDefaults())
    val player = PlayerController(animationSystem, x = 300f, groundY = FLOOR_Y)

    // Interactive training dummy targets
    val dummies = listOf(
        TrainingDummy(x = 550f, groundY = FLOOR_Y),
        TrainingDummy(x = 850f, groundY = FLOOR_Y)
    )

    // Visual particle effects
    val damageTexts = mutableListOf<DamageText>()
    val particles = mutableListOf<SparkParticle>()

    // Arena background bitmap
    private var bgBitmap: Bitmap? = null

    // Nearest-neighbor rendering paint
    val pixelPaint = Paint().apply {
        isFilterBitmap = false // Strictly disable blurry bilinear interpolation!
        isDither = false
        isAntiAlias = false
    }

    val textPaint = Paint().apply {
        textSize = 14f
        isFakeBoldText = true
        isAntiAlias = true
    }

    // Camera view offset
    var cameraX: Float = 0f
        private set

    init {
        loadArenaBackground()
    }

    private fun loadArenaBackground() {
        // Prefer the high-res backdrop; fall back to the legacy jpg if it is absent.
        val names = listOf("img_arena_bg_hd", "img_arena_bg")
        for (name in names) {
            try {
                val resId = context.resources.getIdentifier(name, "drawable", context.packageName)
                if (resId != 0) {
                    val opts = BitmapFactory.Options().apply { inScaled = false }
                    val bitmap = BitmapFactory.decodeResource(context.resources, resId, opts)
                    if (bitmap != null) {
                        bgBitmap = bitmap
                        Log.i("GameWorld", "Arena background: $name (${bitmap.width}x${bitmap.height})")
                        return
                    }
                }
            } catch (_: Exception) {}
        }
        Log.w("GameWorld", "No arena background found; using the gradient fallback")
    }

    fun update(dt: Float) {
        val clampedDt = dt.coerceIn(0.001f, 0.05f)

        // Update player
        player.update(clampedDt, 0f, WORLD_WIDTH, FLOOR_Y)

        // Camera smoothly follows player within world bounds
        val targetCamX = (player.x - LOGICAL_WIDTH / 2f).coerceIn(0f, WORLD_WIDTH - LOGICAL_WIDTH)
        cameraX += (targetCamX - cameraX) * 0.15f

        // Check attack collisions
        if (player.shouldCheckAttackHit()) {
            performAttackHitCheck(damage = 18, isHeavy = false)
        }
        if (player.shouldCheckHeavyAttackHit()) {
            performAttackHitCheck(damage = 45, isHeavy = true)
        }

        // Update dummies
        for (dummy in dummies) {
            dummy.update(clampedDt)
        }

        // Update damage texts
        val textIter = damageTexts.iterator()
        while (textIter.hasNext()) {
            val dtItem = textIter.next()
            if (!dtItem.update(clampedDt)) {
                textIter.remove()
            }
        }

        // Update particles
        val partIter = particles.iterator()
        while (partIter.hasNext()) {
            val p = partIter.next()
            if (!p.update(clampedDt)) {
                partIter.remove()
            }
        }
    }

    private fun performAttackHitCheck(damage: Int, isHeavy: Boolean) {
        val atkBox = player.attackHitbox
        for (dummy in dummies) {
            if (RectF.intersects(atkBox, dummy.hitbox)) {
                dummy.takeDamage(damage)

                // Spawn floating damage text
                val dColor = if (isHeavy) Color.rgb(255, 180, 50) else Color.rgb(240, 240, 255)
                val dText = if (isHeavy) "CRIT $damage!" else "$damage"
                damageTexts.add(DamageText(dummy.x, dummy.groundY - dummy.height - 15f, dText, dColor))

                // Spawn sparks
                val sparkCount = if (isHeavy) 18 else 10
                for (i in 0 until sparkCount) {
                    val angle = Random.nextFloat() * Math.PI.toFloat() * 2f
                    val speed = Random.nextFloat() * 120f + 50f
                    particles.add(
                        SparkParticle(
                            x = dummy.x + (Random.nextFloat() - 0.5f) * 16f,
                            y = dummy.groundY - dummy.height / 2f + (Random.nextFloat() - 0.5f) * 20f,
                            vx = kotlin.math.cos(angle) * speed,
                            vy = kotlin.math.sin(angle) * speed - 60f,
                            color = if (isHeavy) Color.rgb(255, 200, 80) else Color.rgb(220, 240, 255),
                            size = if (isHeavy) 4f else 3f
                        )
                    )
                }
            }
        }
    }

    /**
     * Renders the game world onto the scaled canvas at logical coordinates.
     */
    fun render(canvas: Canvas) {
        canvas.save()
        // Translate world by negative camera position
        canvas.translate(-cameraX, 0f)

        // 1. Parallax background
        val bg = bgBitmap
        if (bg != null) {
            val bgSrc = Rect(0, 0, bg.width, bg.height)
            // Parallax factor 0.3f
            val bgX = cameraX * 0.3f
            val bgDst = RectF(bgX, 0f, bgX + LOGICAL_WIDTH * 1.5f, LOGICAL_HEIGHT)
            canvas.drawBitmap(bg, bgSrc, bgDst, pixelPaint)
        } else {
            // Fallback dark castle gradient
            pixelPaint.color = Color.rgb(18, 20, 28)
            canvas.drawRect(0f, 0f, WORLD_WIDTH, LOGICAL_HEIGHT, pixelPaint)
        }

        // 2. Stone Arena Ground
        pixelPaint.color = Color.rgb(36, 40, 52)
        canvas.drawRect(0f, FLOOR_Y, WORLD_WIDTH, LOGICAL_HEIGHT, pixelPaint)

        // Flagstone ground texture lines
        pixelPaint.color = Color.rgb(55, 62, 80)
        canvas.drawRect(0f, FLOOR_Y, WORLD_WIDTH, FLOOR_Y + 4f, pixelPaint)

        for (x in 0..WORLD_WIDTH.toInt() step 60) {
            pixelPaint.color = Color.rgb(28, 31, 40)
            canvas.drawLine(x.toFloat(), FLOOR_Y + 4f, x.toFloat(), LOGICAL_HEIGHT, pixelPaint)
            pixelPaint.color = Color.rgb(48, 54, 70)
            canvas.drawLine(x.toFloat() + 30f, FLOOR_Y + 24f, x.toFloat() + 30f, LOGICAL_HEIGHT, pixelPaint)
        }

        // Arena boundary stone pillars
        pixelPaint.color = Color.rgb(50, 55, 70)
        canvas.drawRect(0f, 0f, 24f, FLOOR_Y, pixelPaint)
        canvas.drawRect(WORLD_WIDTH - 24f, 0f, WORLD_WIDTH, FLOOR_Y, pixelPaint)

        // 3. Render Training Dummies
        for (dummy in dummies) {
            dummy.render(canvas, pixelPaint)
        }

        // 4. Character Shadow
        pixelPaint.color = Color.argb(120, 0, 0, 0)
        canvas.drawOval(player.x - 22f, FLOOR_Y - 4f, player.x + 22f, FLOOR_Y + 4f, pixelPaint)

        // 5. Render Character Sprite
        // The 128x128 cell is drawn at 100x100 logical pixels (no stretching, aspect
        // preserved). The cell carries 16px of transparent padding below the feet, so
        // the draw-rect bottom is offset by SPRITE_FOOT_OFFSET to put the visible
        // feet — and therefore the collision bottom — exactly on FLOOR_Y.
        val spriteDisplaySize = SPRITE_DISPLAY_SIZE
        animationSystem.render(
            canvas = canvas,
            centerX = player.x,
            bottomY = player.groundY + SPRITE_FOOT_OFFSET,
            displayWidth = spriteDisplaySize,
            displayHeight = spriteDisplaySize,
            isFacingRight = player.isFacingRight,
            paint = pixelPaint
        )

        // 6. Render Particles
        for (p in particles) {
            pixelPaint.color = p.color
            canvas.drawRect(p.x, p.y, p.x + p.size, p.y + p.size, pixelPaint)
        }

        // 7. Render Floating Damage Numbers
        for (dt in damageTexts) {
            textPaint.color = dt.color
            textPaint.alpha = (dt.alpha * 255).toInt()
            canvas.drawText(dt.text, dt.x - 16f, dt.y, textPaint)
        }

        canvas.restore()
    }
}
