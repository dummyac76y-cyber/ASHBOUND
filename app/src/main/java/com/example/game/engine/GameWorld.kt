package com.example.game.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.util.Log
import com.example.game.animation.DefaultAnimationConfigs
import com.example.game.animation.SpriteAnimationSystem
import com.example.game.animation.SpriteMetrics
import com.example.game.controller.PlayerController
import com.example.game.model.DamageText
import com.example.game.model.SparkParticle
import com.example.game.model.Npc
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.random.Random

/**
 * 2D Game World managing scenes, logical resolution, combat targets and particles.
 *
 * Exactly one scene is active at a time. Its backdrop is the only environment drawn,
 * scaled to cover that scene's world, and its own bounds and floor plane are what the
 * player, the NPCs and the camera are measured against.
 *
 * Mirrors GameWorld.ts.
 */
class GameWorld(val context: Context) {

    companion object {
        const val LOGICAL_WIDTH = 640f
        const val LOGICAL_HEIGHT = 360f

        /**
         * Logical size a 128px sprite cell is drawn at (aspect preserved).
         *
         * A property of the character alone. It is never scaled by a backdrop's size,
         * so the knight is exactly as large in the cavern as he is in the prison even
         * though the two artworks need very different scales to fill the screen.
         *
         * Its own constant, deliberately not the NPC's. The two characters share a
         * cell size but not a drawn size -- the NPC's artwork fills less of its cell,
         * so it is scaled up to match the knight's height. Deriving one from the other
         * would mean sizing the NPC silently resized the player.
         */
        const val SPRITE_DISPLAY_SIZE = 100f

        /**
         * Rest-pose foot offset, i.e. the padding below the opaque pixels of the idle
         * sheet's frames. Kept for diagnostics; the renderer uses the per-frame value
         * from the animation system instead, since the walk cycle's contact row is not
         * constant.
         */
        val SPRITE_FOOT_OFFSET: Float =
            SpriteMetrics.footOffsetForRow(SpriteMetrics.DEFAULT_FOOT_ROW, SPRITE_DISPLAY_SIZE)

        /** Fallback fill for a scene whose backdrop has not loaded. */
        val SCENE_FALLBACK_FILL: Int = Color.rgb(18, 20, 28)
    }

    val animationSystem = SpriteAnimationSystem(context, DefaultAnimationConfigs.createDefaults())
    val player = PlayerController(animationSystem, x = SCENES[STARTING_SCENE_INDEX].spawnX, groundY = 0f)

    /**
     * Every scene the game knows, in travel order, each bound to its own geometry.
     *
     * Only one is drawn at a time.
     */
    val scenes: List<SceneRuntime> = SCENES.map { definition ->
        SceneRuntime(
            definition = definition,
            fit = fitBackdrop(
                definition.sourceWidth,
                definition.sourceHeight,
                definition.floorRow,
                definition.worldWidth,
                LOGICAL_HEIGHT,
                Framing(cameraYOffset = definition.cameraYOffset)
            )
        )
    }

    /** Objects belonging to the active scene. Rebuilt on every scene change. */
    /**
     * The NPCs belonging to the active scene. Rebuilt on every scene change.
     *
     * Each holds a world X and is drawn through the same camera transform as the
     * backdrop and the player, so it holds still in the world and only moves across
     * the screen when the camera scrolls.
     */
    var npcs: List<Npc> = emptyList()

    /**
     * The NPC walk sheet, shared by every NPC in the world.
     *
     * Held here rather than per NPC so the decoded image exists once, and so a scene
     * change -- which rebuilds the NPCs -- cannot drop it.
     */
    var npcSprite: Bitmap? = loadNpcSprite()
        private set

    // Visual particle effects
    val damageTexts = mutableListOf<DamageText>()
    val particles = mutableListOf<SparkParticle>()

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

    /**
     * Paint for the transition veil.
     *
     * Separate from [pixelPaint] because the veil needs a real alpha blend, while the
     * scene paint is configured for hard-edged pixel art.
     */
    private val fadePaint = Paint().apply { isAntiAlias = false }

