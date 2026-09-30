/**
 * The NPC sprite set: what exists today, and the slots waiting to be filled.
 *
 * This is deliberately data only. The NPC is not yet placed in a scene, so this
 * module records the asset contract -- names, cell size, filtering, the baseline
 * the feet are anchored to, and which frames each motion plays -- rather than
 * driving any rendering itself.
 *
 * Cell size is fixed at 128 because that is what the artwork already is. The
 * single reference sprite is a 128x128 cell and the 12-frame sheet is twelve of
 * them side by side, matching the cell size the player's sheets use. An NPC can
 * therefore be drawn at the player's scale without resampling.
 *
 * Nothing here is resampled, re-encoded or re-anchored. The sheets are stored
 * exactly as supplied, and `NPC_BASELINE_Y` is a measurement of that artwork
 * rather than a correction applied to it -- see `scripts/verify-npc-assets.mjs`,
 * which re-derives it from the files and fails if the two ever disagree.
 */

/** Every sprite in the set is cut into square cells of this size. */
export const NPC_CELL_SIZE = 128

/**
 * Source rows of visible artwork in the player's idle frame, and in the NPC's.
 *
 * The cells are the same size in both sheets, so a 128px cell drawn at one size
 * fills the same amount of the screen for both characters -- but neither sheet
 * fills its own cell. The player draws 97 of 128 rows and the NPC only 81..86,
 * so drawing both cells at the same size makes the NPC visibly shorter than the
 * knight even though the two are nominally identical.
 *
 * Measured from the alpha channel of the files themselves; see
 * `scripts/verify-npc-assets.mjs`, which re-derives these and fails if the
 * declared numbers ever stop matching the artwork.
 */
export const PLAYER_VISIBLE_ROWS = 97

/** Tallest visible artwork in the NPC's walk cycle, in source rows. */
export const NPC_MAX_VISIBLE_ROWS = 86

/**
 * How much larger the NPC's cell is drawn than the player's, so the two end up
 * the same height on screen.
 *
 * Derived from the two measurements above: the NPC fills a smaller fraction of
 * its cell, so drawing its cell proportionally larger is what makes its visible
 * height match the player's. Matching height rather than width is deliberate --
 * height is what reads as a character's size, and the NPC's artwork is genuinely
 * wider than the player's, so matching width instead would leave the NPC looking
 * much smaller than the knight.
 *
 * A single uniform factor: it scales the NPC's whole cell, so its proportions,
 * its nearest-neighbour sampling and its baseline are all preserved. It is a
 * display-size choice only -- the artwork on disk is never resampled or re-encoded.
 */
export const NPC_VISIBLE_SCALE = PLAYER_VISIBLE_ROWS / NPC_MAX_VISIBLE_ROWS

/**
 * The row the NPC's feet rest on, measured from the top of its cell.
 *
 * All twelve frames of the walk sheet already share it, so no frame needs shifting
 * and none is shifted. It is recorded so every motion draws against one ground
 * line: a clip assigned later draws its frames to this same row, which is what
 * keeps the NPC from bobbing as its animation changes.
 */
export const NPC_BASELINE_Y = 104

/**
 * Sprite filtering, pinned rather than inherited from the renderer.
 *
 * Pixel art sampled with smoothing blurs its own edges, and the frames here are
 * delivered with hard alpha, so anything that interpolates them would visibly
 * soften the artwork.
 */
export const NPC_NEAREST_NEIGHBOR = true

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
  /** Frames the sheet holds. For a sheet that exists yet, this is measured. */
  readonly frames: number
  /**
   * Whether the artwork is in the repository yet.
   *
   * A `pending` sheet is expected to be absent -- artwork that quietly appeared
   * without anyone deciding it was finished would be worse than a gap.
   */
  readonly status: 'present' | 'pending'
}

/**
 * The single reference sprite as supplied, unwrapped and unaltered.
 *
 * One frame, so it is neither a strip nor a grid. It shares its pose with frame 0
 * of the walk sheet, so it is a still of that cycle rather than a separate motion.
 */
export const NPC_BASE: NpcSheetDefinition = {
  file: 'npc.png',
  role: 'Single-frame reference, matching the walk sheet at frame 0.',
  layout: 'strip',
  frames: 1,
  status: 'present',
}

/**
 * The 12-frame walk cycle as supplied, unwrapped and unaltered.
 *
 * Named for the idle-and-walk sheet it came from. Every frame is a different
 * point in one continuous stride, so the whole file plays as the walk; see
 * `NPC_CLIPS` for why idle is not carved out of it.
 */
