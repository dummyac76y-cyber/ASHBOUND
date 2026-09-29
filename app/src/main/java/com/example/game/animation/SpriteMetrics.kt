package com.example.game.animation

/**
 * Sprite cell metrics measured directly from the artwork.
 *
 * The 128x128 sprite cells are not filled edge to edge: opaque content stops short
 * of the cell boundary, so anchoring the player on the *cell* rectangle leaves the
 * visible feet floating. The anchor is the feet, and the offsets below are the exact
 * correction for each animation frame.
 */
object SpriteMetrics {

    /** Native height of one sprite sheet cell, in source pixels. */
    const val SPRITE_CELL_HEIGHT = 128f

    /**
     * Bottom-most opaque row of the canonical rest pose (idle), used as the default
     * for any sheet that has no measured data of its own.
     */
    const val DEFAULT_FOOT_ROW = 111

    /**
     * Bottom-most opaque source row per frame, measured per sheet by scanning the
     * alpha channel. Idle is a constant 111 across all 12 frames; the walk cycle
     * ranges over 110..112 because the cloak sways, so a single global offset would
     * leave those frames up to 0.78 logical px off the floor.
     *
     * Jump spans 113..119 across its 10 frames. Those rows are the feet *within the
     * cell*, and most of the jump arc is airborne, so this is the same measure taken
     * per frame: it keeps the launch and landing frames seated on the floor plane
     * while the rise in between is genuine vertical motion rather than drift.
     */
    private val FOOT_ROWS_BY_SHEET: Map<String, List<Int>> = mapOf(
        "idle.png" to listOf(111, 111, 111, 111, 111, 111, 111, 111, 111, 111, 111, 111),
        "walk.png" to listOf(111, 111, 110, 110, 110, 111, 110, 111, 112, 112, 112, 112),
        "jump.png" to listOf(115, 113, 115, 119, 119, 119, 119, 119, 119, 119),
        // The attack sheet is a 4x4 grid of 256px cells and every frame plants its
        // feet on the same row, so the constant 198 keeps the whole swing seated on
        // the floor. These are rows within a 256 cell, not a 128 one.
        "attack.png" to List(16) { 198 },
        // The heavy attack sheet is a 5x5 grid of 256px cells. Its foot row is
        // likewise constant across all 25 frames, so the whole windup, swing and
        // recovery stay planted while the character moves through them.
        "heavy_attack.png" to List(25) { 196 }
    )

    /** Per-frame foot rows for a sheet, or an empty list when it has no measured data. */
    fun footRowsFor(sheetFileName: String): List<Int> = FOOT_ROWS_BY_SHEET[sheetFileName] ?: emptyList()

    /**
     * How far below the feet plane the sprite's draw-rect bottom must sit so the
     * visible opaque pixels of that frame land exactly on it.
     *
     * [cellHeight] is the sheet's native cell height: 128 for the strip sheets but
     * 256 for the grid-packed attack sheet. [displaySize] must already include any
     * per-sheet display scale, so this stays a pure ratio of the cell.
     */
    fun footOffsetForRow(row: Int, displaySize: Float, cellHeight: Float = SPRITE_CELL_HEIGHT): Float =
        (cellHeight - 1f - row) / cellHeight * displaySize
}
