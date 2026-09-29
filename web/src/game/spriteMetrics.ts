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
 * channel. Idle is a constant 111 across all 12 frames; the walk cycle ranges over
 * 110..112 because the cloak sways, so a single global offset would leave those
 * frames up to 0.78 logical px off the floor.
 */
export const FOOT_ROWS_BY_SHEET: Readonly<Record<string, readonly number[]>> = {
  'idle.png': [111, 111, 111, 111, 111, 111, 111, 111, 111, 111, 111, 111],
  'walk.png': [111, 111, 110, 110, 110, 111, 110, 111, 112, 112, 112, 112],
}

/** Per-frame foot rows for a sheet, or null when it has no measured data. */
export function footRowsFor(sheetFileName: string): readonly number[] | null {
  return FOOT_ROWS_BY_SHEET[sheetFileName] ?? null
}

/**
 * How far below the feet plane the sprite's draw-rect bottom must sit so the visible
 * opaque pixels of that frame land exactly on it.
 */
export function footOffsetForRow(row: number, displaySize: number): number {
  return ((SPRITE_CELL_HEIGHT - 1 - row) / SPRITE_CELL_HEIGHT) * displaySize
}
