import { DamageText, SparkParticle, TrainingDummy } from './CombatEntity'
import { PlayerController, rectsIntersect } from './PlayerController'
import type { SpriteAnimationSystem } from './SpriteAnimationSystem'

/** A decoded image plus its intrinsic size, needed for 9-argument drawImage. */
export interface LoadedImage {
  image: CanvasImageSource
  width: number
  height: number
}

/**
 * 2D Game World managing world bounds, logical resolution, arena scenery,
 * training combat targets, and particle systems.
 * Mirrors GameWorld.kt.
 */
export class GameWorld {
  static readonly LOGICAL_WIDTH = 640
  static readonly LOGICAL_HEIGHT = 360
  static readonly WORLD_WIDTH = 1200
  static readonly SPAWN_X = 300

  /**
   * Native pixel height of the arena backdrop (bg/arena_bg.png, synced from
   * img_arena_bg_hd.png). The backdrop is drawn scaled to fill LOGICAL_HEIGHT, so
   * any row in the artwork maps to logical Y via: row * LOGICAL_HEIGHT / this.
   */
  static readonly BACKGROUND_HEIGHT = 864

  /**
   * Row of the visible stone floor surface, measured from the backdrop artwork.
   *
   * The floor is a hard horizontal edge running the full width of the image: a dark
   * ledge seam at row 618 (168/192 sampled columns agree) with the lit flagstone
   * surface starting at row 620 (111/158 columns; the remainder are pillars and
   * props occluding the edge). There is no perspective slope, so a single
   * world-space plane is exact across the whole arena.
   */
  static readonly BACKGROUND_FLOOR_ROW = 620

  /**
   * World-space ground / collision plane, in logical pixels.
   *
   * The player's feet rest exactly on this Y at all times, and it is the Y the jump
   * impulse starts from and gravity returns to. Derived from the backdrop rather
   * than guessed, so the knight stands on the drawn stone floor instead of an
   * arbitrary line near the bottom of the screen.
   */
  static readonly FLOOR_Y = (GameWorld.BACKGROUND_FLOOR_ROW * GameWorld.LOGICAL_HEIGHT) / GameWorld.BACKGROUND_HEIGHT

  /** Native height of one sprite sheet cell, in source pixels. */
  static readonly SPRITE_CELL_HEIGHT = 128

  /**
   * Fully transparent rows below the character's feet inside a 128px cell.
   * Measured from the art: opaque content ends at row 111 in every frame of both
   * idle.png and walk.png, leaving 16 empty rows.
   */
  static readonly SPRITE_FOOT_PADDING = 16

  /** Logical size a 128px sprite cell is drawn at. */
  static readonly SPRITE_DISPLAY_SIZE = 100

  /**
   * How far below FLOOR_Y the sprite's draw-rect bottom must sit so that the visible
   * feet — not the transparent padding — land on the ground plane. Without this the
   * knight floats by this amount every frame.
   */
  static readonly SPRITE_FOOT_OFFSET =
    (GameWorld.SPRITE_FOOT_PADDING / GameWorld.SPRITE_CELL_HEIGHT) * GameWorld.SPRITE_DISPLAY_SIZE

  readonly player: PlayerController
  readonly dummies: TrainingDummy[]
  readonly damageTexts: DamageText[] = []
  readonly particles: SparkParticle[] = []

  private background: LoadedImage | null = null

  /** Camera view offset. */
  cameraX = 0

