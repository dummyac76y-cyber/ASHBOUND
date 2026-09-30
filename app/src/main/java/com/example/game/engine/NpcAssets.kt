package com.example.game.engine

/**
 * The NPC sprite set: what exists today, and the slots waiting to be filled.
 *
 * Data only, mirroring `web/src/game/npcAssets.ts`. The NPC is not animated, not
 * loaded and not placed in a scene yet -- this records the asset contract so the
 * artwork can be dropped in later without inventing the naming, cell size or
 * layout at that point.
 *
 * Cell size is fixed at 128 because the base reference is a single 128x128 cell,
 * the same cell size the player's sheets use, so an NPC can be drawn at the
 * player's scale without resampling.
 *
 * Frame counts are defaults matching the player's equivalent sheets, not
 * measurements.
 */

/** Every sprite in the set is cut into square cells of this size. */
const val NPC_CELL_SIZE = 128

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
    /** Frames the sheet is expected to hold. A default, not a measurement. */
    val frames: Int,
    /**
     * Whether the artwork is in the repository yet. Exactly one sheet is
     * `present` today: the base reference.
     */
    val present: Boolean
)

/**
 * The base reference: the exact NPC sprite as supplied, unwrapped and unaltered.
 *
 * Single frame, so it is neither a strip nor a grid; it exists to be looked at and
 * to cut the other sheets from.
 */
val NPC_BASE = NpcSheetDefinition(
    file = "npc.png",
    role = "Base reference sprite. Single cell, not animated.",
    layout = NpcSheetLayout.STRIP,
    frames = 1,
    present = true
)

/** The sheets still to be drawn, in the order an NPC would need them. */
val NPC_SHEETS = listOf(
    NpcSheetDefinition(
        file = "npc_idle.png",
        role = "Standing loop, cut from the base reference.",
        layout = NpcSheetLayout.STRIP,
        frames = 6,
        present = false
    ),
    NpcSheetDefinition(
        file = "npc_walk.png",
        role = "Ground locomotion, cut from the base reference.",
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

/** The base reference followed by every sheet awaiting artwork. */
val NPC_ASSET_SET = listOf(NPC_BASE) + NPC_SHEETS

/** Pixel width a sheet of this definition occupies. */
fun npcSheetWidth(sheet: NpcSheetDefinition): Int =
    if (sheet.layout == NpcSheetLayout.GRID) NPC_CELL_SIZE * 8 else NPC_CELL_SIZE * sheet.frames

/** Pixel height a sheet of this definition occupies. */
fun npcSheetHeight(sheet: NpcSheetDefinition): Int =
    if (sheet.layout == NpcSheetLayout.GRID) NPC_CELL_SIZE * 8 else NPC_CELL_SIZE
