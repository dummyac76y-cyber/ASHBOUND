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