export const NPC_IDLE_WALK_SHEET: NpcSheetDefinition = {
  file: 'npc_idle_walk.png',
  role: 'The walk cycle, 12 frames of 128px. Stored as supplied.',
  layout: 'strip',
  frames: 12,
  status: 'present',
}

/** The sheets still to be drawn, in the order an NPC would need them. */
export const NPC_SHEETS: readonly NpcSheetDefinition[] = [
  NPC_IDLE_WALK_SHEET,
  {
    file: 'npc_idle.png',
    role: 'A standing loop of its own, to replace the empty idle binding below.',
    layout: 'strip',
    frames: 6,
    status: 'pending',
  },
  {
    file: 'npc_walk.png',
    role: 'Ground locomotion as a standalone sheet, if the walk ever outgrows this cycle.',
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

/** Every sheet in the set, present ones first. */
export const NPC_ASSET_SET: readonly NpcSheetDefinition[] = [
  NPC_BASE,
  NPC_IDLE_WALK_SHEET,
  ...NPC_SHEETS.filter((s) => s.status === 'pending'),
]

/** Pixel width a sheet of this definition occupies. */
export function npcSheetWidth(sheet: NpcSheetDefinition): number {
  return sheet.layout === 'grid' ? NPC_CELL_SIZE * 8 : NPC_CELL_SIZE * sheet.frames
}

/** Pixel height a sheet of this definition occupies. */
export function npcSheetHeight(sheet: NpcSheetDefinition): number {
  return sheet.layout === 'grid' ? NPC_CELL_SIZE * 8 : NPC_CELL_SIZE
}

/** Frames played per second by walk, matching the player's own cadence. */
export const NPC_WALK_FPS = 12

/** Frames played per second by idle. Idle holds a single frame, so this only sets the cadence it would run at. */
export const NPC_IDLE_FPS = 6

/**
 * A motion, bound to a run of frames on a sheet.
 *
 * Each clip names its own sheet and its own frame range, which is what lets idle
 * and walk be pointed at different artwork later without touching each other.
 * Every clip draws against `NPC_BASELINE_Y`, so swapping one does not move the
 * NPC's feet.
 */
export interface NpcClip {
  /** Which motion this is. */
  readonly name: string
  /** Sheet the frames come from, or null while the motion has no artwork yet. */
  readonly sheet: string | null
  /** Index of the first frame within that sheet. */
  readonly firstFrame: number
  /** How many frames play. Zero means the motion is unassigned. */
  readonly frameCount: number
  /** Whether the last frame wraps to the first. */
  readonly loops: boolean
  /** Frames played per second while this clip runs. */
  readonly fps: number
}

/**
 * The motions the NPC has, bound independently of one another.
 *
 * The 12-frame sheet is named idle-and-walk, but measuring it shows one continuous
 * stride: in all twelve frames the two feet sit at different heights and different
 * x positions, and the foot that is forward alternates across the file, wrapping
 * from the last frame back to the first. No two frames are alike -- the closest pair
 * still differs over a fifth of the silhouette -- so there is no planted, stationary
 * sub-loop to cut out for idle.
 *
 * Rather than re-time a walk frame into a standing pose that was never drawn, idle
 * holds frame 0 alone. That is the frame the single reference sprite is a still of,
 * so it is the pose the NPC is known to have stood in. Walk takes the whole cycle.
 *
 * Both clips already name their own sheet and frame range, so the moment real idle
 * artwork arrives -- as `npc_idle.png`, or as a range of some future shared sheet --
 * only the `idle` entry below changes. Walk is untouched by that edit, and because
 * both draw against `NPC_BASELINE_Y`, re-pointing one cannot move the NPC's feet.
 */
export const NPC_CLIPS: readonly NpcClip[] = [
  {
    name: 'idle',
    sheet: NPC_IDLE_WALK_SHEET.file,
    firstFrame: 0,
    frameCount: 1,
    loops: true,
    fps: NPC_IDLE_FPS,
  },
  {
    name: 'walk',
    sheet: NPC_IDLE_WALK_SHEET.file,
    firstFrame: 0,
    frameCount: NPC_IDLE_WALK_SHEET.frames,
    loops: true,
    fps: NPC_WALK_FPS,
  },
]

/** True while this clip has artwork behind it. */
export function isClipAssigned(clip: NpcClip): boolean {
  return clip.sheet !== null && clip.frameCount > 0
}