    private val titlePaint = Paint().apply {
        isAntiAlias = true
        isFakeBoldText = true
        textAlign = Paint.Align.CENTER
    }

    private val rulePaint = Paint().apply {
        isAntiAlias = false
        style = Paint.Style.STROKE
        strokeWidth = 1f
    }

    /**
     * Camera view offset, in world units. Everything in the scene (backdrop, player,
     * NPCs, hitboxes) lives in world space and is drawn through this single
     * transform, so a world-fixed object stays locked to its scene as the player walks.
     *
     * Recomputed from the active scene's bounds whenever the scene changes, so a
     * camera never carries over from a scene with different geometry.
     */
    var cameraX: Float = 0f
        private set

    /** Index of the scene currently being played. */
    var activeSceneIndex: Int = STARTING_SCENE_INDEX
        private set

    /** Stage of the scene handover; IDLE whenever gameplay is live. */
    var transitionPhase: SceneTransitionPhase = SceneTransitionPhase.IDLE
        private set

    /** Seconds elapsed in the current transition phase. */
    var transitionElapsed: Float = 0f
        private set

    /** Scene index the handover will land on, or -1 when nothing is pending. */
    var transitionTargetIndex: Int = -1
        private set

    /** Title shown on the transition card. */
    var transitionTitle: String = ""
        private set

    /** Drifting cave fog, alive only while a handover is running. */
    private var fog: List<FogMote> = emptyList()

    /** Deterministic seed for [fog], varied per handover so it is not a loop. */
    private var fogSeed: Int = 0

    /** The scene currently being played. */
    val activeScene: SceneRuntime get() = scenes[activeSceneIndex]

    /** Width of the active scene's world, in logical pixels. */
    val worldWidth: Float get() = activeScene.definition.worldWidth

    /**
     * Ground plane of the active scene, in logical pixels.
     *
     * The player's visible feet rest exactly on this, and it is what the jump impulse
     * starts from and gravity returns to. It comes from the scene's own artwork, so the
     * knight always stands on that scene's drawn floor rather than a line carried over
     * from somewhere else.
     */
    val floorY: Float get() = activeScene.fit.floorY

    /**
     * Vertical framing of the active scene, in logical pixels.
     *
     * Applied to the whole world at render time and nothing else. The player keeps
     * standing on [floorY] in world coordinates -- this moves that plane up or down
     * the screen, not the physics, so jumping, landing and hitboxes are unchanged.
     */
    val cameraY: Float get() = activeScene.fit.cameraYOffset

    /** Screen Y the active scene's floor is drawn at. Shared by every scene. */
    val footScreenY: Float get() = activeScene.fit.footScreenY

    /** Largest legal camera offset for the active scene. Always >= 0. */
    val maxCameraX: Float get() = maxOf(0f, worldWidth - LOGICAL_WIDTH)

    /** True while a scene handover is running and gameplay is suspended. */
    val isTransitioning: Boolean get() = transitionPhase != SceneTransitionPhase.IDLE

    init {
        for (scene in scenes) {
            scene.background = loadBackdrop(scene.definition.asset)
        }
        enterScene(STARTING_SCENE_INDEX)
    }

    /** Camera offset that puts a given world X at the centre of the viewport. */
    fun cameraXForPlayerX(worldX: Float): Float =
        (worldX - LOGICAL_WIDTH / 2f).coerceIn(0f, maxCameraX)

    /**
     * Loads a scene backdrop.
     *
     * The arena keeps its legacy fallback name; every other scene is a single plate.
     * A missing plate is survivable: the scene draws its fallback fill instead.
     */
    private fun loadBackdrop(asset: String): Bitmap? {
        val names = if (asset == FORGOTTEN_PRISON.asset) {
            listOf(asset, "img_arena_bg")
        } else {
            listOf(asset)
        }
        for (name in names) {
            val bitmap = decodeDrawable(name) ?: continue
            Log.i("GameWorld", "Scene backdrop $name (${bitmap.width}x${bitmap.height})")
            return bitmap
        }
        Log.w("GameWorld", "No backdrop for '$asset'; that scene falls back to flat fill")
        return null
    }

