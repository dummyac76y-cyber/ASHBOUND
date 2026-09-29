package com.example.game.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
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
        const val FLOOR_Y = 285f
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
        try {
            val resId = context.resources.getIdentifier("img_arena_bg", "drawable", context.packageName)
            if (resId != 0) {
                val opts = BitmapFactory.Options().apply { inScaled = false }
                bgBitmap = BitmapFactory.decodeResource(context.resources, resId, opts)
            }
        } catch (_: Exception) {}
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
        // Knight display size preserving aspect ratio (128x128 sprite displayed at 100x100 logical pixels)
        val spriteDisplaySize = 100f
        animationSystem.render(
            canvas = canvas,
            centerX = player.x,
            bottomY = player.groundY,
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
