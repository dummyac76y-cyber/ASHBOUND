import {
  NPC_CELL_SIZE,
  NPC_CLIPS,
  NPC_BASELINE_Y,
  NPC_NEAREST_NEIGHBOR,
  NPC_IDLE_FPS,
  NPC_VISIBLE_SCALE,
  NPC_WALK_FPS,
  type NpcClip,
} from './npcAssets'
import { footOffsetForRow } from './spriteMetrics'
import type { RectF } from './PlayerController'

/** A decoded sheet plus its intrinsic size, needed for 9-argument drawImage. */
export interface NpcImage {
  readonly image: CanvasImageSource
  readonly width: number
  readonly height: number
}

/** What the NPC is doing right now. Decides which clip plays. */
export type NpcState = 'idle' | 'walk'

/** Seconds the NPC stands still before setting off again. */
export const NPC_IDLE_SECONDS = 2.5

/** Walking speed in world units per second. Deliberately unhurried. */
export const NPC_WALK_SPEED = 26

/**
 * How far either side of its starting post the NPC is allowed to roam, in world
 * units. A short patrol: far enough to read as walking, not enough to wander out of
 * the fight or off the drawn floor.
 */
export const NPC_PATROL_REACH = 40

/**
 * The world character that stands where the old placeholder did.
 *
 * Lives in world space like everything else in a scene: it holds a world X, is
 * drawn through the same camera transform as the backdrop and the player, and so
 * crosses the screen only when the camera scrolls. Nothing here is in screen space.
 *
 * The sprite is the supplied 12-frame sheet, drawn unmodified at the player's own
 * display size, with the visible feet sitting on the scene's floor plane via the
 * measured baseline rather than by shifting any frame.
 */
export class Npc {
  maxHp = 100
  hp = 100
  hitFlashTimer = 0
  wobbleTime = 0

  /** Current motion, and which direction the NPC is looking. */
  state: NpcState = 'idle'
  facingRight = true

  /** Index of the frame being drawn within its clip. */
  currentFrame = 0

  /** Seconds the current state has been running, used to drive the frame. */
  private stateElapsed = 0

  /** Seconds still to stand still for. */
  private idleRemaining = NPC_IDLE_SECONDS

  /** Left and right limits of the patrol, in world units. */
  readonly patrolLeft: number
  readonly patrolRight: number

  /**
   * The decoded walk sheet, or null while it is still loading. Null draws the NPC's
   * ground shadow and HP bar only, so a missing asset shows an empty stand rather
   * than nothing at all.
   */
  sprite: NpcImage | null = null

  constructor(
    public x: number,
    public groundY: number,
    /** Side of the torso a sword can reach, in world units. */
    public readonly width = 56,
    /** How tall the body stands off the floor, in world units. */
    public readonly height = 68,
  ) {
    this.patrolLeft = x - NPC_PATROL_REACH
    this.patrolRight = x + NPC_PATROL_REACH
  }

  /** The combat box, in world coordinates. Its bottom is the floor line. */
  get hitbox(): RectF {
    return { left: this.x - this.width / 2, top: this.groundY - this.height, right: this.x + this.width / 2, bottom: this.groundY }
  }

  /** True while the NPC is on the move, which is what a facing flip follows. */
  get isWalking(): boolean {
    return this.state === 'walk'
  }

  /** Frame rate the running clip plays at. */
  get fps(): number {
    return this.state === 'walk' ? NPC_WALK_FPS : NPC_IDLE_FPS
  }

  takeDamage(amount: number): boolean {
    this.hp = Math.max(0, this.hp - amount)
    this.hitFlashTimer = 0.2
    this.wobbleTime = 0.4
    if (this.hp <= 0) {
      this.hp = this.maxHp
    }
    return true
  }

  /**
   * Advances the patrol and the animation.
   *
   * The loop is: stand, walk to the patrol limit, turn round, stand, walk back.
   * Turning happens on reaching a limit rather than on wrapping, so the NPC never
   * reverses while out in the open, and the sprite only flips at a moment the
   * player expects -- a turnaround.
   */
  update(dt: number): void {
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt
    if (this.wobbleTime > 0) this.wobbleTime -= dt

    if (this.state === 'idle') {
      this.idleRemaining -= dt
      if (this.idleRemaining <= 0) {
        this.state = 'walk'
        this.stateElapsed = 0
      }
    } else {
      const next = this.x + (this.facingRight ? 1 : -1) * NPC_WALK_SPEED * dt
      if (this.facingRight && next >= this.patrolRight) {
        this.x = this.patrolRight
        this.turnAround()
      } else if (!this.facingRight && next <= this.patrolLeft) {
        this.x = this.patrolLeft
        this.turnAround()
      } else {
        this.x = next
      }
    }

    this.stateElapsed += dt
    this.currentFrame = this.frameForElapsed(this.stateElapsed)
  }

  /**
   * Reaches a patrol limit: stop, face the other way, and stand for a while.
   *
   * Standing after a turn is what stops the sprite from snapping to a mirrored walk
   * mid-stride, where a leg that was mid-swing would read as the wrong one leading.
   */
  private turnAround(): void {
    this.facingRight = !this.facingRight
    this.state = 'idle'
    this.idleRemaining = NPC_IDLE_SECONDS
    this.stateElapsed = 0
  }

