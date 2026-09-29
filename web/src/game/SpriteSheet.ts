import type { AnimationConfig } from './AnimationConfig'
import { PlayerAction } from './PlayerAction'
import { DEFAULT_FOOT_ROW } from './spriteMetrics'

/**
 * Encapsulates a loaded sprite sheet image and its horizontal frame slices.
 * Mirrors SpriteSheet.kt, but loading is async because the web needs a network
 * fetch + decode before frames can be sliced.
 */
export class SpriteSheet {
  readonly action: PlayerAction
  readonly image: HTMLImageElement | HTMLCanvasElement
  readonly frameCount: number
  readonly frameWidth: number
  readonly frameHeight: number
  /** Frames per row; 1 for a single horizontal strip. */
  readonly columns: number
  /** Native height of one cell, in sheet pixels. */
  readonly cellHeight: number
  /** On-screen size multiplier that keeps this sheet's character the same size as the rest. */
  readonly displayScale: number
  readonly config: AnimationConfig

  constructor(action: PlayerAction, image: HTMLImageElement | HTMLCanvasElement, config: AnimationConfig) {
    this.action = action
    this.image = image
    this.config = config

    // A sheet is either a single strip of square cells (idle, walk, jump) or a
    // grid of them (attack), in which case the config names the cell size and
    // how many cells sit in a row. Strip sheets default to one row rather than
    // inferring columns from the image aspect, which would mistake a wide strip
    // for a multi-row grid.
    // Two layouts are supported. Without a configured cell size the sheet is a
    // single row of square cells (idle, walk, jump), so the cell side is the
    // image height and the frame count follows from the width. With one, the
    // sheet is a grid (attack: 4 columns of 256px cells) and the row count
    // follows from the image height.
    const cellSide = Math.max(1, config.cellSize ?? image.height)
    const inferredColumns = Math.max(1, Math.trunc(image.width / cellSide))
    this.columns = Math.max(1, config.columns ?? inferredColumns)
    this.cellHeight = cellSide

    const rows = config.cellSize ? Math.max(1, Math.floor(image.height / cellSide)) : 1
    const available = this.columns * rows
    this.frameCount = Math.max(1, Math.min(config.frameCount ?? available, available))
    this.frameWidth = Math.max(1, Math.trunc(image.width / this.columns))
    this.frameHeight = this.cellHeight
    this.displayScale = config.displayScale
  }

  /** Source rect of a frame, in sheet pixel coordinates. */
  frameRect(index: number): { sx: number; sy: number; sw: number; sh: number } {
    const clamped = Math.min(Math.max(index, 0), this.frameCount - 1)
    const col = clamped % this.columns
    const row = Math.floor(clamped / this.columns)
    return {
      sx: col * this.frameWidth,
      sy: row * this.cellHeight,
      sw: this.frameWidth,
      sh: this.cellHeight,
    }
  }

  /**
   * Bottom-most opaque source row of a frame. The sprite cells are not filled to the
   * bottom edge, and the walk cycle's contact row drifts by a few rows, so this is
   * read per frame rather than baked into a single constant. Frames with no measured
   * row fall back to the idle rest pose.
   */
  footRowForFrame(index: number): number {
    const clamped = Math.min(Math.max(index, 0), this.frameCount - 1)
    return this.config.footRows[clamped] ?? DEFAULT_FOOT_ROW
  }
}

export type ImageFactory = (url: string) => Promise<HTMLImageElement>

export const defaultImageFactory: ImageFactory = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load sprite sheet: ${url}`))
    img.src = url
  })

/**
 * Loads a single sheet, returning null when the asset is missing so a broken
 * action can fall back to another instead of killing the whole animation system.
 */
export async function loadSpriteSheet(
  basePath: string,
  factory: ImageFactory,
  config: AnimationConfig,
): Promise<SpriteSheet | null> {
  const url = `${basePath.replace(/\/$/, '')}/${config.sourceFileName}`
  try {
    const image = await factory(url)
    return new SpriteSheet(config.action, image, config)
  } catch (err) {
    console.warn(`[SpriteSheet] unable to load ${url}`, err)
    return null
  }
}
