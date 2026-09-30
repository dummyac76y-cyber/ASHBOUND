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

        /**
         * Native pixel height of the arena backdrop (img_arena_bg_hd.png).
         * The backdrop is drawn with a single uniform scale, so any source row
         * maps to logical Y via: row * LOGICAL_HEIGHT / this.
         */
        const val BACKGROUND_HEIGHT = 864f

        /** Uniform scale the backdrop is drawn at. 360 / 864 is exactly 5/12. */
        val BACKGROUND_SCALE: Float = LOGICAL_HEIGHT / BACKGROUND_HEIGHT

        /**
         * Logical size of the backdrop once scaled.
         *
         * 1536 x 5/12 is exactly 640 and 864 x 5/12 is exactly 360: the artwork
         * is a single frame that covers the viewport precisely. It is one finite
         * environment, not a texture, so it is drawn once, never repeated and
         * never mirrored.
         */
        val BACKGROUND_LOGICAL_WIDTH: Float = 1536f * BACKGROUND_SCALE
        val BACKGROUND_LOGICAL_HEIGHT: Float = 864f * BACKGROUND_SCALE

        /**
         * Native pixel size of the Underground Cavern backdrop
         * (img_underground_cavern_hd.png), the world section that follows the prison.
         */
        const val CAVERN_WIDTH = 1536f
        const val CAVERN_HEIGHT = 512f

        /**
         * The cavern is drawn at the *same* uniform scale as the arena, not at a
         * scale chosen to fill the viewport.
         *
         * The cavern art is 512px tall where the arena is 864, so scaling it to
         * cover 360 logical pixels would need 360/512 rather than 5/12 -- about
         * 1.69x larger. That would leave the knight, drawn at a fixed sprite size,
         * standing at a very different size against the scenery the moment he
         * crossed the boundary. Sharing one scale keeps the character-to-scenery
         * relationship identical across the seam.
         */
        val CAVERN_SCALE: Float = BACKGROUND_SCALE

        /** Logical size of the cavern once scaled: exactly 640 x 213 1/3. */
        val CAVERN_LOGICAL_WIDTH: Float = CAVERN_WIDTH * CAVERN_SCALE
        val CAVERN_LOGICAL_HEIGHT: Float = CAVERN_HEIGHT * CAVERN_SCALE

        /**
         * Width of the playable world, in logical pixels.
         *
         * The world is the Forgotten Prison followed by the Underground Cavern,
         * each one finite environment laid end to end. The camera therefore has
         * exactly one viewport of scroll to cross between them, and because the
         * world is exactly the two plates there is no slack that would have to be
         * covered by a tiled or mirrored copy.
         */
        val WORLD_WIDTH: Float = BACKGROUND_LOGICAL_WIDTH + CAVERN_LOGICAL_WIDTH

        /**
         * Centre of the Forgotten Prison, in world units.
         *
         * Anchored to the prison plate rather than to the world, because the world
         * now spans two sections: half the world would put the spawn exactly on the
         * seam between them and shift both training dummies into the cavern.
         */
        val ARENA_CENTER_X: Float = BACKGROUND_LOGICAL_WIDTH / 2f

        /**
         * Initial world X for the player: the arena centre, which leaves the full
         * half-width of arena on both sides to walk into.
         */
        val SPAWN_X: Float = ARENA_CENTER_X

        /**
         * World X of the first training dummy. Placed to the right of the spawn so
         * the match opens as player-versus-target, and left untouched thereafter: a
         * fixed world position, not a screen or player-relative one.
         */
        val DUMMY_X: Float = ARENA_CENTER_X + 130f

        /** World distance between the two training dummies. */
        val DUMMY_SPACING = 120f

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
         * Row of the cavern's visible floor surface, measured from its artwork the
         * same way as the arena's.
         *
         * Both backdrops share one structure: dark wall, then a lit floor band, then
         * a dark foreground running off the bottom. In the cavern the transition is
         * at row 391, where the lit fraction jumps 43.2% -> 63.3% and mean
         * luminance rises 37.2 -> 46.1 -- the same shape of step as the arena's
         * 532 -> 533, so both sections measure their floor the same way and land on
         * one shared ground plane.
         */
        const val CAVERN_FLOOR_ROW = 391f

        /**
         * Logical Y at which the cavern plate is drawn.
         *
         * The cavern is shorter than the viewport once scaled and its floor sits
         * lower within its own frame than the arena's (391/512 vs 533/864). Offsetting
         * the plate so its measured floor row lands exactly on FLOOR_Y is what keeps
         * the walkable surface continuous across the boundary: one collision plane,
         * so there is no step, gap or floating knight.
         */
        val CAVERN_OFFSET_Y: Float = FLOOR_Y - CAVERN_FLOOR_ROW * CAVERN_SCALE

        /**
         * Flat fills for the two bands the cavern plate does not reach.
         *
         * At the shared scale the cavern covers only 213 of the 360 logical pixel
         * rows, so plain colour fills what is left above and below it. Both are
         * sampled from the cavern's own outermost rows (row 0 averages rgb(3,6,18),
         * row 511 averages rgb(0,0,10)) so the bands continue the artwork's own
         * near-black cave darkness. The plate is drawn once and never stretched,
         * mirrored or repeated; these fills only cover what it does not reach.
         */
        val CAVERN_FILL_ABOVE = Color.rgb(3, 6, 18)
        val CAVERN_FILL_BELOW = Color.rgb(0, 0, 10)

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
    val player = PlayerController(animationSystem, x = SPAWN_X, groundY = FLOOR_Y)

    // Interactive training dummy targets. World fixtures at fixed world X: never
    // derived from the player, and standing on the same FLOOR_Y.
    val dummies = listOf(
        TrainingDummy(x = DUMMY_X, groundY = FLOOR_Y),
        TrainingDummy(x = DUMMY_X + DUMMY_SPACING, groundY = FLOOR_Y)
    )

    // Visual particle effects
    val damageTexts = mutableListOf<DamageText>()
    val particles = mutableListOf<SparkParticle>()

    // Arena background bitmap
    private var bgBitmap: Bitmap? = null

    // Underground Cavern bitmap: the second world section, kept separate from the
    // arena because it is a different image at a different vertical offset.
    private var cavernBitmap: Bitmap? = null

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

    // Camera view offset, in world units. Everything in the arena (backdrop,
    // player, dummies, hitboxes) lives in world space and is drawn through this
    // single transform, so a world-fixed object stays locked to the dungeon as the
    // player walks.
    var cameraX: Float = 0f
        private set

    init {
        loadArenaBackground()
        loadCavernBackground()
        // Start with the player already centred, instead of easing in from the
        // left edge on the first frames of the match.
        cameraX = cameraXForPlayerX(player.x)
    }

    /** Camera offset that puts a given world X at the centre of the viewport. */
    fun cameraXForPlayerX(worldX: Float): Float =
        (worldX - LOGICAL_WIDTH / 2f).coerceIn(0f, WORLD_WIDTH - LOGICAL_WIDTH)

    private fun loadArenaBackground() {
        // Prefer the high-res backdrop; fall back to the legacy jpg if it is absent.
        val names = listOf("img_arena_bg_hd", "img_arena_bg")
        for (name in names) {
            val bitmap = decodeDrawable(name) ?: continue
            bgBitmap = bitmap
            Log.i("GameWorld", "Arena background: $name (${bitmap.width}x${bitmap.height})")
            return
        }
        Log.w("GameWorld", "No arena background found; using the gradient fallback")
    }

    /**
     * Loads the Underground Cavern plate -- the same file the web build syncs from
     * here, so both engines render identical pixels for the second section.
     */
    private fun loadCavernBackground() {
        val bitmap = decodeDrawable("img_underground_cavern_hd")
        if (bitmap != null) {
            cavernBitmap = bitmap
            Log.i("GameWorld", "Cavern background (${bitmap.width}x${bitmap.height})")
        } else {
            Log.w("GameWorld", "No cavern background found; that section falls back to flat fill")
        }
    }

    private fun decodeDrawable(name: String): Bitmap? = try {
        val resId = context.resources.getIdentifier(name, "drawable", context.packageName)
        if (resId == 0) {
            null
        } else {
            val opts = BitmapFactory.Options().apply { inScaled = false }
            BitmapFactory.decodeResource(context.resources, resId, opts)
        }
    } catch (_: Exception) {
        null
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
     * Draws the backdrop once, in world space, at its natural size.
     *
     * The artwork is a single finite environment that already covers the viewport
     * exactly, so it is neither mirrored, repeated, nor flipped. It is anchored to
     * world (0, 0) and the camera is clamped to the world, so the plate can never
     * be drawn twice or leave a gap at either edge.
     */
    private fun drawBackdrop(canvas: Canvas) {
        val bg = bgBitmap
        if (bg == null) {
            // Fallback dark castle gradient
            pixelPaint.color = Color.rgb(18, 20, 28)
            canvas.drawRect(0f, 0f, WORLD_WIDTH, LOGICAL_HEIGHT, pixelPaint)
            return
        }

        // Forgotten Prison: anchored at world (0, 0), drawn once.
        canvas.drawBitmap(
            bg,
            Rect(0, 0, bg.width, bg.height),
            RectF(0f, 0f, bg.width * BACKGROUND_SCALE, bg.height * BACKGROUND_SCALE),
            pixelPaint
        )

        val cavern = cavernBitmap ?: return
        val cavernX = BACKGROUND_LOGICAL_WIDTH

        // Flat bands first, so the plate is drawn over them and no seam shows at its
        // own top and bottom edges.
        pixelPaint.color = CAVERN_FILL_BELOW
        canvas.drawRect(cavernX, 0f, cavernX + CAVERN_LOGICAL_WIDTH, LOGICAL_HEIGHT, pixelPaint)
        if (CAVERN_OFFSET_Y > 0f) {
            pixelPaint.color = CAVERN_FILL_ABOVE
            canvas.drawRect(cavernX, 0f, cavernX + CAVERN_LOGICAL_WIDTH, CAVERN_OFFSET_Y, pixelPaint)
        }

        // Underground Cavern: its own section, immediately right of the prison and in
        // the same world space, so the single camera transform scrolls across the
        // boundary and everything stays locked to the world. Drawn exactly once --
        // never tiled, never mirrored, never flipped.
        canvas.drawBitmap(
            cavern,
            Rect(0, 0, cavern.width, cavern.height),
            RectF(
                cavernX,
                CAVERN_OFFSET_Y,
                cavernX + cavern.width * CAVERN_SCALE,
                CAVERN_OFFSET_Y + cavern.height * CAVERN_SCALE
            ),
            pixelPaint
        )
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
        // A cell is drawn square, and the sheet's own display scale is applied so a
        // grid-packed sheet (attack) still matches the strip sheets on screen. The
        // cell's transparent lower edge is corrected per frame so the visible feet —
        // and therefore the collision bottom — land exactly on FLOOR_Y.
        val spriteDisplaySize = animationSystem.displaySizeForCurrentSheet(SPRITE_DISPLAY_SIZE)
        animationSystem.render(
            canvas = canvas,
            centerX = player.x,
            bottomY = player.groundY + animationSystem.footOffsetForCurrentFrame(SPRITE_DISPLAY_SIZE),
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
        canvas.save()
        // Single world -> screen transform. The backdrop, the player, the dummies
        // and every hitbox all live in the same world space, so a world-fixed
        // object stays locked to the dungeon while the player walks.
        canvas.translate(-cameraX, 0f)

        // 1. Backdrop, drawn once in world space at a single uniform scale.
        //
        // The artwork already covers the viewport exactly and the world is
        // exactly as wide as the artwork, so there is nothing to repeat, mirror
        // or fill in: the plate is drawn at world (0, 0) and the camera never
        // leaves [0, 0].
        drawBackdrop(canvas)

        // 2. Arena boundary stone pillars, in world space at the arena edges.
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