  constructor(
    readonly animationSystem: SpriteAnimationSystem,
    background: LoadedImage | null = null,
  ) {
    this.player = new PlayerController(animationSystem, GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
    this.dummies = [
      new TrainingDummy(550, GameWorld.FLOOR_Y),
      new TrainingDummy(850, GameWorld.FLOOR_Y),
    ]
    this.background = background
  }

  setBackground(background: LoadedImage | null): void {
    this.background = background
  }

  update(dt: number): void {
    const clampedDt = Math.min(0.05, Math.max(0.001, dt))

    // Update player
    this.player.update(clampedDt, 0, GameWorld.WORLD_WIDTH, GameWorld.FLOOR_Y)

    // Camera smoothly follows player within world bounds
    const targetCamX = Math.min(
      Math.max(this.player.x - GameWorld.LOGICAL_WIDTH / 2, 0),
      GameWorld.WORLD_WIDTH - GameWorld.LOGICAL_WIDTH,
    )
    this.cameraX += (targetCamX - this.cameraX) * 0.15

    // Check attack collisions
    if (this.player.shouldCheckAttackHit()) {
      this.performAttackHitCheck(18, false)
    }
    if (this.player.shouldCheckHeavyAttackHit()) {
      this.performAttackHitCheck(45, true)
    }

    for (const dummy of this.dummies) {
      dummy.update(clampedDt)
    }

    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      if (!this.damageTexts[i].update(clampedDt)) this.damageTexts.splice(i, 1)
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!this.particles[i].update(clampedDt)) this.particles.splice(i, 1)
    }
  }

  private performAttackHitCheck(damage: number, isHeavy: boolean): void {
    const atkBox = this.player.attackHitbox
    for (const dummy of this.dummies) {
      if (!rectsIntersect(atkBox, dummy.hitbox)) continue

      dummy.takeDamage(damage)

      // Spawn floating damage text
      const dColor = isHeavy ? 'rgb(255, 180, 50)' : 'rgb(240, 240, 255)'
      const dText = isHeavy ? `CRIT ${damage}!` : `${damage}`
      this.damageTexts.push(new DamageText(dummy.x, dummy.groundY - dummy.height - 15, dText, dColor))

      // Spawn sparks
      const sparkCount = isHeavy ? 18 : 10
      for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = Math.random() * 120 + 50
        this.particles.push(
          new SparkParticle(
            dummy.x + (Math.random() - 0.5) * 16,
            dummy.groundY - dummy.height / 2 + (Math.random() - 0.5) * 20,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 60,
            isHeavy ? 'rgb(255, 200, 80)' : 'rgb(220, 240, 255)',
            isHeavy ? 4 : 3,
          ),
        )
      }
    }
  }

  /** Renders the game world. The ctx is already in logical coordinates. */
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    // Translate world by negative camera position
    ctx.translate(-this.cameraX, 0)

    // 1. Parallax background
    const bg = this.background
    if (bg) {
      const bgX = this.cameraX * 0.3 // parallax factor
      ctx.drawImage(
        bg.image,
        0,
        0,
        bg.width,
        bg.height,
        bgX,
        0,
        GameWorld.LOGICAL_WIDTH * 1.5,
        GameWorld.LOGICAL_HEIGHT,
      )
    } else {
      // Fallback dark castle gradient
      ctx.fillStyle = 'rgb(18, 20, 28)'
      ctx.fillRect(0, 0, GameWorld.WORLD_WIDTH, GameWorld.LOGICAL_HEIGHT)
    }

    // 2. Stone Arena Ground
    ctx.fillStyle = 'rgb(36, 40, 52)'
    ctx.fillRect(0, GameWorld.FLOOR_Y, GameWorld.WORLD_WIDTH, GameWorld.LOGICAL_HEIGHT)

    // Flagstone ground texture lines
    ctx.fillStyle = 'rgb(55, 62, 80)'
    ctx.fillRect(0, GameWorld.FLOOR_Y, GameWorld.WORLD_WIDTH, 4)

    for (let x = 0; x <= GameWorld.WORLD_WIDTH; x += 60) {
      ctx.fillStyle = 'rgb(28, 31, 40)'
      ctx.fillRect(x, GameWorld.FLOOR_Y + 4, 1, GameWorld.LOGICAL_HEIGHT)
      ctx.fillStyle = 'rgb(48, 54, 70)'
      ctx.fillRect(x + 30, GameWorld.FLOOR_Y + 24, 1, GameWorld.LOGICAL_HEIGHT)
    }

    // Arena boundary stone pillars
    ctx.fillStyle = 'rgb(50, 55, 70)'
    ctx.fillRect(0, 0, 24, GameWorld.FLOOR_Y)
    ctx.fillRect(GameWorld.WORLD_WIDTH - 24, 0, 24, GameWorld.FLOOR_Y)

    // 3. Render Training Dummies
    for (const dummy of this.dummies) {
      dummy.render(ctx)
    }

    // 4. Character Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.47)'
    ctx.beginPath()
    ctx.ellipse(this.player.x, GameWorld.FLOOR_Y, 22, 4, 0, 0, Math.PI * 2)
    ctx.fill()

    // 5. Render Character Sprite
    // The 128x128 cell is drawn at 100x100 logical pixels (no stretching, aspect
    // preserved). The cell carries 16px of transparent padding below the feet, so the
    // draw-rect bottom is offset by SPRITE_FOOT_OFFSET to put the visible feet — and
    // therefore the collision bottom — exactly on FLOOR_Y.
    const spriteDisplaySize = GameWorld.SPRITE_DISPLAY_SIZE
    this.animationSystem.render(
      ctx,
      this.player.x,
      this.player.groundY + GameWorld.SPRITE_FOOT_OFFSET,
      spriteDisplaySize,
      spriteDisplaySize,
      this.player.isFacingRight,
    )

    // 6. Render Particles
    for (const p of this.particles) {
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    }

    // 7. Render Floating Damage Numbers
    for (const dt of this.damageTexts) {
      ctx.save()
      ctx.globalAlpha = dt.alpha
      ctx.fillStyle = dt.color
      ctx.font = 'bold 14px monospace'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(dt.text, dt.x - 16, dt.y)
      ctx.restore()
    }

    ctx.restore()
  }
}
