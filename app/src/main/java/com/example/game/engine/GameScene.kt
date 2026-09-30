package com.example.game.engine

/**
 * Scene definitions and the geometry that fits a backdrop to a scene.
 *
 * Every environment is its own full-screen scene: exactly one backdrop is drawn at a
 * time, scaled to cover that scene's world. Environments are never placed beside one
 * another, so no seam, black gap or mismatched-scale step can exist between them --
 * they are not in the same picture at all.
 *
 * The player is deliberately absent from this file. Sprite size is a property of the
 * character, not of the scenery behind it, so the knight keeps one logical size in
 * every scene regardless of how the backdrop had to be scaled to fill.
 *
 * Mirrors GameScene.ts.
 */

/** How a backdrop plate is scaled and positioned to cover a scene's world. */
data class SceneBackdropFit(
    /** Uniform scale applied to the source image. One value for both axes. */
    val scale: Float,
    /** Scaled size of the plate. Both are >= the area they must cover. */
    val drawWidth: Float,
    val drawHeight: Float,
    /**
     * World-space position of the plate's top-left corner.
     *
     * Negative on an axis that overflows, which is how the excess is cropped: the
     * artwork grows past the viewport and the overhang is trimmed evenly on both
     * sides. It is never positive on a covering axis, because positive offset would
     * leave an unfilled gap at the near edge.
     */
    val offsetX: Float,
    val offsetY: Float,
    /**
     * World Y of the visible floor surface, i.e. where the source row [floorRow]
     * ends up after scaling and offsetting. This is the scene's ground plane: the
     * player's visible feet rest exactly here.
     */
    val floorY: Float,
    /**
     * Screen Y of this scene's floor, i.e. where the player's feet are drawn. Every
     * combat scene aims at the same value, so the knight's apparent height on
     * screen does not change when the scene does.
     */
    val footScreenY: Float,
    /**
     * Vertical framing offset applied to the whole world when this scene renders.
     *
     * The two paintings put their floor at different heights inside the frame, so
     * without this the same world Y would put the knight near the bottom in one
     * scene and much higher in the other. This shifts the entire world -- backdrop,
     * player, dummies, particles -- up or down as one, cropping excess background
     * and nothing else. It is a camera offset only: it never touches the scale, and
     * it never moves the player relative to [floorY].
     */
    val cameraYOffset: Float
)

/**
 * Where the combat floor should sit on screen, as a fraction of the viewport height.
 *
 * Shared by every scene, so the floor lands at the same height in each one
 * regardless of how much of its own frame the painting gives to the ground.
 */
const val FOOT_TARGET_VIEWPORT_FRACTION = 0.75f

/**
 * Scales a backdrop to completely cover a scene, preserving aspect ratio.
 *
 * Height drives the scale, because that is what makes a background read as "full
 * screen"; the result is then widened only if covering the height alone would leave
 * a horizontal gap. Either way exactly one uniform scale is used on both axes, so the
 * picture is never distorted, mirrored, tiled or squashed -- only uniformly scaled,
 * and the excess cropped.
 *
 * The overflow is centred on each axis, which crops evenly at both edges instead of
 * biasing the artwork to one side.
 */
fun fitBackdrop(
    imageWidth: Float,
    imageHeight: Float,
    floorRow: Float,
    worldWidth: Float,
    viewportHeight: Float,
    framing: Framing = Framing()
): SceneBackdropFit {
    // Cover on height first...
    var scale = viewportHeight / imageHeight
    // ...then raise it if that would leave the world horizontally uncovered.
    if (imageWidth * scale < worldWidth) scale = worldWidth / imageWidth

    val drawWidth = imageWidth * scale
    val drawHeight = imageHeight * scale
    // Centred, so overflow crops evenly. Negative on any axis that overflows.
    val offsetX = (worldWidth - drawWidth) / 2f
    val offsetY = (viewportHeight - drawHeight) / 2f

    val floorY = offsetY + floorRow * scale
    val footScreenY = framing.footScreenY ?: viewportHeight * FOOT_TARGET_VIEWPORT_FRACTION

    return SceneBackdropFit(
        scale = scale,
        drawWidth = drawWidth,
        drawHeight = drawHeight,
        offsetX = offsetX,
        offsetY = offsetY,
        floorY = floorY,
        footScreenY = footScreenY,
        // Derived from the artwork's own floor unless the scene overrides it, so a
        // scene cannot end up framed inconsistently with where its ground is.
        cameraYOffset = framing.cameraYOffset ?: (footScreenY - floorY)
    )
}

/** Per-scene vertical framing: where the floor should be drawn, or an explicit offset. */
data class Framing(
    /** Screen Y the floor is drawn at. Defaults to the shared target. */
    val footScreenY: Float? = null,
    /** Explicit vertical offset, overriding the derived one. */
    val cameraYOffset: Float? = null
)

