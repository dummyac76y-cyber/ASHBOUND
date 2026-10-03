/**
 * Sprite cell metrics measured directly from the artwork.
 *
 * The 128x128 sprite cells are not filled edge to edge: opaque content stops short
 * of the cell boundary, so anchoring the player on the *cell* rectangle leaves the
 * visible feet floating. The anchor is the feet, and the offsets below are the exact
 * correction for each animation frame.
 */

/** Native height of one sprite sheet cell, in source pixels. */
export const SPRITE_CELL_HEIGHT = 128

/**
 * Bottom-most opaque row of the canonical rest pose (idle), used as the default for
 * any sheet that has no measured data of its own.
 */
export const DEFAULT_FOOT_ROW = 111

/**
 * Bottom-most opaque source row per frame, measured per sheet by scanning the alpha
 * channel. Idle is a constant 111 across all 6 frames; the walk cycle ranges over
 * 110..112 because the cloak sways, so a single global offset would leave those
 * frames up to 0.78 logical px off the floor.
 *
 * Jump is a constant 115 across all 8 frames. That sheet draws the character
 * compressing as it takes off rather than rising inside the cell, so the feet never
 * move relative to the cell and the whole animation stays seated on the floor plane;
 * the vertical travel is the world's arc, applied on top of this offset.
 */
export const FOOT_ROWS_BY_SHEET: Readonly<Record<string, readonly number[]>> = {
  'idle.png': [111, 111, 111, 111, 111, 111],
  // idle_variant.png is 8 frames of the 128px strip, and unlike idle it does NOT hold one row:
  // it drifts 115..117 as the character rises through the gesture. A single constant would
  // leave the late frames up to 2 source rows off the floor, which is about 0.19 logical px at
  // this sheet's display scale -- enough to read as the character sliding as it settles.
  'idle_variant.png': [115, 115, 116, 116, 117, 117, 117, 117],
  'walk.png': [111, 111, 110, 110, 110, 111, 110, 111, 112, 112, 112, 112],
  'jump.png': [115, 115, 115, 115, 115, 115, 115, 115],
  // The block sheet is 8 frames of the 128px strip and holds one foot row across
  // all of them, so the guard stance stays planted while it cycles.
  'block.png': [115, 115, 115, 115, 115, 115, 115, 115],
  // The attack sheet is a 4x4 grid of 256px cells and every frame plants its feet
  // on the same row, so the constant 198 keeps the whole swing seated on the
  // floor. These are rows within a 256 cell, not a 128 one.
  'attack.png': [198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198, 198],
  // The heavy attack sheet is a 5x5 grid of 256px cells. Its foot row is likewise
  // constant across all 25 frames, so the whole windup, swing and recovery stay
  // planted while the character moves through them.
  'heavy_attack.png': [
    196, 196, 196, 196, 196, 196, 196, 196, 196, 196, 196, 196, 196,
    196, 196, 196, 196, 196, 196, 196, 196, 196, 196, 196, 196,
  ],
}

/** Per-frame foot rows for a sheet, or null when it has no measured data. */
export function footRowsFor(sheetFileName: string): readonly number[] | null {
  return FOOT_ROWS_BY_SHEET[sheetFileName] ?? null
}

/**
 * How far below the feet plane the sprite's draw-rect bottom must sit so the visible
 * opaque pixels of that frame land exactly on it.
 *
 * `cellHeight` is the sheet's native cell height, which is 128 for the strip sheets
 * but 256 for the grid-packed attack sheet. `displaySize` must already include any
 * per-sheet display scale, so this stays a pure ratio of the cell.
 */
export function footOffsetForRow(row: number, displaySize: number, cellHeight: number = SPRITE_CELL_HEIGHT): number {
  return ((cellHeight - 1 - row) / cellHeight) * displaySize
}
