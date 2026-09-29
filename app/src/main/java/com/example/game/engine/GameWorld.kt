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
import com.example.game.animation.SpriteMetrics
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
         * The backdrop is drawn with a single uniform scale, so any source row maps
         * to logical Y via: row * LOGICAL_HEIGHT / this.
         */
        const val BACKGROUND_HEIGHT = 864f

        /**
         * Row of the visible stone floor surface, measured from the backdrop artwork.
         *
         * Row statistics across the image width show a hard horizon: row 532 is still
         * dark wall (mean 21.6, 18.5% lit, 43.9% of sampled columns agreeing), while
         * row 533 is the first lit floor row (mean 31.5, 51.2% lit, 68.9% coherent).
         * The edge is horizontal, so one world-space plane is exact across the arena.
         * The bright seam further down at row 620 is a flagstone joint *inside* the
         * floor, not its top edge, and using it left the knight standing in front of
         * the wall.
         */
        const val BACKGROUND_FLOOR_ROW = 533f

        /**
         * World-space ground / collision plane, in logical pixels.
         *
         * The player's visible feet rest exactly on this Y at all times, and it is the Y the
         * jump impulse starts from and gravity returns to. Derived from the backdrop
         * rather than guessed, so the knight stands on the drawn stone floor instead
         * of an arbitrary line near the bottom of the screen.
         */
        val FLOOR_Y: Float = BACKGROUND_FLOOR_ROW * (LOGICAL_HEIGHT / BACKGROUND_HEIGHT)

        /**
         * Uniform scale the backdrop is drawn at. 360 / 864 is exactly 5/12, which
         * maps the 1536x864 art to the 640x360 logical viewport with no distortion
         * and no letterboxing. Because the same factor drives both the drawing and
         * [FLOOR_Y] above, the floor can never drift away from the feet.
         */
        val BACKGROUND_SCALE: Float = LOGICAL_HEIGHT / BACKGROUND_HEIGHT

        /** Logical size a 128px sprite cell is drawn at (aspect preserved). */
        const val SPRITE_DISPLAY_SIZE = 100f

        /**
         * Rest-pose foot offset, i.e. the padding below the opaque pixels of the idle
         * sheet's frames. Kept for diagnostics and tests; the renderer uses the
         * per-frame value from the animation system instead, since the walk cycle's
         * contact row is not constant.
         */
        val SPRITE_FOOT_OFFSET: Float =
            SpriteMetrics.footOffsetForRow(SpriteMetrics.DEFAULT_FOOT_ROW, SPRITE_DISPLAY_SIZE)
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
     * Draws the character sprite and nothing else, in the caller's (already camera
     * translated) coordinate space.
     *
     * Split out of [render] so instrumentation can run the real drawing path onto a
     * transparent surface and read the foot line straight off the alpha channel,
     * instead of inferring it from a difference against the backdrop.
     */
    fun renderCharacter(canvas: Canvas) {
        // The 128x128 cell is drawn at 100x100 logical pixels (no stretching, aspect
        // preserved). The cell's transparent lower edge is corrected per frame so
        // the visible feet — and therefore the collision bottom — land exactly on
        // FLOOR_Y.
        val spriteDisplaySize = SPRITE_DISPLAY_SIZE
        animationSystem.render(
            canvas = canvas,
            centerX = player.x,
            bottomY = player.groundY + animationSystem.footOffsetForCurrentFrame(spriteDisplaySize),
            displayWidth = spriteDisplaySize,
            displayHeight = spriteDisplaySize,
            isFacingRight = player.isFacingRight,
            paint = pixelPaint
        )
    }

    /**
     * Renders the game world onto the scaled canvas at logical coordinates.
     */
    fun render(canvas: Canvas) {
        // 1. Backdrop, drawn in screen space before the camera translate.
        //
        // The backdrop is a fixed 1536x864 plate that exactly covers the 640x360
        // viewport at BACKGROUND_SCALE, so it is not panned by the camera. That is
        // deliberate: the floor is baked into the plate, and keeping the plate out
        // of the camera transform means the floor cannot slide relative to the feet
        // as the player walks. FLOOR_Y is derived from the same scale, so the two
        // agree by construction at every camera offset.
        val bg = bgBitmap
        if (bg != null) {
            val bgSrc = Rect(0, 0, bg.width, bg.height)
            val bgDst = RectF(0f, 0f, bg.width * BACKGROUND_SCALE, bg.height * BACKGROUND_SCALE)
            canvas.drawBitmap(bg, bgSrc, bgDst, pixelPaint)
        } else {
            // Fallback dark castle gradient
            pixelPaint.color = Color.rgb(18, 20, 28)
            canvas.drawRect(0f, 0f, LOGICAL_WIDTH, LOGICAL_HEIGHT, pixelPaint)
        }

        canvas.save()
        // Translate world by negative camera position
        canvas.translate(-cameraX, 0f)

        // 2. Arena boundary stone pillars.
        //
        // No ground slab or flagstone grid is drawn here on purpose: the backdrop
        // already renders a detailed stone floor starting at FLOOR_Y, and painting
        // an opaque rectangle over that area is what previously hid the very
        // surface the player has to stand on.
        pixelPaint.color = Color.rgb(50, 55, 70)
        canvas.drawRect(0f, 0f, 24f, FLOOR_Y, pixelPaint)
        canvas.drawRect(WORLD_WIDTH - 24f, 0f, WORLD_WIDTH, FLOOR_Y, pixelPaint)

        // 3. Render Training Dummies
        for (dummy in dummies) {
            dummy.render(canvas, pixelPaint)
        }

        // 4. Character contact shadow, seated on the floor line.
        pixelPaint.color = Color.argb(82, 0, 0, 0)
        canvas.drawOval(player.x - 18f, FLOOR_Y - 2f, player.x + 18f, FLOOR_Y + 4f, pixelPaint)

        // 5. Render Character Sprite
        renderCharacter(canvas)

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