/** Static description of one environment. */
data class SceneDefinition(
    /** Stable identifier, matching the scene id used by the web engine. */
    val id: String,
    /** Display name shown on the transition card, e.g. "THE UNDERGROUND CAVERN". */
    val title: String,
    /** Resource name of the backdrop, matching the drawable filename stem. */
    val asset: String,
    /**
     * Native pixel size of the backdrop artwork.
     *
     * Declared rather than read off the decoded bitmap so a scene's geometry -- its
     * scale, crop and floor plane -- is fully determined by its definition, which
     * keeps it computable without loading anything and directly comparable with the
     * web engine.
     */
    val sourceWidth: Float,
    val sourceHeight: Float,
    /**
     * Row of the visible floor surface in the source artwork, measured from the top.
     *
     * Both backdrops share one structure: dark wall, then a lit floor band, then a
     * dark foreground that runs off the bottom. The floor is the row where the band
     * begins, which is a real step in the image rather than a guessed fraction of it.
     */
    val floorRow: Float,
    /** Width of this scene's world, in logical pixels. Each scene bounds itself. */
    /**
     * Optional explicit vertical framing, in logical pixels. Left unset, the scene
     * is framed so its own floor lands on the shared target screen Y.
     */
    val cameraYOffset: Float? = null,
    val worldWidth: Float,
    /** World X the player is placed at when this scene loads. */
    val spawnX: Float,
    /**
     * World X of this scene's training dummies, in world units.
     *
     * Explicit per scene: objects belong to the scene that declares them and are
     * rebuilt on entry, so one scene's fixtures never carry into the next unless that
     * scene lists its own.
     */
    val dummyXs: List<Float>,
    /**
     * World X at which this scene hands over to the next one, or null when the scene
     * is a dead end and has nowhere to go.
     */
    val exitX: Float?
)

/**
 * The Forgotten Prison: the opening scene.
 *
 * Its 1536x864 artwork covers a 640-wide scene at exactly 5/12, which is the same
 * scale and the same alignment the prison has always used, so this scene renders as
 * before. Only what surrounds it has changed.
 */
val FORGOTTEN_PRISON = SceneDefinition(
    id = "forgotten_prison",
    title = "THE FORGOTTEN PRISON",
    asset = "img_arena_bg_hd",
    sourceWidth = 1536f,
    sourceHeight = 864f,
    floorRow = 533f,
    worldWidth = 640f,
    spawnX = 320f,
    dummyXs = listOf(450f, 570f),
    // The player is clamped to worldWidth - width/2, so the exit sits exactly where
    // walking into the right-hand wall brings them to a stop.
    exitX = 618f
)

/**
 * The Underground Cavern: the scene that follows the prison.
 *
 * The cavern is a *world*, not a backdrop: its width is the artwork's own 1536px,
 * and the 640px viewport is a window the camera moves across it. That is why the
 * world is not fitted to the viewport -- fitting would shrink a 1536x512 plate down
 * to fill 640x360 and leave nothing to scroll through.
 *
 * At its native size the plate already covers the world's full width, so the fit
 * lands on a scale of exactly 1 and crops only vertically, centring the 512px
 * artwork in the 360px viewport. The camera then shows a genuine cropped section of
 * one continuous painting: nothing is stretched, mirrored, tiled or repeated.
 */
val UNDERGROUND_CAVERN = SceneDefinition(
    id = "underground_cavern",
    title = "THE UNDERGROUND CAVERN",
    asset = "img_underground_cavern_hd",
    sourceWidth = 1536f,
    sourceHeight = 512f,
    floorRow = 391f,
    // The world's width is the artwork's own, so the whole painting is the world and
    // the camera scrolls across all of it.
    worldWidth = 1536f,
    // Entered from the left, at the mouth of the cave, with room to walk both ways.
    spawnX = 768f,
    // Deliberately not the prison's 450/570: the cavern declares its own fixtures.
    dummyXs = listOf(900f, 1020f),
    exitX = null
)

/**
 * Scenes in travel order.
 *
 * Walking off the right edge of a scene advances to the next entry; the last scene
 * has no successor and simply stops the player at its boundary.
 */
val SCENES: List<SceneDefinition> = listOf(FORGOTTEN_PRISON, UNDERGROUND_CAVERN)

/** Index of the scene the game opens on. */
const val STARTING_SCENE_INDEX = 0

/** Duration of the whole scene handover, in seconds. */
const val TRANSITION_FADE_OUT = 0.3f
const val TRANSITION_TITLE_HOLD = 0.4f
const val TRANSITION_FADE_IN = 0.3f
const val TRANSITION_TOTAL = TRANSITION_FADE_OUT + TRANSITION_TITLE_HOLD + TRANSITION_FADE_IN

/** Stage of a scene handover. */
enum class SceneTransitionPhase { IDLE, FADING_OUT, TITLE, FADING_IN }

/**
 * A single drifting mote of cave fog, used only while a scene is handing over.
 *
 * Kept as plain data so both engines can animate and draw it identically from the
 * same seed.
 */
data class FogMote(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    val size: Float
)

/**
 * Builds the fog mote field for a transition.
 *
 * Deterministic in [seed] so both engines draw the same drift rather than each
 * producing different weather. Uses the same 32-bit LCG arithmetic as the web engine.
 */
fun buildFogMotes(seed: Int, count: Int, worldWidth: Float, viewportHeight: Float): List<FogMote> {
    val motes = ArrayList<FogMote>(count)
    var state = (seed * 1103515245 + 12345) and 0xFFFFFFFF
    fun next(): Float {
        state = (state * 1103515245 + 12345) and 0xFFFFFFFF
        return state.toFloat() / 4294967296f
    }
    for (i in 0 until count) {
        motes.add(
            FogMote(
                x = next() * worldWidth,
                y = next() * viewportHeight,
                vx = (next() - 0.5f) * 14f,
                vy = -6f - next() * 10f,
                size = 1f + next() * 2f
            )
        )
    }
    return motes
}

/** Advances a fog mote field, wrapping motes that leave the viewport. */
fun updateFogMotes(motes: List<FogMote>, dt: Float, worldWidth: Float, viewportHeight: Float) {
    for (m in motes) {
        m.x += m.vx * dt
        m.y += m.vy * dt
        if (m.y < -8f) {
            m.y = viewportHeight + 8f
            m.x = ((m.x + worldWidth * 0.37f) % worldWidth + worldWidth) % worldWidth
        }
        if (m.x < -8f) m.x += worldWidth + 16f
        if (m.x > worldWidth + 8f) m.x -= worldWidth + 16f
    }
}
