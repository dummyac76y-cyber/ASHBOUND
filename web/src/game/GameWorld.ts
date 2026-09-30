import { DamageText, SparkParticle, TrainingDummy } from './CombatEntity'
import {
  buildFogMotes,
  fitBackdrop,
  SCENES,
  STARTING_SCENE_INDEX,
  TRANSITION_FADE_IN,
  TRANSITION_FADE_OUT,
  TRANSITION_TITLE_HOLD,
  updateFogMotes,
  type FogMote,
  type SceneBackdropFit,
  type SceneDefinition,
  type SceneTransitionPhase,
} from './GameScene'
import { PlayerController, rectsIntersect } from './PlayerController'
import type { SpriteAnimationSystem } from './SpriteAnimationSystem'
import { DEFAULT_FOOT_ROW, footOffsetForRow } from './spriteMetrics'

/** A decoded image plus its intrinsic size, needed for 9-argument drawImage. */
export interface LoadedImage {
  image: CanvasImageSource
  width: number
  height: number
}

/** One scene, bound at runtime: its definition, its image and its resolved geometry. */
export interface SceneRuntime {
  readonly definition: SceneDefinition
  /**
   * The scene's backdrop. Null means the plate has not been decoded yet (or the
   * asset is missing), in which case the scene draws its fallback fill instead.
   */
  background: LoadedImage | null
  /** How the backdrop is scaled and cropped to cover this scene's world. */
  readonly fit: SceneBackdropFit
}

/**
 * 2D Game World managing scenes, logical resolution, combat targets and particles.
 *
 * Exactly one scene is active at a time. Its backdrop is the only environment drawn,
 * scaled to cover that scene's world, and its own bounds and floor plane are what the
 * player, the dummies and the camera are measured against.
 *
 * Mirrors GameWorld.kt.
 */
export class GameWorld {
  static readonly LOGICAL_WIDTH = 640
  static readonly LOGICAL_HEIGHT = 360

  /**
   * Logical size a 128px sprite cell is drawn at (aspect preserved).
   *
   * A property of the character alone. It is never scaled by a backdrop's size, so
   * the knight is exactly as large in the cavern as he is in the prison even though
   * the two artworks need very different scales to fill the screen.
   */
  static readonly SPRITE_DISPLAY_SIZE = 100

  /**
   * Rest-pose foot offset, i.e. the padding below the opaque pixels of the idle
   * sheet's frames. Kept for diagnostics and tests; the renderer uses the
   * per-frame value from the animation system instead, since the walk cycle's
   * contact row is not constant.
   */
  static readonly SPRITE_FOOT_OFFSET = footOffsetForRow(DEFAULT_FOOT_ROW, GameWorld.SPRITE_DISPLAY_SIZE)

  /** Fallback fill for a scene whose backdrop has not loaded. */
  private static readonly SCENE_FALLBACK_FILL = 'rgb(18, 20, 28)'

  readonly player: PlayerController
  readonly damageTexts: DamageText[] = []
  readonly particles: SparkParticle[] = []

  /** Every scene the game knows, in travel order. Only one is drawn at a time. */
  readonly scenes: SceneRuntime[]

  /** Objects belonging to the active scene. Rebuilt on every scene change. */
  dummies: TrainingDummy[] = []

  private activeIndex: number

  /**
   * Camera view offset, in world units. Everything in the scene (backdrop, player,
   * dummies, hitboxes) lives in world space and is drawn through this single
   * transform, so a world-fixed object stays locked to its scene as the player walks.
   *
   * Recomputed from the active scene's bounds whenever the scene changes, so a
   * camera never carries over from a scene with different geometry.
   */
  cameraX = 0

  /** Stage of the scene handover; 'idle' whenever gameplay is live. */
  transitionPhase: SceneTransitionPhase = 'idle'
  /** Seconds elapsed in the current transition phase. */
  transitionElapsed = 0
  /** Scene index the handover will land on, or -1 when nothing is pending. */
  transitionTargetIndex = -1
  /** Title shown on the transition card. */
  transitionTitle = ''
  /** Drifting cave fog, alive only while a handover is running. */
  private fog: FogMote[] = []
  /** Deterministic seed for [fog], varied per handover so it is not a loop. */
  private fogSeed = 0

