import type { AnimationConfig } from './AnimationConfig'
import { PlayerAction } from './PlayerAction'

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
  readonly config: AnimationConfig

  constructor(action: PlayerAction, image: HTMLImageElement | HTMLCanvasElement, config: AnimationConfig) {
    this.action = action
    this.image = image
    this.config = config

    // Automatic layout detection if frameCount is not explicitly set.
    const detected = config.frameCount ?? (image.height > 0 ? Math.trunc(image.width / image.height) : 1)
    this.frameCount = Math.max(1, detected)
    this.frameWidth = Math.max(1, Math.trunc(image.width / this.frameCount))
    this.frameHeight = Math.max(1, image.height)
  }

  /** Source rect of a frame, in sheet pixel coordinates. */
  frameRect(index: number): { sx: number; sy: number; sw: number; sh: number } {
    const clamped = Math.min(Math.max(index, 0), this.frameCount - 1)
    return {
      sx: clamped * this.frameWidth,
      sy: 0,
      sw: this.frameWidth,
      sh: this.frameHeight,
    }
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