    /**
     * Decodes the NPC walk sheet from the shared assets.
     *
     * A missing sheet is survivable: the NPC still draws its shadow and HP bar, and
     * the game does not stall waiting on the network the way a backdrop would.
     */
    private fun loadNpcSprite(): Bitmap? = try {
        val options = BitmapFactory.Options().apply {
            inScaled = false
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val stream = context.assets.open("sprites/${Npc.SPRITE_FILE}")
        stream.use { BitmapFactory.decodeStream(it, null, options) }
            ?: run {
                Log.w("GameWorld", "NPC sheet '${Npc.SPRITE_FILE}' did not decode")
                null
            }
    } catch (_: Exception) {
        Log.w("GameWorld", "NPC sheet '${Npc.SPRITE_FILE}' missing; NPCs render without art")
        null
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

    /**
     * Switches to a scene: rebuilds its objects, places the player at its entrance and
     * snaps the camera to the new bounds.
     *
     * The camera is set outright rather than eased, because a camera that drifts in
     * from a previous scene's position would show the old framing sliding across the
     * new one. Nothing from the previous scene survives except the player and the
     * persistent HUD.
     */
    fun enterScene(index: Int) {
        activeSceneIndex = index.coerceIn(0, scenes.size - 1)
        val scene = activeScene
        npcs = scene.definition.npcXs.map { x ->
            Npc(x = it, groundY = scene.fit.floorY).also { it.sprite = npcSprite }
        }
        damageTexts.clear()
        particles.clear()
        player.resetPlayer(scene.definition.spawnX, scene.fit.floorY)
        cameraX = cameraXForPlayerX(player.x)
        transitionPhase = SceneTransitionPhase.IDLE
        transitionElapsed = 0f
        transitionTargetIndex = -1
        transitionTitle = ""
        fog = emptyList()
    }

    /** Returns the player to the active scene's entrance without changing scene. */
    fun respawn() {
        player.resetPlayer(activeScene.definition.spawnX, floorY)
        cameraX = cameraXForPlayerX(player.x)
    }

    /**
     * Things that happened, for anything that is not the simulation -- sound, above all.
     *
     * A callback list rather than an audio dependency on purpose. The world is the only thing
     * that knows when an attack actually connected, and reaching for an [AudioEngine] in here
     * would make the simulation depend on a file that may not exist. Both fields are nullable
     * and the world fires unconditionally, so with nothing listening the cost is a compare.
     *
     * Only what the game currently produces. `onHurt` and `onDeath` are deliberately absent:
     * the player cannot be damaged yet, and inventing a hook for damage that does not exist
     * would be a way to forget that it does not.
     */

    /** An attack connected with an NPC. */
    var onSwordHit: ((isHeavy: Boolean) -> Unit)? = null

    /** The player has walked far enough for another step. */
    var onFootstep: (() -> Unit)? = null

    /** Distance walked between footstep cues. Tuned to roughly one step per stride. */
    private val footstepDistance = 26f
    private var footstepAccumulator = 0f

    fun update(dt: Float) {
        val clampedDt = dt.coerceIn(0.001f, 0.05f)

        // A running handover owns the clock: gameplay is suspended, and the scene swap
        // happens behind the fully opaque part of the fade so it is never seen.
        if (isTransitioning) {
            advanceTransition(clampedDt)
            updateFogMotes(fog, clampedDt, LOGICAL_WIDTH, LOGICAL_HEIGHT)
            return
        }

        val sceneFloorY = activeScene.fit.floorY
        player.update(clampedDt, 0f, worldWidth, sceneFloorY)

        // Camera smoothly follows player within this scene's bounds.
        val targetCamX = cameraXForPlayerX(player.x)
        cameraX += (targetCamX - cameraX) * 0.15f

        // Check attack collisions
        if (player.shouldCheckAttackHit()) {
            performAttackHitCheck(damage = 18, isHeavy = false)
        }
        if (player.shouldCheckHeavyAttackHit()) {
            performAttackHitCheck(damage = 45, isHeavy = true)
        }

        advanceFootsteps(clampedDt)

        // Update the scene's NPCs
        for (npc in npcs) {
            npc.update(clampedDt)
        }

        // Update damage texts
        val dtIter = damageTexts.iterator()
        while (dtIter.hasNext()) {
            val item = dtIter.next()
            if (!item.update(clampedDt)) dtIter.remove()
        }

        // Update particles
        val partIter = particles.iterator()
        while (partIter.hasNext()) {
            val p = partIter.next()
            if (!p.update(clampedDt)) partIter.remove()
        }

        // Reaching the exit stops normal movement and starts the handover.
        val exitX = activeScene.definition.exitX
        if (exitX != null && player.x >= exitX) {
            beginTransition()
        }
    }

    /**
     * Starts the handover to the next scene.
     *
     * Does nothing at the last scene, which has no successor, so the player is simply
     * stopped by the world bound there.
     */
    fun beginTransition() {
        if (isTransitioning) return
        val next = activeSceneIndex + 1
        if (next >= scenes.size) return
        transitionTargetIndex = next
        transitionTitle = scenes[next].definition.title
        transitionPhase = SceneTransitionPhase.FADING_OUT
        transitionElapsed = 0f
        fogSeed += 1
        fog = buildFogMotes(fogSeed, 28, LOGICAL_WIDTH, LOGICAL_HEIGHT)
    }

    /** Drives the fade / title / fade-in state machine. */
    private fun advanceTransition(dt: Float) {
        transitionElapsed += dt
        when (transitionPhase) {
            SceneTransitionPhase.FADING_OUT -> {
                // Fully dark by the end of this phase, so the scene swap is hidden.
                if (transitionElapsed >= TRANSITION_FADE_OUT) {
                    transitionElapsed -= TRANSITION_FADE_OUT
                    if (transitionTargetIndex >= 0) enterScene(transitionTargetIndex)
                    // enterScene clears the phase, so the handover is restated for the
                    // title card.
                    transitionPhase = SceneTransitionPhase.TITLE
                    transitionElapsed = 0f
                    transitionTargetIndex = -1
                    transitionTitle = activeScene.definition.title
                }
            }

            SceneTransitionPhase.TITLE -> {
                if (transitionElapsed >= TRANSITION_TITLE_HOLD) {
                    transitionElapsed -= TRANSITION_TITLE_HOLD
                    transitionPhase = SceneTransitionPhase.FADING_IN
                }
            }

            SceneTransitionPhase.FADING_IN -> {
                if (transitionElapsed >= TRANSITION_FADE_IN) {
                    transitionPhase = SceneTransitionPhase.IDLE
                    transitionElapsed = 0f
                    transitionTitle = ""
                    fog = emptyList()
                }
            }

            SceneTransitionPhase.IDLE -> Unit
        }
    }

    /** Opacity of the dark veil over the screen, 0 (clear) to 1 (opaque). */
    private fun fadeAlpha(): Float = when (transitionPhase) {
        SceneTransitionPhase.FADING_OUT -> min(1f, transitionElapsed / TRANSITION_FADE_OUT)
        SceneTransitionPhase.TITLE -> 1f
        SceneTransitionPhase.FADING_IN -> maxOf(0f, 1f - transitionElapsed / TRANSITION_FADE_IN)
        SceneTransitionPhase.IDLE -> 0f
    }

    /**
     * Fires a footstep every so far walked.
     *
     * Distance-based rather than time-based, so the cadence follows the player instead of the
     * frame rate: a time-based timer drifts with the simulation clamp and sounds wrong the
     * moment the app is throttled. Only on the ground and only while actually walking, so a
     * jump or a mid-air dash is silent.
     */
    private fun advanceFootsteps(dt: Float) {
        val walking = player.isGrounded && player.movementInput != 0f && !player.isDashing
        if (!walking) {
            // Reset rather than accumulate: a player who stops mid-stride starts the next
            // one clean.
            footstepAccumulator = 0f
            return
        }
        footstepAccumulator += abs(player.vx) * dt
        if (footstepAccumulator < footstepDistance) return
        footstepAccumulator = 0f
        onFootstep?.invoke()
    }

    private fun performAttackHitCheck(damage: Int, isHeavy: Boolean) {
        val atkBox = player.attackHitbox
        for (npc in npcs) {
            if (RectF.intersects(atkBox, npc.hitbox)) {
                // The sound is fired only for an attack that connected, not for every swing:
                // the audio bank already rate-limits repeats, but that is a safety net, not
                // a plan.
                if (npc.takeDamage(damage)) onSwordHit?.invoke(isHeavy)

                // Spawn floating damage text
                val dColor = if (isHeavy) Color.rgb(255, 180, 50) else Color.rgb(240, 240, 255)
                val dText = if (isHeavy) "CRIT $damage!" else "$damage"
                damageTexts.add(DamageText(npc.x, npc.groundY - npc.height - 15f, dText, dColor))

                // Spawn sparks
                val sparkCount = if (isHeavy) 18 else 10
                for (i in 0 until sparkCount) {
                    val angle = Random.nextFloat() * Math.PI.toFloat() * 2f
                    val speed = Random.nextFloat() * 120f + 50f
                    particles.add(
                        SparkParticle(
                            x = npc.x + (Random.nextFloat() - 0.5f) * 16f,
                            y = npc.groundY - npc.height / 2f + (Random.nextFloat() - 0.5f) * 20f,
                            vx = cos(angle) * speed,
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
     * Draws the active scene's backdrop and nothing else.
     *
     * Only one plate is ever drawn, so there is no seam between environments to hide
     * and no possibility of two environments appearing at once.
     */
    fun renderBackdrop(canvas: Canvas) {
        val scene = activeScene
        val bg = scene.background
        val fit = scene.fit
        if (bg == null) {
            pixelPaint.color = SCENE_FALLBACK_FILL
            canvas.drawRect(0f, 0f, worldWidth, LOGICAL_HEIGHT, pixelPaint)
            return
        }
        canvas.drawBitmap(
            bg,
            Rect(0, 0, bg.width, bg.height),
            RectF(fit.offsetX, fit.offsetY, fit.offsetX + fit.drawWidth, fit.offsetY + fit.drawHeight),
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
        // cell's transparent lower edge is corrected per frame so the visible feet --
        // and therefore the collision bottom -- land exactly on the scene's floor plane.
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

    /** Renders the game world onto the scaled canvas at logical coordinates. */
    fun render(canvas: Canvas) {
        val sceneFloorY = floorY

        canvas.save()
        // Single world -> screen transform. The backdrop, the player, the NPCs and
        // every hitbox all live in the same world space, so a world-fixed object stays
        // locked to its scene while the player walks.
        canvas.translate(-cameraX, cameraY)

        // 1. The active scene's backdrop, and only that one, uniformly scaled to cover
        // the world and cropped where it overflows. No tiling, mirroring or stretching,
        // and by construction no gap: the plate is at least as large as the area it
        // covers on both axes.
        renderBackdrop(canvas)

        // 2. Scene boundary stone pillars, at this scene's own world edges.
        //
        // No ground slab or flagstone grid is drawn here on purpose: the backdrop
        // already renders a detailed floor starting at floorY, and painting an opaque
        // rectangle over that area is what previously hid the very surface the player
        // has to stand on.
        pixelPaint.color = Color.rgb(50, 55, 70)
        canvas.drawRect(0f, 0f, 24f, sceneFloorY, pixelPaint)
        canvas.drawRect(worldWidth - 24f, 0f, worldWidth, sceneFloorY, pixelPaint)

        // 3. Scene objects, at this scene's own world positions.
        for (npc in npcs) {
            npc.render(canvas, pixelPaint)
        }

        // 4. Character contact shadow, seated on the floor line.
        pixelPaint.color = Color.argb(82, 0, 0, 0)
        canvas.drawOval(player.x - 18f, sceneFloorY - 2f, player.x + 18f, sceneFloorY + 4f, pixelPaint)

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

        // 8. The scene handover card, in screen space so it is unaffected by the camera.
        renderTransition(canvas)
    }

    /**
     * Draws the scene transition: a dark fade, drifting fog and the area title.
     *
     * Deliberately not a loading screen. There is no spinner or progress bar; the
     * handover is presented as the character moving from one place to the next.
     */
    private fun renderTransition(canvas: Canvas) {
        val alpha = fadeAlpha()
        if (alpha <= 0f && fog.isEmpty()) return

        // Fog drifts under the veil, brightest while the screen is still dark.
        if (fog.isNotEmpty()) {
            val fogAlpha = (90f * (0.35f + 0.65f * alpha)).toInt()
            fadePaint.color = Color.argb(fogAlpha, 198, 206, 222)
            for (m in fog) {
                canvas.drawRect(
                    m.x - m.size / 2f,
                    m.y - m.size / 2f,
                    m.x + m.size / 2f,
                    m.y + m.size / 2f,
                    fadePaint
                )
            }
        }

        fadePaint.color = Color.argb((alpha * 255).toInt(), 2, 3, 6)
        canvas.drawRect(0f, 0f, LOGICAL_WIDTH, LOGICAL_HEIGHT, fadePaint)

        if (transitionPhase != SceneTransitionPhase.TITLE || transitionTitle.isEmpty()) return

        // The title eases in over the first third of the hold, so it settles rather than
        // snapping on at full strength.
        val t = min(1f, transitionElapsed / (TRANSITION_TITLE_HOLD * 0.35f))
        val cx = LOGICAL_WIDTH / 2f
        val cy = LOGICAL_HEIGHT / 2f

        // A warm ember glow behind the text, as if lit from within the dark.
        fadePaint.shader = RadialGradient(
            cx, cy, 190f,
            Color.argb((0.16f * t * 255).toInt(), 255, 176, 92),
            Color.TRANSPARENT,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(cx - 190f, cy - 190f, cx + 190f, cy + 190f, fadePaint)
        fadePaint.shader = null

        titlePaint.textSize = 26f
        titlePaint.typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.SERIF,
            android.graphics.Typeface.BOLD
        )

        // Shadow, then the face itself.
        titlePaint.color = Color.argb((0.6f * t * 255).toInt(), 0, 0, 0)
        drawSpacedText(canvas, transitionTitle, cx + 1.5f, cy + 1.5f, 3f)
        titlePaint.color = Color.argb((t * 0.96f * 255).toInt(), 238, 224, 196)
        drawSpacedText(canvas, transitionTitle, cx, cy, 3f)

        // Hairline rules flanking the title.
        rulePaint.color = Color.argb((t * 0.5f * 255).toInt(), 214, 180, 122)
        val halfW = spacedTextWidth(transitionTitle, 3f) / 2f
        canvas.drawLine(cx - halfW - 44f, cy + 0.5f, cx - halfW - 14f, cy + 0.5f, rulePaint)
        canvas.drawLine(cx + halfW + 14f, cy + 0.5f, cx + halfW + 44f, cy + 0.5f, rulePaint)
    }

    /**
     * Draws [text] centred at ([x], [y]) with manual letter spacing.
     *
     * Android's Paint has no portable letterSpacing, and widely tracked small caps are
     * most of what makes a serif face read as a carved location card rather than body
     * text.
     */
    private fun drawSpacedText(canvas: Canvas, text: String, x: Float, y: Float, spacing: Float) {
        val startX = x - spacedTextWidth(text, spacing) / 2f
        var cursor = startX
        for (ch in text) {
            val w = titlePaint.measureText(ch.toString())
            canvas.drawText(ch.toString(), cursor + w / 2f, y, titlePaint)
            cursor += w + spacing
        }
    }

    private fun spacedTextWidth(text: String, spacing: Float): Float {
        var total = 0f
        for (ch in text) total += titlePaint.measureText(ch.toString())
        return total + spacing * (text.length - 1).coerceAtLeast(0)
    }
}

/** One scene, bound at runtime: its definition, its image and its resolved geometry. */
class SceneRuntime(
    val definition: SceneDefinition,
    val fit: SceneBackdropFit
) {
    /**
     * The scene's backdrop. Null means the plate is missing, in which case the scene
     * draws its fallback fill instead.
     */
    var background: Bitmap? = null
}