  constructor(
    readonly animationSystem: SpriteAnimationSystem,
    backdrops: Record<string, LoadedImage | null> = {},
  ) {
    this.scenes = SCENES.map((definition) => ({
      definition,
      background: backdrops[definition.asset] ?? null,
      fit: fitBackdrop(
        definition.sourceWidth,
        definition.sourceHeight,
        definition.floorRow,
        definition.worldWidth,
        GameWorld.LOGICAL_HEIGHT,
      ),
    }))
    // activeIndex first: the scene's own floor plane is what the player is placed on.
    this.activeIndex = STARTING_SCENE_INDEX
    this.player = new PlayerController(animationSystem, this.activeScene.definition.spawnX, this.floorY)
    this.enterScene(STARTING_SCENE_INDEX)
  }

  /** Index of the scene currently being played. */
  get activeSceneIndex(): number {
    return this.activeIndex
  }

  /** The scene currently being played. */
  get activeScene(): SceneRuntime {
    return this.scenes[this.activeIndex]
  }

  /** Width of the active scene's world, in logical pixels. */
  get worldWidth(): number {
    return this.activeScene.definition.worldWidth
  }

  /**
   * Ground plane of the active scene, in logical pixels.
   *
   * The player's visible feet rest exactly on this, and it is what the jump impulse
   * starts from and gravity returns to. It comes from the scene's own artwork, so
   * the knight always stands on that scene's drawn floor rather than a line carried
   * over from somewhere else.
   */
  get floorY(): number {
    return this.activeScene.fit.floorY
  }

  /** Largest legal camera offset for the active scene. Always >= 0. */
  get maxCameraX(): number {
    return Math.max(0, this.worldWidth - GameWorld.LOGICAL_WIDTH)
  }

  /** True while a scene handover is running and gameplay is suspended. */
  get isTransitioning(): boolean {
    return this.transitionPhase !== 'idle'
  }

  /** Camera offset that puts a given world X at the centre of the viewport. */
  cameraXForPlayerX(worldX: number): number {
    return Math.min(Math.max(worldX - GameWorld.LOGICAL_WIDTH / 2, 0), this.maxCameraX)
  }

  /** Attaches a decoded backdrop to the scene that declares it. */
  setBackground(definitionId: string, image: LoadedImage | null): void {
    const scene = this.scenes.find((s) => s.definition.id === definitionId)
    if (scene) scene.background = image
  }

  /**
   * Switches to a scene: rebuilds its objects, places the player at its entrance and
   * snaps the camera to the new bounds.
   *
   * The camera is set outright rather than eased, because a camera that drifts in
   * from a previous scene's position would show the old framing sliding across the
   * new one. Nothing from the previous scene survives except the player and the
   * persistent HUD.
   */
  enterScene(index: number): void {
    this.activeIndex = Math.min(Math.max(index, 0), this.scenes.length - 1)
    const scene = this.activeScene
    this.dummies = scene.definition.dummyXs.map((x) => new TrainingDummy(x, scene.fit.floorY))
    this.damageTexts.length = 0
    this.particles.length = 0
    this.player.resetPlayer(scene.definition.spawnX, scene.fit.floorY)
    this.cameraX = this.cameraXForPlayerX(this.player.x)
    this.transitionPhase = 'idle'
    this.transitionElapsed = 0
    this.transitionTargetIndex = -1
    this.fog = []
  }

  /** Returns the player to the active scene's entrance without changing scene. */
  respawn(): void {
    this.player.resetPlayer(this.activeScene.definition.spawnX, this.floorY)
    this.cameraX = this.cameraXForPlayerX(this.player.x)
  }

  update(dt: number): void {
    const clampedDt = Math.min(0.05, Math.max(0.001, dt))

    // A running handover owns the clock: gameplay is suspended, and the scene swap
    // happens behind the fully opaque part of the fade so it is never seen.
    if (this.isTransitioning) {
      this.advanceTransition(clampedDt)
      updateFogMotes(this.fog, clampedDt, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)
      return
    }

    const scene = this.activeScene
    const floorY = scene.fit.floorY

    this.player.update(clampedDt, 0, this.worldWidth, floorY)

    // Camera smoothly follows player within this scene's bounds.
    const targetCamX = this.cameraXForPlayerX(this.player.x)
    this.cameraX += (targetCamX - this.cameraX) * 0.15

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

    // Reaching the exit stops normal movement and starts the handover.
    const exitX = scene.definition.exitX
    if (exitX !== null && this.player.x >= exitX) {
      this.beginTransition()
    }
  }

