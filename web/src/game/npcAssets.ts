/**
 * The NPC sprite set: what exists today, and the slots waiting to be filled.
 *
 * This is deliberately data only. The NPC is not animated, not loaded and not
 * placed in a scene yet -- this module records the asset contract so the artwork
 * can be dropped in later without anyone having to invent the naming, the cell
 * size or the layout by hand at that point.
 *
 * Cell size is fixed at 128 because that is what the base reference already is:
 * `npc.png` is a single 128x128 cell, the same cell size the player's sheets use.
 * Every other sheet is built from that same cell, so an NPC can be drawn at the
 * player's scale without resampling.
 *
 * Frame counts below are defaults chosen to match the player's equivalent
 * sheets, not measurements. They describe the shape of the file to produce, and
 * a sheet that ends up with a different count only needs this table updated --
 * nothing else reads it yet.
 */

/** Every sprite in the set is cut into square cells of this size. */
export const NPC_CELL_SIZE = 128

/** How a sheet's frames are arranged inside the image. */
export type NpcSheetLayout =
  /** Frames side by side in one row: `frames * 128` wide by `128` tall. */
  | 'strip'
  /**
   * Frames packed into an 8x8 grid of 128px cells, a 1024x1024 image.
   *
   * Used for the attack sheets, matching the player's grid-packed attack art:
   * those animations are long, and a single row would make an unwieldy image.
   */
  | 'grid'

/** One sprite in the NPC set. */
export interface NpcSheetDefinition {
  /** File name inside the sprites asset folder, extension included. */
  readonly file: string
  /** What the sheet is for. */
  readonly role: string
  readonly layout: NpcSheetLayout
  /** Frames the sheet is expected to hold. A default, not a measurement. */
  readonly frames: number
  /**
   * Whether the artwork is in the repository yet.
   *
   * Exactly one sheet is `present` today: the base reference. The rest are
   * declared so the slots are unambiguous, and are expected to be absent --
   * a `pending` sheet that has quietly appeared would mean artwork landed without
   * anyone deciding it was finished.
   */
  readonly status: 'present' | 'pending'
}

/**
 * The base reference: the exact NPC sprite as supplied, unwrapped and unaltered.
 *
 * Single frame, so it is neither a strip nor a grid; it exists to be looked at and
 * to cut the other sheets from.
 */
export const NPC_BASE: NpcSheetDefinition = {
  file: 'npc.png',
  role: 'Base reference sprite. Single cell, not animated.',
  layout: 'strip',
  frames: 1,
  status: 'present',
}

/** The sheets still to be drawn, in the order an NPC would need them. */
export const NPC_SHEETS: readonly NpcSheetDefinition[] = [
  {
    file: 'npc_idle.png',
    role: 'Standing loop, cut from the base reference.',
    layout: 'strip',
    frames: 6,
    status: 'pending',
  },
  {
    file: 'npc_walk.png',
    role: 'Ground locomotion, cut from the base reference.',
    layout: 'strip',
    frames: 12,
    status: 'pending',
  },
  {
    file: 'npc.dash.png',
    role: 'Burst of speed. Kept under the name it was requested with, though the dotted form is out of step with the rest of the set.',
    layout: 'strip',
    frames: 8,
    status: 'pending',
  },
  {
    file: 'npc_attack.png',
    role: 'Light attack.',
    layout: 'grid',
    frames: 8,
    status: 'pending',
  },
  {
    file: 'npc_heavy.png',
    role: 'Heavy attack, the NPC counterpart of the knight heavy attack.',
    layout: 'grid',
    frames: 8,
    status: 'pending',
  },
  {
    file: 'npc_hurt.png',
    role: 'Reaction to taking a hit.',
    layout: 'strip',
    frames: 8,
    status: 'pending',
  },
  {
    file: 'npc_death.png',
    role: 'Death, played once and not looped.',
    layout: 'strip',
    frames: 10,
    status: 'pending',
  },
]

/** The base reference followed by every sheet awaiting artwork. */
export const NPC_ASSET_SET: readonly NpcSheetDefinition[] = [NPC_BASE, ...NPC_SHEETS]

/** Pixel width a sheet of this definition occupies. */
export function npcSheetWidth(sheet: NpcSheetDefinition): number {
  return sheet.layout === 'grid' ? NPC_CELL_SIZE * 8 : NPC_CELL_SIZE * sheet.frames
}

/** Pixel height a sheet of this definition occupies. */
export function npcSheetHeight(sheet: NpcSheetDefinition): number {
  return sheet.layout === 'grid' ? NPC_CELL_SIZE * 8 : NPC_CELL_SIZE
}