  /**
   * Frame to draw for a given elapsed time in the current state.
   *
   * Split out from {@link update} so the frame maths can be tested without also
   * moving the NPC around the world.
   */
  frameForElapsed(elapsed: number): number {
    const clip = this.clip
    if (clip.frameCount <= 1) return 0
    const raw = Math.floor(elapsed * clip.fps)
    return clip.firstFrame + (raw % clip.frameCount)
  }

  /** The clip the current state plays. */
  private get clip(): NpcClip {
    const found = NPC_CLIPS.find((c) => c.name === this.state)
    if (found) return found
    // Only reachable if a state were added without a binding for it.
    return { name: 'idle', sheet: null, firstFrame: 0, frameCount: 0, loops: true, fps: NPC_IDLE_FPS }
  }

  /**
   * Draws only the sprite -- no ground shadow, no HP bar -- at the NPC's world
   * position, so the artwork's drawn extent can be measured without having to tell
   * it apart from the two decorations `render()` adds around it.
   *
   * Goes through the same draw path as `render()`, so what is measured is exactly
   * what reaches the screen. Used by the verification harness to compare the NPC's
   * size against the player's on one surface.
   */
  renderSpriteOnly(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.translate(this.x, this.groundY)
    this.renderSprite(ctx)
    ctx.restore()
  }

  /** Draws the NPC in world space. The context is already camera-translated. */
  render(ctx: CanvasRenderingContext2D): void {
    const wobble = this.wobbleTime > 0 ? Math.sin(this.wobbleTime * 30) * 4 : 0

    ctx.save()
    ctx.translate(this.x + wobble, this.groundY)

    // Ground shadow, seated on the floor line like the player's.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.beginPath()
    ctx.ellipse(0, 0, 22, 4, 0, 0, Math.PI * 2)
    ctx.fill()

    this.renderSprite(ctx)

    // Health bar, kept above the head. `spriteTop()` is already measured upward from
    // the floor, so the bar sits a little further up again.
    const barW = 44
    const barH = 6
    const barY = this.spriteTop() - 10
    ctx.fillStyle = 'rgb(40, 40, 40)'
    ctx.fillRect(-barW / 2, barY, barW, barH)

    const hpRatio = this.hp / this.maxHp
    ctx.fillStyle = 'rgb(220, 50, 50)'
    ctx.fillRect(-barW / 2 + 1, barY + 1, (barW - 2) * hpRatio, barH - 2)

    ctx.restore()
  }

  /**
   * Height of the sprite's drawn box above the floor, in world units.
   *
   * The cell is drawn square at the player's display size, then dropped by the
   * measured baseline offset so the visible feet -- not the cell's transparent
   * lower edge -- land on the floor.
   */
  private spriteTop(): number {
    return -(NPC_DRAWN_SIZE - footOffsetForRow(NPC_BASELINE_Y, NPC_DRAWN_SIZE, NPC_CELL_SIZE))
  }

  /** Draws the current frame of the sheet, if it has loaded. */
  private renderSprite(ctx: CanvasRenderingContext2D): void {
    const sheet = this.sprite
    if (!sheet) return

    const display = NPC_DRAWN_SIZE
    const footOffset = footOffsetForRow(NPC_BASELINE_Y, display, NPC_CELL_SIZE)
    const bottom = footOffset
    const top = bottom - display
    const left = -display / 2
    const sx = this.currentFrame * NPC_CELL_SIZE

    ctx.save()
    // Pixel art is drawn unsampled. The engine disables image smoothing globally,
    // and this pins it for this draw too so the NPC cannot be softened by any
    // caller that has re-enabled it.
    if (NPC_NEAREST_NEIGHBOR) ctx.imageSmoothingEnabled = false
    // Turning round mirrors the sheet about the NPC's own centre.
    if (!this.facingRight) ctx.scale(-1, 1)
    ctx.drawImage(sheet.image, sx, 0, NPC_CELL_SIZE, NPC_CELL_SIZE, left, top, display, display)

    // A hit brightens the sprite for a moment. Drawn as a second pass over the same
    // pixels, so the transparent parts of the cell stay transparent and no rectangle
    // is stamped over the background.
    if (this.hitFlashTimer > 0) {
      ctx.globalAlpha = Math.min(1, this.hitFlashTimer / 0.2) * 0.55
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(sheet.image, sx, 0, NPC_CELL_SIZE, NPC_CELL_SIZE, left, top, display, display)
    }
    ctx.restore()
  }
}

/**
 * Logical size a 128px sprite cell is drawn at, the player's cell size.
 *
 * This is the shared *basis* both characters start from. The NPC then multiplies it
 * by `NPC_VISIBLE_SCALE`, because its artwork fills a smaller fraction of its cell
 * than the player's does and would otherwise draw shorter than the knight.
 *
 * It is deliberately not the player's own size: `GameWorld.SPRITE_DISPLAY_SIZE` is
 * its own constant, so sizing the NPC can never silently resize the knight.
 */
export const NPC_SPRITE_DISPLAY_SIZE = 100

/**
 * The size the NPC's cell is actually drawn at: the shared basis scaled up so its
 * visible height matches the player's.
 *
 * Every part of the NPC that draws against a size uses this, so the sprite, the
 * foot offset that grounds it and the HP bar above its head all stay consistent
 * with one another. Because the factor is uniform, the artwork keeps its
 * proportions and its baseline still lands the feet on the floor plane.
 */
export const NPC_DRAWN_SIZE = NPC_SPRITE_DISPLAY_SIZE * NPC_VISIBLE_SCALE