  /**
   * Starts the handover to the next scene.
   *
   * Does nothing at the last scene, which has no successor, so the player is simply
   * stopped by the world bound there.
   */
  beginTransition(): void {
    if (this.isTransitioning) return
    const next = this.activeIndex + 1
    if (next >= this.scenes.length) return
    this.transitionTargetIndex = next
    this.transitionTitle = this.scenes[next].definition.title
    this.transitionPhase = 'fadingOut'
    this.transitionElapsed = 0
    this.fogSeed += 1
    this.fog = buildFogMotes(this.fogSeed, 28, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)
  }

  /** Drives the fade / title / fade-in state machine. */
  private advanceTransition(dt: number): void {
    this.transitionElapsed += dt
    switch (this.transitionPhase) {
      case 'fadingOut':
        // Fully dark by the end of this phase, so the scene swap is hidden.
        if (this.transitionElapsed >= TRANSITION_FADE_OUT) {
          this.transitionElapsed -= TRANSITION_FADE_OUT
          if (this.transitionTargetIndex >= 0) this.enterScene(this.transitionTargetIndex)
          // enterScene clears the phase, so the handover is restated for the title.
          this.transitionPhase = 'title'
          this.transitionElapsed = 0
          this.transitionTargetIndex = -1
          this.transitionTitle = this.activeScene.definition.title
        }
        break
      case 'title':
        if (this.transitionElapsed >= TRANSITION_TITLE_HOLD) {
          this.transitionElapsed -= TRANSITION_TITLE_HOLD
          this.transitionPhase = 'fadingIn'
        }
        break
      case 'fadingIn':
        if (this.transitionElapsed >= TRANSITION_FADE_IN) {
          this.transitionPhase = 'idle'
          this.transitionElapsed = 0
          this.transitionTitle = ''
          this.fog = []
        }
        break
      default:
        break
    }
  }

