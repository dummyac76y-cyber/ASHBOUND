package com.example.game.engine

/**
 * The NPC sprite set: what exists today, and the slots waiting to be filled.
 *
 * Data only, mirroring `web/src/game/npcAssets.ts`. The NPC is not yet placed in a
 * scene, so this records the asset contract rather than driving any rendering.
 *
 * Cell size is fixed at 128 because the artwork already is: the single reference is
 * a 128x128 cell and the 12-frame sheet is twelve of them side by side, matching
 * the cell size the player's sheets use.
 *
 * Nothing here is resampled, re-encoded or re-anchored. The sheets are stored
 * exactly as supplied, and [NPC_BASELINE_Y] is a measurement of that artwork rather
 * than a correction applied to it.
 */

/** Every sprite in the set is cut into square cells of this size. */
const val NPC_CELL_SIZE = 128

/**
 * Which way the supplied artwork natively faces.
 *
 * Measured from the sheet rather than assumed, because getting it wrong makes the
 * NPC moonwalk: in all twelve frames the head and upper body sit to the *left* of the
 * legs (the head's centroid is ~13px left of the feet's), the arm reaches forward to
 * the left, and the figure's mass trails off to the right. The sheet is therefore
 * drawn facing left, and an NPC travelling right has to be mirrored for its stride
 * to agree with its movement.
 *
 * This describes the file, it is not a preference. New artwork may face the other
 * way, and this is the one line that has to change when it does.
 */
const val NPC_ART_FACES_RIGHT = false

/**
 * Source rows of visible artwork in the player's idle frame, and in the NPC's.
 *
 * The cells are the same size in both sheets, so a 128px cell drawn at one size
 * fills the same amount of the screen for both characters -- but neither sheet fills
 * its own cell. The player draws 97 of 128 rows and the NPC only 81..86, so drawing
 * both cells at the same size makes the NPC visibly shorter than the knight even
 * though the two are nominally identical.
 *
 * Measured from the alpha channel of the files themselves; mirrored from
 * `npcAssets.ts`, and checked by `verify-npc-assets.mjs`.
 */
const val PLAYER_VISIBLE_ROWS = 97

/** Tallest visible artwork in the NPC's walk cycle, in source rows. */
const val NPC_MAX_VISIBLE_ROWS = 86

/**
 * How much larger the NPC's cell is drawn than the player's, so the two end up the
 * same height on screen.
 *
 * Derived from the two measurements above. Matching height rather than width is
 * deliberate: height is what reads as a character's size, and the NPC's artwork is
 * genuinely wider than the player's, so matching width would leave the NPC looking
 * much smaller than the knight.
 *
 * A single uniform factor, so proportions, nearest-neighbour sampling and the foot
 * baseline are all preserved. The artwork on disk is never resampled.
 */
const val NPC_VISIBLE_SCALE = PLAYER_VISIBLE_ROWS.toFloat() / NPC_MAX_VISIBLE_ROWS.toFloat()

/**
 * The row the NPC's feet rest on, measured from the top of its cell.
 *
 * All twelve frames of the walk sheet already share it, so no frame is shifted.
 * Recording it means every motion draws against one ground line, which is what
 * stops the NPC bobbing as its animation changes.
 */
const val NPC_BASELINE_Y = 104

/**
 * Sprite filtering, pinned rather than inherited from the renderer.
 *
 * Pixel art sampled with smoothing blurs its own edges, and these frames are
 * delivered with hard alpha, so anything that interpolates them would soften the
 * artwork.
 */
const val NPC_NEAREST_NEIGHBOR = true

/** How a sheet's frames are arranged inside the image. */
enum class NpcSheetLayout {
    /** Frames side by side in one row. */
    STRIP,

    /** Frames packed into an 8x8 grid, a 1024x1024 image. */
    GRID
}

/** One sprite in the NPC set. */
data class NpcSheetDefinition(
    /** File name inside the sprites asset folder, extension included. */
    val file: String,
    /** What the sheet is for. */
    val role: String,
    val layout: NpcSheetLayout,
    /** Frames the sheet holds. For a sheet that exists yet, this is measured. */
    val frames: Int,
    /** Whether the artwork is in the repository yet. */
    val present: Boolean
)

/**
 * The single reference sprite as supplied, unwrapped and unaltered.
 *
 * It shares its pose with frame 0 of the walk sheet, so it is a still of that
 * cycle rather than a separate motion.
 */
val NPC_BASE = NpcSheetDefinition(
    file = "npc.png",
    role = "Single-frame reference, matching the walk sheet at frame 0.",
    layout = NpcSheetLayout.STRIP,
    frames = 1,
    present = true
)

/**
 * The 12-frame walk cycle as supplied, unwrapped and unaltered.
 *
 * Named for the idle-and-walk sheet it came from. Every frame is a different point
 * in one continuous stride, so the whole file plays as the walk; see [NPC_CLIPS]
 * for why idle is not carved out of it.
 */
