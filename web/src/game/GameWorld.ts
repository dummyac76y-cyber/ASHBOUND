import { DamageText, SparkParticle, TrainingDummy } from './CombatEntity'
import { PlayerController, rectsIntersect } from './PlayerController'
import type { SpriteAnimationSystem } from './SpriteAnimationSystem'
import { DEFAULT_FOOT_ROW, footOffsetForRow } from './spriteMetrics'

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

  /**
   * Native pixel size of the arena backdrop (img_arena_bg_hd.png, synced to
   * bg/arena_bg.png). The backdrop is drawn with a single uniform scale, so any
   * source row maps to logical Y via: row * LOGICAL_HEIGHT / this.
   */
  static readonly BACKGROUND_WIDTH = 1536
  static readonly BACKGROUND_HEIGHT = 864

  /** Uniform scale the backdrop is drawn at. 360 / 864 is exactly 5/12. */
  static readonly BACKGROUND_SCALE = GameWorld.LOGICAL_HEIGHT / GameWorld.BACKGROUND_HEIGHT

  /**
   * Logical size of the backdrop once scaled.
   *
   * 1536 x 5/12 is exactly 640 and 864 x 5/12 is exactly 360: the artwork is a
   * single frame that covers the viewport precisely. It is one finite environment,
   * not a texture, so it is drawn once, never repeated and never mirrored.
   */
  static readonly BACKGROUND_LOGICAL_WIDTH = GameWorld.BACKGROUND_WIDTH * GameWorld.BACKGROUND_SCALE
  static readonly BACKGROUND_LOGICAL_HEIGHT = GameWorld.BACKGROUND_HEIGHT * GameWorld.BACKGROUND_SCALE

  /**
   * Native pixel size of the Underground Cavern backdrop
   * (img_underground_cavern_hd.png, synced to bg/cavern_bg.png).
   */
  static readonly CAVERN_WIDTH = 1536
  static readonly CAVERN_HEIGHT = 512

  /**
   * The cavern is drawn at the *same* uniform scale as the arena, not at a scale
   * chosen to fill the viewport.
   *
   * The cavern art is 512px tall where the arena is 864, so scaling it to cover
   * 360 logical pixels would need 360/512 rather than 5/12 -- about 1.69x larger.
   * That would leave the knight, drawn at a fixed SPRITE_DISPLAY_SIZE, standing at
   * a very different size against the scenery the moment he crossed the boundary.
   * Sharing one scale keeps the character-to-scenery relationship identical across
   * the seam, which is what makes the two sections read as one continuous world.
   */
  static readonly CAVERN_SCALE = GameWorld.BACKGROUND_SCALE

  /** Logical size of the cavern once scaled: exactly 640 x 213 1/3. */
  static readonly CAVERN_LOGICAL_WIDTH = GameWorld.CAVERN_WIDTH * GameWorld.CAVERN_SCALE
  static readonly CAVERN_LOGICAL_HEIGHT = GameWorld.CAVERN_HEIGHT * GameWorld.CAVERN_SCALE

  /**
   * Width of the playable world: the Forgotten Prison followed by the cavern.
   *
   * Each section is one finite environment laid end to end, so the world is exactly
   * as wide as the two plates together and the camera can scroll between them. With
   * this width the camera range becomes 0 .. (WORLD_WIDTH - LOGICAL_WIDTH), which is
   * what turns the previously static single-screen arena into a scrolling world.
   */
  static readonly WORLD_WIDTH = GameWorld.BACKGROUND_LOGICAL_WIDTH + GameWorld.CAVERN_LOGICAL_WIDTH

  /**
   * Centre of the Forgotten Prison, in world units.
   *
   * Anchored to the prison plate rather than to the world, because the world now
   * spans two sections: half the world would put the spawn exactly on the seam
   * between them and shift both training dummies into the cavern.
   */
  static readonly ARENA_CENTER_X = GameWorld.BACKGROUND_LOGICAL_WIDTH / 2

  /**
   * Initial world X for the player: the arena centre, which leaves the full
   * half-width of arena on both sides to walk into.
   */
  static readonly SPAWN_X = GameWorld.ARENA_CENTER_X

  /**
   * World X of the first training dummy. Placed to the right of the spawn so the
   * match opens as player-versus-target, and left untouched thereafter: a fixed
   * world position, not a screen or player-relative one.
   */
  static readonly DUMMY_X = GameWorld.ARENA_CENTER_X + 130

  /** World distance between the two training dummies. */
  static readonly DUMMY_SPACING = 120

  /**
   * Row of the visible stone floor surface, measured from the backdrop artwork.
   *
   * Row statistics across the image width show a hard horizon: row 532 is still
   * dark wall (mean 21.6, 18.5% lit, 43.9% of sampled columns agreeing), while row
   * 533 is the first lit floor row (mean 31.5, 51.2% lit, 68.9% coherent). The
   * edge is horizontal, so one world-space plane is exact across the arena. The
   * bright seam further down at row 620 is a flagstone joint *inside* the floor,
   * not its top edge, and using it left the knight standing in front of the wall.
   */
  static readonly BACKGROUND_FLOOR_ROW = 533

  /**
   * World-space ground / collision plane, in logical pixels.
   *
   * The player's visible feet rest exactly on this Y at all times, and it is the Y
   * the jump impulse starts from and gravity returns to. Derived from the backdrop
   * rather than guessed, so the knight stands on the drawn stone floor instead of
   * an arbitrary line near the bottom of the screen.
   */
  static readonly FLOOR_Y = (GameWorld.BACKGROUND_FLOOR_ROW * GameWorld.LOGICAL_HEIGHT) / GameWorld.BACKGROUND_HEIGHT

  /**
   * Row of the cavern's visible floor surface, measured from its artwork the same
   * way as the arena's.
   *
   * Both backdrops share one structure: dark wall, then a lit floor band, then a
   * dark foreground that runs off the bottom. In the cavern the transition is at
   * row 391, where the lit fraction of the row jumps 43.2% -> 63.3% and mean
   * luminance rises 37.2 -> 46.1. That is the same shape of step as the arena's
   * 532 -> 533 (6.8% -> 19.9% lit, mean 22.3 -> 32.4), so both sections measure
   * their floor the same way and land on one shared ground plane.
   */
  static readonly CAVERN_FLOOR_ROW = 391

  /**
   * Logical Y at which the cavern plate is drawn.
   *
   * The cavern is shorter than the viewport once scaled, and its floor sits lower
   * within its own frame than the arena's does (391/512 vs 533/864). Offsetting the
   * plate so its measured floor row lands exactly on FLOOR_Y is what keeps the
   * walkable surface continuous: the player's collision plane and visible feet stay
   * on one line across the boundary, so there is no step, gap or floating knight.
   */
  static readonly CAVERN_OFFSET_Y = GameWorld.FLOOR_Y - GameWorld.CAVERN_FLOOR_ROW * GameWorld.CAVERN_SCALE

  /**
   * Flat fills for the two bands the cavern plate does not reach.
   *
   * At the shared scale the cavern covers only 213 of the 360 logical pixel rows,
   * so plain colour fills what is left above and below it. Both are sampled from
   * the cavern's own outermost rows (row 0 averages rgb(3,6,18), row 511 averages
   * rgb(0,0,10)), so the flat bands continue the artwork's own near-black cave
   * darkness. The plate itself is drawn once, unscaled beyond the shared factor
   * and otherwise untouched -- these fills never stretch, mirror or repeat it.
   */
  static readonly CAVERN_FILL_ABOVE = 'rgb(3, 6, 18)'
  static readonly CAVERN_FILL_BELOW = 'rgb(0, 0, 10)'

  /** Logical size a 128px sprite cell is drawn at (aspect preserved). */
  static readonly SPRITE_DISPLAY_SIZE = 100

  /**
   * Rest-pose foot offset, i.e. the padding below the opaque pixels of the idle
   * sheet's frames. Kept for diagnostics and tests; the renderer uses the
   * per-frame value from the animation system instead, since the walk cycle's
   * contact row is not constant.
   */
  static readonly SPRITE_FOOT_OFFSET = footOffsetForRow(DEFAULT_FOOT_ROW, GameWorld.SPRITE_DISPLAY_SIZE)

  readonly player: PlayerController
  readonly dummies: TrainingDummy[]
  readonly damageTexts: DamageText[] = []
  readonly particles: SparkParticle[] = []

  private background: LoadedImage | null = null

  /**
   * The Underground Cavern plate, the second world section.
   *
   * Kept separate from [background] because it is a different image at a different
   * vertical offset, not a variant of the same one. Null simply means the section
   * falls back to flat fill.
   */
  private cavernBackground: LoadedImage | null = null

  /**
   * Camera view offset, in world units. Everything in the arena (backdrop, player,
   * dummies, hitboxes) lives in world space and is drawn through this single
   * transform, so a world-fixed object stays locked to the dungeon as the player
   * walks.
   */
  cameraX = 0

  constructor(
    readonly animationSystem: SpriteAnimationSystem,
    background: LoadedImage | null = null,
    cavernBackground: LoadedImage | null = null,
  ) {
    this.player = new PlayerController(animationSystem, GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
    // Dummies are world fixtures at fixed world X. They are never derived from the
    // player, and their groundY is the same FLOOR_Y the player stands on.
    this.dummies = [
      new TrainingDummy(GameWorld.DUMMY_X, GameWorld.FLOOR_Y),
      new TrainingDummy(GameWorld.DUMMY_X + GameWorld.DUMMY_SPACING, GameWorld.FLOOR_Y),
    ]
    this.background = background
    this.cavernBackground = cavernBackground
    // Start with the player already centred, instead of easing in from the left
    // edge on the first frames of the match.
    this.cameraX = this.cameraXForPlayerX(this.player.x)
  }

  /** Camera offset that puts a given world X at the centre of the viewport. */
  cameraXForPlayerX(worldX: number): number {
    return Math.min(Math.max(worldX - GameWorld.LOGICAL_WIDTH / 2, 0), GameWorld.WORLD_WIDTH - GameWorld.LOGICAL_WIDTH)
  }

  setBackground(background: LoadedImage | null): void {
    this.background = background
  }

  setCavernBackground(cavernBackground: LoadedImage | null): void {
    this.cavernBackground = cavernBackground
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

  /**
   * Draws the backdrop once, in world space, at its natural size.
   *
   * The artwork is a single finite environment that already covers the viewport
   * exactly, so it is neither mirrored, repeated, nor flipped. It is anchored to
   * world (0, 0) and the camera is clamped to the world, so the plate can never
   * be drawn twice or leave a gap at either edge.
   */
  /**
   * Draws the world backdrop and nothing else, through the real drawing path.
   *
   * Split out of {@link render} for the same reason as {@link renderCharacter}: so
   * headless verification can capture the backdrop exactly as the game composes it
   * and use it as a subtraction reference. Duplicating the two-plate composition
   * in a harness would let the reference drift from the real thing, which would
   * then show up as phantom "characters" wherever the two disagree.
   */
  renderBackdrop(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx)
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const bg = this.background
    if (!bg) {
      // Fallback dark castle gradient
      ctx.fillStyle = 'rgb(18, 20, 28)'
      ctx.fillRect(0, 0, GameWorld.WORLD_WIDTH, GameWorld.LOGICAL_HEIGHT)
      return
    }

    // Forgotten Prison: anchored at world (0, 0), drawn once.
    ctx.drawImage(
      bg.image,
      0,
      0,
      bg.width,
      bg.height,
      0,
      0,
      bg.width * GameWorld.BACKGROUND_SCALE,
      bg.height * GameWorld.BACKGROUND_SCALE,
    )

    const cavern = this.cavernBackground
    if (!cavern) return

    const cavernX = GameWorld.BACKGROUND_LOGICAL_WIDTH
    // Flat bands first, so the plate is drawn over them and no seam shows at the
    // plate's own top and bottom edges.
    ctx.fillStyle = GameWorld.CAVERN_FILL_BELOW
    ctx.fillRect(cavernX, 0, GameWorld.CAVERN_LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)
    if (GameWorld.CAVERN_OFFSET_Y > 0) {
      ctx.fillStyle = GameWorld.CAVERN_FILL_ABOVE
      ctx.fillRect(cavernX, 0, GameWorld.CAVERN_LOGICAL_WIDTH, GameWorld.CAVERN_OFFSET_Y)
    }

    // Underground Cavern: its own section, immediately to the right of the prison
    // and in the same world space, so the single camera transform scrolls across
    // the boundary and everything stays locked to the world.
    //
    // Drawn exactly once, at its own x offset and vertical alignment. Never tiled,
    // never mirrored, never flipped: the two plates are the whole world.
    ctx.drawImage(
      cavern.image,
      0,
      0,
      cavern.width,
      cavern.height,
      cavernX,
      GameWorld.CAVERN_OFFSET_Y,
      cavern.width * GameWorld.CAVERN_SCALE,
      cavern.height * GameWorld.CAVERN_SCALE,
    )
  }

  /**
   * Draws the character sprite and nothing else, in the caller's (already camera
   * translated) coordinate space.
   *
   * Split out of {@link render} so headless verification can run the real drawing
   * path onto a transparent surface and read the foot line straight off the alpha
   * channel, instead of inferring it from a difference against the backdrop.
   */
  renderCharacter(ctx: CanvasRenderingContext2D): void {
    // A cell is drawn square, and the sheet's own display scale is applied so a
    // grid-packed sheet (attack) still matches the strip sheets on screen. The
    // cell's transparent lower edge is corrected per frame so the visible feet —
    // and therefore the collision bottom — land exactly on FLOOR_Y.
    const spriteDisplaySize = this.animationSystem.displaySizeForCurrentSheet(GameWorld.SPRITE_DISPLAY_SIZE)
    this.animationSystem.render(
      ctx,
      this.player.x,
      this.player.groundY + this.animationSystem.footOffsetForCurrentFrame(GameWorld.SPRITE_DISPLAY_SIZE),
      spriteDisplaySize,
      spriteDisplaySize,
      this.player.isFacingRight,
    )
  }

  /** Renders the game world. The ctx is already in logical coordinates. */
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    // Single world -> screen transform. The backdrop, the player, the dummies and
    // every hitbox all live in the same world space, so a world-fixed object stays
    // locked to the dungeon while the player walks.
    ctx.translate(-this.cameraX, 0)

    // 1. Backdrop, drawn once in world space at a single uniform scale.
    //
    // The artwork already covers the viewport exactly and the world is exactly as
    // wide as the artwork, so there is nothing to repeat, mirror or fill in: the
    // plate is drawn at world (0, 0) and the camera never leaves [0, 0].
    this.drawBackdrop(ctx)

    // 2. Arena boundary stone pillars, in world space at the arena edges.
    //
    // No ground slab or flagstone grid is drawn here on purpose: the backdrop
    // already renders a detailed stone floor starting at FLOOR_Y, and painting an
    // opaque rectangle over that area is what previously hid the very surface the
    // player has to stand on.
    ctx.fillStyle = 'rgb(50, 55, 70)'
    ctx.fillRect(0, 0, 24, GameWorld.FLOOR_Y)
    ctx.fillRect(GameWorld.WORLD_WIDTH - 24, 0, GameWorld.WORLD_WIDTH, GameWorld.FLOOR_Y)

    // 3. Render Training Dummies. Their x and groundY are world values, so these
    // draw at world position and the camera transform handles the rest.
    for (const dummy of this.dummies) {
      dummy.render(ctx)
    }

    // 4. Character contact shadow, seated on the floor line.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.beginPath()
    ctx.ellipse(this.player.x, GameWorld.FLOOR_Y + 1, 18, 3, 0, 0, Math.PI * 2)
    ctx.fill()

    // 5. Render Character Sprite
    this.renderCharacter(ctx)


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
