import type { RectF } from './PlayerController'

/** Floating damage number effect. */
export class DamageText {
  alpha = 1
  lifetime = 0.8

  constructor(
    public x: number,
    public y: number,
    public readonly text: string,
    public readonly color: string,
  ) {}

  update(dt: number): boolean {
    this.y -= 35 * dt
    this.lifetime -= dt
    this.alpha = Math.min(1, Math.max(0, this.lifetime / 0.8))
    return this.lifetime > 0
  }
}

/** Spark particle created on sword hit. */
export class SparkParticle {
  life = 0.4

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    public readonly color: string,
    public readonly size: number,
  ) {}

  update(dt: number): boolean {
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.vy += 200 * dt // gravity
    this.life -= dt
    return this.life > 0
  }
}

/**
 * Interactive Training Target in the arena so the player can test combat actions.
 * Mirrors TrainingDummy.kt.
 */
export class TrainingDummy {
  maxHp = 100
  hp = 100
  hitFlashTimer = 0
  wobbleTime = 0

  constructor(
    public x: number,
    public groundY: number,
    public readonly width = 40,
    public readonly height = 75,
  ) {}

  get hitbox(): RectF {
    return { left: this.x - this.width / 2, top: this.groundY - this.height, right: this.x + this.width / 2, bottom: this.groundY }
  }

  takeDamage(amount: number): boolean {
    this.hp = Math.max(0, this.hp - amount)
    this.hitFlashTimer = 0.2
    this.wobbleTime = 0.4
    if (this.hp <= 0) {
      // Respawn after short delay
      this.hp = this.maxHp
    }
    return true
  }

  update(dt: number): void {
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt
    if (this.wobbleTime > 0) this.wobbleTime -= dt
  }

  render(ctx: CanvasRenderingContext2D): void {
    const wobble = this.wobbleTime > 0 ? Math.sin(this.wobbleTime * 30) * 6 : 0
    const flash = this.hitFlashTimer > 0

    ctx.save()
    ctx.translate(this.x + wobble, this.groundY)

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.39)'
    ctx.beginPath()
    ctx.ellipse(0, 0, 24, 4, 0, 0, Math.PI * 2)
    ctx.fill()

    // Body / Post
    ctx.fillStyle = flash ? '#ffffff' : 'rgb(90, 70, 55)'
    ctx.fillRect(-8, -this.height, 16, this.height)

    // Training Straw Torso
    ctx.fillStyle = flash ? '#ffffff' : 'rgb(180, 150, 90)'
    ctx.fillRect(-18, -this.height + 15, 36, this.height - 35)

    // Head
    ctx.fillStyle = flash ? '#ffffff' : 'rgb(200, 170, 110)'
    ctx.beginPath()
    ctx.arc(0, -this.height + 8, 12, 0, Math.PI * 2)
    ctx.fill()

    // Crossbeam (dummy arms)
    ctx.fillStyle = flash ? '#ffffff' : 'rgb(120, 95, 70)'
    ctx.fillRect(-26, -this.height + 25, 52, 6)

    // Health bar
    const barW = 40
    const barH = 6
    const barY = -this.height - 14
    ctx.fillStyle = 'rgb(40, 40, 40)'
    ctx.fillRect(-barW / 2, barY, barW, barH)

    const hpRatio = this.hp / this.maxHp
    ctx.fillStyle = 'rgb(220, 50, 50)'
    ctx.fillRect(-barW / 2 + 1, barY + 1, (barW - 2) * hpRatio, barH - 2)

    ctx.restore()
  }
}