  /** Opacity of the dark veil over the screen, 0 (clear) to 1 (opaque). */
  private fadeAlpha(): number {
    switch (this.transitionPhase) {
      case 'fadingOut':
        return Math.min(1, this.transitionElapsed / TRANSITION_FADE_OUT)
      case 'title':
        return 1
      case 'fadingIn':
        return Math.max(0, 1 - this.transitionElapsed / TRANSITION_FADE_IN)
      default:
        return 0
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
   * Draws the active scene's backdrop and nothing else.
   *
   * Split out of {@link render} so headless verification can capture the backdrop
   * exactly as the game composes it and use it as a subtraction reference. Only one
   * plate is ever drawn, so there is no seam between environments to hide and no
   * possibility of two environments appearing at once.
   */
  renderBackdrop(ctx: CanvasRenderingContext2D): void {
    const scene = this.activeScene
    const bg = scene.background
    const { fit } = scene
    if (!bg) {
      ctx.fillStyle = GameWorld.SCENE_FALLBACK_FILL
      ctx.fillRect(0, 0, this.worldWidth, GameWorld.LOGICAL_HEIGHT)
      return
    }
    ctx.drawImage(bg.image, 0, 0, bg.width, bg.height, fit.offsetX, fit.offsetY, fit.drawWidth, fit.drawHeight)
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
    // and therefore the collision bottom — land exactly on the scene's floor plane.
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
    const floorY = this.floorY

    ctx.save()
    // Single world -> screen transform. The backdrop, the player, the dummies and
    // every hitbox all live in the same world space, so a world-fixed object stays
    // locked to its scene while the player walks.
    ctx.translate(-this.cameraX, 0)

    // 1. The active scene's backdrop, and only that one, uniformly scaled to cover
    // the world and cropped where it overflows. No tiling, mirroring or stretching,
    // and by construction no gap: the plate is at least as large as the area it
    // covers on both axes.
    this.renderBackdrop(ctx)

    // 2. Scene boundary stone pillars, at this scene's own world edges.
    //
    // No ground slab or flagstone grid is drawn here on purpose: the backdrop
    // already renders a detailed floor starting at floorY, and painting an opaque
    // rectangle over that area is what previously hid the very surface the player
    // has to stand on.
    ctx.fillStyle = 'rgb(50, 55, 70)'
    ctx.fillRect(0, 0, 24, floorY)
    ctx.fillRect(this.worldWidth - 24, 0, this.worldWidth, floorY)

    // 3. Scene objects, at this scene's own world positions.
    for (const dummy of this.dummies) {
      dummy.render(ctx)
    }

    // 4. Character contact shadow, seated on the floor line.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.beginPath()
    ctx.ellipse(this.player.x, floorY + 1, 18, 3, 0, 0, Math.PI * 2)
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

    // 8. The scene handover card, in screen space so it is unaffected by the camera.
    this.renderTransition(ctx)
  }

  /**
   * Draws the scene transition: a dark fade, drifting fog and the area title.
   *
   * Deliberately not a loading screen. There is no spinner or progress bar; the
   * handover is presented as the character moving from one place to the next.
   */
  private renderTransition(ctx: CanvasRenderingContext2D): void {
    const alpha = this.fadeAlpha()
    if (alpha <= 0 && this.fog.length === 0) return

    // Fog drifts under the veil, brightest while the screen is still dark.
    if (this.fog.length > 0) {
      const fogAlpha = 90 * (0.35 + 0.65 * alpha)
      ctx.fillStyle = `rgba(198, 206, 222, ${(fogAlpha / 255).toFixed(3)})`
      for (const m of this.fog) {
        ctx.fillRect(m.x - m.size / 2, m.y - m.size / 2, m.size, m.size)
      }
    }

    ctx.fillStyle = `rgba(2, 3, 6, ${alpha.toFixed(3)})`
    ctx.fillRect(0, 0, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)

    if (this.transitionPhase !== 'title' || !this.transitionTitle) return

    // The title eases in over the first third of the hold, so it settles rather than
    // snapping on at full strength.
    const t = Math.min(1, this.transitionElapsed / (TRANSITION_TITLE_HOLD * 0.35))
    const cx = GameWorld.LOGICAL_WIDTH / 2
    const cy = GameWorld.LOGICAL_HEIGHT / 2

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // A warm ember glow behind the text, as if lit from within the dark.
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 190)
    glow.addColorStop(0, `rgba(255, 176, 92, ${(0.16 * t).toFixed(3)})`)
    glow.addColorStop(1, 'rgba(255, 176, 92, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, cy - 190, GameWorld.LOGICAL_WIDTH, 380)

    ctx.font = 'bold 26px Georgia, "Times New Roman", serif'
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.6 * t).toFixed(3)})`
    this.drawSpacedText(ctx, this.transitionTitle, cx + 1.5, cy + 1.5, 3)
    ctx.fillStyle = `rgba(238, 224, 196, ${(t * 0.96).toFixed(3)})`
    this.drawSpacedText(ctx, this.transitionTitle, cx, cy, 3)

    // Hairline rules flanking the title.
    const halfW = this.spacedTextWidth(ctx, this.transitionTitle, 3) / 2
    ctx.strokeStyle = `rgba(214, 180, 122, ${(t * 0.5).toFixed(3)})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - halfW - 44, cy + 0.5)
    ctx.lineTo(cx - halfW - 14, cy + 0.5)
    ctx.moveTo(cx + halfW + 14, cy + 0.5)
    ctx.lineTo(cx + halfW + 44, cy + 0.5)
    ctx.stroke()

    ctx.restore()
  }

  /**
   * Draws `text` centred at (x, y) with manual letter spacing.
   *
   * Canvas has no portable letterSpacing, and widely tracked small caps are most of
   * what makes a serif face read as a carved location card rather than body text.
   */
  private drawSpacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
    const startX = x - this.spacedTextWidth(ctx, text, spacing) / 2
    let cursor = startX
    for (const ch of text) {
      ctx.fillText(ch, cursor + ctx.measureText(ch).width / 2, y)
      cursor += ctx.measureText(ch).width + spacing
    }
  }

  private spacedTextWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
    let total = 0
    for (const ch of text) total += ctx.measureText(ch).width
    return total + spacing * Math.max(0, [...text].length - 1)
  }
}