val NPC_IDLE_WALK_SHEET = NpcSheetDefinition(
    file = "npc_idle_walk.png",
    role = "The walk cycle, 12 frames of 128px. Stored as supplied.",
    layout = NpcSheetLayout.STRIP,
    frames = 12,
    present = true
)

/** The sheets still to be drawn, in the order an NPC would need them. */
val NPC_PENDING_SHEETS = listOf(
    NpcSheetDefinition(
        file = "npc_idle.png",
        role = "A standing loop of its own, to replace the empty idle binding below.",
        layout = NpcSheetLayout.STRIP,
        frames = 6,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_walk.png",
        role = "Ground locomotion as a standalone sheet, if the walk ever outgrows this cycle.",
        layout = NpcSheetLayout.STRIP,
        frames = 12,
        present = false
    ),
    NpcSheetDefinition(
        // Kept under the name it was requested with, though the dotted form is out
        // of step with the rest of the set.
        file = "npc.dash.png",
        role = "Burst of speed.",
        layout = NpcSheetLayout.STRIP,
        frames = 8,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_attack.png",
        role = "Light attack.",
        layout = NpcSheetLayout.GRID,
        frames = 8,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_heavy.png",
        role = "Heavy attack, the NPC counterpart of the knight heavy attack.",
        layout = NpcSheetLayout.GRID,
        frames = 8,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_hurt.png",
        role = "Reaction to taking a hit.",
        layout = NpcSheetLayout.STRIP,
        frames = 8,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_death.png",
        role = "Death, played once and not looped.",
        layout = NpcSheetLayout.STRIP,
        frames = 10,
        present = false
    )
)

/** Every sheet in the set, present ones first. */
val NPC_ASSET_SET = listOf(NPC_BASE, NPC_IDLE_WALK_SHEET) + NPC_PENDING_SHEETS

/** Pixel width a sheet of this definition occupies. */
fun npcSheetWidth(sheet: NpcSheetDefinition): Int =
    if (sheet.layout == NpcSheetLayout.GRID) NPC_CELL_SIZE * 8 else NPC_CELL_SIZE * sheet.frames

/** Pixel height a sheet of this definition occupies. */
fun npcSheetHeight(sheet: NpcSheetDefinition): Int =
    if (sheet.layout == NpcSheetLayout.GRID) NPC_CELL_SIZE * 8 else NPC_CELL_SIZE

/**
 * A motion, bound to a run of frames on a sheet.
 *
 * Each clip names its own sheet and frame range, which is what lets idle and walk
 * be pointed at different artwork later without touching each other. Every clip
 * draws against [NPC_BASELINE_Y], so swapping one does not move the NPC's feet.
 */
data class NpcClip(
    /** Which motion this is. */
    val name: String,
    /** Sheet the frames come from, or null while the motion has no artwork yet. */
    val sheet: String?,
    /** Index of the first frame within that sheet. */
    val firstFrame: Int,
    /** How many frames play. Zero means the motion is unassigned. */
    val frameCount: Int,
    /** Whether the last frame wraps to the first. */
    val loops: Boolean,
    /** Frames played per second while this clip runs. */
    val fps: Int
)

/**
 * The motions the NPC has, bound independently of one another.
 *
 * The 12-frame sheet is named idle-and-walk, but measuring it shows one continuous
 * stride: in all twelve frames the two feet sit at different heights and different
 * x positions, and the forward foot alternates across the file, wrapping from the
 * last frame back to the first. No frame is a planted, stationary stance, so there
 * is no idle range to cut from it. Rather than re-time a walk frame to fake a
 * standing pose -- which would be a pose that was never drawn -- idle is left
 * unassigned and walk takes the whole cycle.
 *
 * When idle artwork arrives, either point `idle` at its own sheet or hand it a
 * range of a shared one; neither binding disturbs walk.
 */
val NPC_CLIPS = listOf(
    NpcClip(
        name = "idle",
        sheet = NPC_IDLE_WALK_SHEET.file,
        firstFrame = 0,
        frameCount = 1,
        loops = true,
        fps = NPC_IDLE_FPS
    ),
    NpcClip(
        name = "walk",
        sheet = NPC_IDLE_WALK_SHEET.file,
        firstFrame = 0,
        frameCount = NPC_IDLE_WALK_SHEET.frames,
        loops = true,
        fps = NPC_WALK_FPS
    )
)

/** Frames played per second by walk, matching the player's own cadence. */
const val NPC_WALK_FPS = 12

/**
 * Frames played per second by idle. Idle holds a single frame, so this only sets the
 * cadence it would run at.
 */
const val NPC_IDLE_FPS = 6

/** A clip with no artwork, used as the fallback for an unbound state. */
fun emptyClip(name: String, fps: Int): NpcClip = NpcClip(name, null, 0, 0, true, fps)

/** True while this clip has artwork behind it. */
fun NpcClip.isAssigned(): Boolean = sheet != null && frameCount > 0
