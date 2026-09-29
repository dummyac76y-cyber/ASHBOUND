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
  static readonly FLOOR_Y = 285
  static readonly SPAWN_X = 300

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

    // 5. Render Character Sprite (128x128 sheet drawn at 100x100 logical pixels)
    const spriteDisplaySize = 100
    this.animationSystem.render(
      ctx,
      this.player.x,
      this.player.groundY,
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
