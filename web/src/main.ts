import { assetUrl } from './assetUrl'
import {
  AUDIO_CLIPS,
  AudioSystem,
  MAIN_MENU_AMBIENCE,
  MAIN_MENU_MUSIC,
} from './game/AudioSystem'
import { GameWorld } from './game/GameWorld'
import { NPC_IDLE_WALK_SHEET } from './game/npcAssets'
import type { PlayerAction } from './game/PlayerAction'
import { SpriteAnimationSystem } from './game/SpriteAnimationSystem'
import { AnimationInspectorDialog } from './ui/AnimationInspectorDialog'
import { GameHud } from './ui/GameHud'
import { MainMenu } from './ui/MainMenu'
import { KEY_HINTS, VirtualControls } from './ui/VirtualControls'
import './style.css'

const SPRITE_BASE = assetUrl('sprites')

/**
 * Backdrops, one per scene, keyed by the asset name the scene declares.
 *
 * Keyed rather than passed positionally so adding a scene is a matter of adding an
 * entry to the scene list and an image here: nothing has to be threaded through by
 * index, which is what made the previous two-plate arrangement easy to get wrong.
 */
const BACKDROP_URLS: Record<string, string> = {
  img_arena_bg_hd: assetUrl('bg/arena_bg.png'),
  img_underground_cavern_hd: assetUrl('bg/cavern_bg.png'),
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    // A missing backdrop is survivable: GameWorld falls back to a flat gradient.
    img.onerror = () => {
      console.warn(`[main] optional asset not found: ${url}`)
      resolve(null)
    }
    img.src = url
  })
}

function keyHints(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'key-hints'
  for (const [key, label] of KEY_HINTS) {
    const item = document.createElement('span')
    item.className = 'key-hint'
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    item.append(kbd, document.createTextNode(label))
    wrap.append(item)
  }
  return wrap
}

async function boot(): Promise<void> {
  const appEl = document.querySelector<HTMLDivElement>('#app')
  if (!appEl) throw new Error('#app container is missing from index.html')
  const app: HTMLDivElement = appEl

  const canvas = document.createElement('canvas')
  canvas.className = 'game-canvas'
  canvas.dataset.testid = 'game_canvas'

  const loading = document.createElement('div')
  loading.className = 'loading'
  loading.textContent = 'Loading sprites…'

  app.append(canvas, loading)

  const ctxOrNull = canvas.getContext('2d', { alpha: false })
  if (!ctxOrNull) throw new Error('2D canvas context is unavailable in this browser')
  const ctx: CanvasRenderingContext2D = ctxOrNull

  const animations = new SpriteAnimationSystem(SPRITE_BASE)

  // --- Audio -----------------------------------------------------------------
  //
  // Optional in the strongest sense: the game starts, plays and is perfectly playable with
  // no audio file present at all, which is the state the project is in right now. Every clip
  // 404s, every call into the bank is a no-op that reports false, and nothing above this
  // line has to know whether sound came out.
  const audio = new AudioSystem()
  //
  // A browser will not let an AudioContext make noise until the page has been interacted
  // with, and it refuses silently. `unlock` is wired to the first gesture of any kind and
  // is safe to call on every gesture until the context reports itself running, so a player
  // who never clicks anything but uses the keyboard still gets sound.
  for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(event, () => audio.unlock(), { passive: true })
  }
  // Loaded, not awaited before the menu is built: decoding is fast but the menu is not
  // blocked on it, and an absent file resolves rather than rejects.
  void audio.loadAll().then((found) => {
    console.info(
      `[AudioSystem] ${found.loaded.length}/${AUDIO_CLIPS.length} clips loaded` +
        (found.missing.length ? `, waiting on ${found.missing.length} missing file(s)` : ''),
    )
  })

  // Every scene's backdrop is decoded up front so a handover never has to wait on
  // the network: the fade covers the swap, and a missing plate would otherwise show
  // as a flash of the fallback fill.
  const backdropEntries = await Promise.all(
    Object.entries(BACKDROP_URLS).map(
      async ([asset, url]) =>
        [asset, await loadImage(url)] as const,
    ),
  )
  const backdrops: Record<string, { image: HTMLImageElement; width: number; height: number } | null> = {}
  for (const [asset, image] of backdropEntries) {
    backdrops[asset] = image ? { image, width: image.width, height: image.height } : null
  }

  const world = new GameWorld(animations, backdrops)
  // The world reports what happened; the audio bank decides what that sounds like. Wiring it
  // here rather than inside GameWorld keeps the simulation free of a dependency on sound --
  // which matters, because sound is the one part of this that is allowed to be absent.
  // One clip for both a light and a heavy connect: a near-duplicate pair differing by a few
  // percent is not worth an asset, and the bank's replay interval stops a heavy from cutting
  // off the light hit that landed a moment before it.
  world.events.onSwordHit = () => audio.play('sword_hit')
  world.events.onFootstep = () => audio.play('footsteps_stone')

  // Sheets must be decoded before the first update(), otherwise frame 0 is skipped.
  await animations.reloadAll()

  // The NPC walk sheet, decoded with the backdrops so an NPC standing in the very
  // first frame is never a gap in the scene. A missing one is survivable: the NPC
  // still draws its shadow and HP bar.
  const npcImage = await loadImage(assetUrl(`sprites/${NPC_IDLE_WALK_SHEET.file}`))
  world.setNpcSprite(npcImage ? { image: npcImage, width: npcImage.width, height: npcImage.height } : null)

  const hud = new GameHud(
    () => world.player,
    () => animations,
    () => openInspector(),
    () => world.respawn(),
  )

  // Sound is played from the same `boolean` the action returns, so an input that the state
  // machine refuses -- a dash with no stamina left, an attack mid-swing -- stays silent
  // instead of playing a sound for something that did not happen.
  const controls = new VirtualControls({
    onMove: (h) => world.player.setMovementInput(h),
    onAttack: () => {
      if (world.player.onAttack()) audio.play('sword_attack')
    },
    onHeavyAttack: () => {
      if (world.player.onHeavyAttack()) audio.play('heavy_attack')
    },
    onBlockChange: (b) => world.player.setBlockActive(b),
    onDash: () => {
      if (world.player.onDash()) audio.play('dash')
    },
    onJump: () => {
      if (world.player.onJump()) audio.play('jump')
    },
  })

  let inspector: AnimationInspectorDialog | null = null
  function openInspector(): void {
    if (inspector) return
    inspector = new AnimationInspectorDialog(animations, closeInspector)
    app.append(inspector.root)
  }
  function closeInspector(): void {
    inspector?.dispose()
    inspector = null
  }

  const keyHintsEl = keyHints()
  app.append(hud.root, controls.root, keyHintsEl)
  loading.remove()

  // --- The main menu gates the world ---
  //
  // The simulation is held until START GAME rather than being started and paused:
  // nothing behind the menu moves, so the scene the player walks into is the one they
  // were just looking at. `?debug=1` skips the menu entirely so the pixel-level
  // verification harness measures the world, not a title screen.
  const params = new URLSearchParams(location.search)
  const debugMode = params.has('debug')
  // `?debug=1&menu=1` shows the menu while keeping the test hooks, so the harness can
  // measure the menu and the world in the same page.
  const showMenu = !debugMode || params.has('menu')
  let started = debugMode && !showMenu

  /**
   * The in-game furniture is hidden with the `hidden` attribute.
   *
   * That only works because the stylesheet honours it: `.hud` sets `display: flex`, and
   * an author rule beats the user-agent rule for `[hidden]`, so setting the attribute was
   * silently doing nothing and the HUD stayed on screen behind the menu. `.hud[hidden]`
   * and friends exist for exactly this reason.
   */
  function setStarted(next: boolean): void {
    started = next
    hud.root.hidden = !started
    controls.root.hidden = !started
    keyHintsEl.hidden = !started
    // The menu has its own cues and they are mutually exclusive with the game's: leaving a
    // title track playing under the first walk of a new game is worse than no music at all.
    audio.unlock()
    if (next) audio.stop()
    else {
      audio.start(MAIN_MENU_MUSIC)
      audio.start(MAIN_MENU_AMBIENCE)
    }
  }
  setStarted(started)

  // In debug mode the menu is not built at all, not merely hidden. The harness measures
  // world pixels, and a mounted title screen would be one more thing between it and the
  // scene it is checking.
  if (showMenu) {
    const menu = new MainMenu({
      onStart: () => setStarted(true),
      audio,
      // A browser tab cannot close itself: `window.close` is ignored on a page that did
      // not open it. So web QUIT returns to the title rather than offering a button that
      // silently does nothing. Android really does exit, in GameScreen.
      onQuit: () => setStarted(false),
    })
    app.append(menu.root)
    void menu.whenReady().then(() => menu.reveal())
  }

  // --- Sizing: letterbox the 640x360 logical viewport into the canvas ---
  let dpr = 1
  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 3)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    // Strictly disable bilinear interpolation to keep pixel-art crisp.
    ctx.imageSmoothingEnabled = false
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  /** How many frames of the world have been drawn. The menu harness asserts this. */
  let worldRenders = 0

  // --- FPS readout ---
  let fps = 60
  let frameCounter = 0
  let lastFpsCalc = performance.now()

  let lastFrameTime = 0
  let paused = false
  function tick(now: number): void {
    if (lastFrameTime !== 0) {
      const dt = (now - lastFrameTime) / 1000
      lastFrameTime = now
      if (!paused && started) world.update(dt)

      frameCounter++
      if (now - lastFpsCalc >= 1000) {
        fps = frameCounter
        frameCounter = 0
        lastFpsCalc = now
      }

      const scale = Math.min(canvas.width / GameWorld.LOGICAL_WIDTH, canvas.height / GameWorld.LOGICAL_HEIGHT)
      const offsetX = (canvas.width - GameWorld.LOGICAL_WIDTH * scale) / 2
      const offsetY = (canvas.height - GameWorld.LOGICAL_HEIGHT * scale) / 2

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#0c0e14'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // The world is not drawn while the menu is up, not merely left un-updated. The
      // backdrop is `contain`, so on a viewport that is not 16:9 it leaves transparent
      // bands at the top and bottom, and anything drawn on the canvas shows through
      // them. Gating the simulation alone is not enough: a still scene is still visible.
      if (started) {
        ctx.save()
        ctx.translate(offsetX, offsetY)
        ctx.scale(scale, scale)
        ctx.beginPath()
        ctx.rect(0, 0, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)
        ctx.clip()
        world.render(ctx)
        ctx.restore()
        worldRenders++
      }

      if (started) hud.update(fps)
    } else {
      lastFrameTime = now
      lastFpsCalc = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Pause the simulation when the tab is hidden so returning does not
  // fast-forward the player across the arena. Audio is suspended with it: a looping track
  // left running behind another tab is the sort of thing that makes people close the window,
  // and a cue that fires while hidden should be dropped rather than queued up to all go off
  // at once the moment they come back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend()
    else {
      audio.resume()
      lastFrameTime = 0
      // Re-assert whichever cues the current screen wants, since suspension drops them.
      if (!started) {
        audio.start(MAIN_MENU_MUSIC)
        audio.start(MAIN_MENU_AMBIENCE)
      }
    }
  })

  // Test hook, opt-in via ?debug=1. It lets the headless verification harness put
  // the game into an exact state (a chosen action/frame, a chosen camera X) and
  // read back the same numbers the renderer uses, so the rendered pixels can be
  // checked against the geometry instead of eyeballed.
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      __game: {
        world,
        animations,
        audio,
        AudioSystem,
        GameWorld,
        /**
         * Freezes the simulation while still drawing. Needed because update() would
         * otherwise overwrite the pinned action and frame on the very next tick.
         */
        pause(): void {
          paused = true
        },
        resume(): void {
          paused = false
          lastFrameTime = 0
        },
        /**
         * Sets an action and pins a frame, for pixel-stable captures.
         *
         * `force` bypasses the priority rule, which the rendered checks need: a
         * running attack refuses to yield to a lower-priority action, so without
         * it a sheet like idle.png could not be re-measured after an attack had
         * been captured.
         */
        setFrame(action: PlayerAction, frameIndex: number, force = false): void {
          animations.playAction(action, true, force)
          animations.currentFrameIndex = frameIndex
        },
        /** Pins the camera so the floor line can be checked at several offsets. */
        setCamera(x: number): void {
          world.cameraX = x
        },
        /**
         * How many frames of the world have been drawn since load.
         *
         * The menu harness asserts this stays at zero while the menu is up: gating the
         * simulation is not the same as gating the drawing, and a paused scene is still
         * visible through the letterbox bands a `contain` backdrop leaves.
         */
        worldRenderCount(): number {
          return worldRenders
        },
        /** Whether gameplay is currently running. */
        isStarted(): boolean {
          return started
        },
        /**
         * Jumps straight to a scene, with no transition, so each environment can be
         * inspected on its own.
         */
        loadScene(index: number): void {
          world.enterScene(index)
        },
        /** Runs the handover that a player triggers by walking off the exit. */
        startTransition(): void {
          world.beginTransition()
        },
        /** Places the player at a world X, for driving an exit from a known point. */
        setPlayerX(x: number): void {
          world.player.x = x
        },
        /** Readable snapshot of the scene/transition state, for assertions. */
        sceneState(): Record<string, unknown> {
          const scene = world.activeScene
          return {
            index: world.activeSceneIndex,
            id: scene.definition.id,
            title: scene.definition.title,
            worldWidth: world.worldWidth,
            floorY: world.floorY,
            fit: scene.fit,
            cameraX: world.cameraX,
            maxCameraX: world.maxCameraX,
            playerX: world.player.x,
            spawnX: scene.definition.spawnX,
            exitX: scene.definition.exitX,
            npcXs: world.npcs.map((n) => n.x),
            npcStates: world.npcs.map((n) => n.state),
            npcFrames: world.npcs.map((n) => n.currentFrame),
            npcSpriteLoaded: world.npcSprite !== null,
            phase: world.transitionPhase,
            elapsed: world.transitionElapsed,
            title2: world.transitionTitle,
            loaded: scene.background !== null,
          }
        },
        /**
         * The backdrop alone, through the real drawing path. The harness subtracts
         * this to isolate world objects; going through the world rather than
         * re-drawing the plates keeps the reference honest.
         */
        backdropOnly: (ctx: CanvasRenderingContext2D): void => world.renderBackdrop(ctx),
        /**
         * The NPCs alone, through their real drawing path, in world space.
         *
         * The harness renders this onto a transparent surface to measure the sprite
         * by its alpha channel. The NPC is dark artwork on dark scenery, so its
         * silhouette cannot be picked out of a composited frame by colour.
         */
        npcOnly: (ctx: CanvasRenderingContext2D, index?: number): void => {
          if (index === undefined) {
            for (const npc of world.npcs) npc.render(ctx)
            return
          }
          const npc = world.npcs[index]
          if (npc) npc.render(ctx)
        },
        /**
         * An NPC's sprite alone -- no ground shadow, no HP bar.
         *
         * Measuring a character's size through the full `render()` means guessing
         * which drawn pixels belong to the artwork: the shadow is too faint to catch,
         * but the HP bar is opaque and sits above the head, and any attempt to split
         * it off by finding the empty band beneath it breaks the moment the artwork
         * has an empty row of its own, such as between the legs of a stride. Drawing
         * only the sprite makes the measurement unambiguous.
         */
        npcSpriteOnly: (ctx: CanvasRenderingContext2D, index?: number): void => {
          const npc = index === undefined ? world.npcs[0] : world.npcs[index]
          npc?.renderSpriteOnly(ctx)
        },
        /**
         * The player alone, through the real drawing path, for comparing a
         * character's on-screen size against the NPC's on the same surface.
         */
        characterOnly: (ctx: CanvasRenderingContext2D): void => world.renderCharacter(ctx),
        /**
         * Pins an NPC's state and frame, for pixel-stable captures.
         *
         * The game loop keeps ticking, so a captured frame is only reproducible if
         * the animation is held rather than left to advance.
         */
        setNpcFrame(index: number, state: 'idle' | 'walk', frame: number): void {
          const npc = world.npcs[index]
          if (!npc) return
          npc.state = state
          npc.currentFrame = frame
        },
        /** Forces an NPC to face a given way, for checking the horizontal mirror. */
        setNpcFacing(index: number, facingRight: boolean): void {
          const npc = world.npcs[index]
          if (npc) npc.facingRight = facingRight
        },
        /** Readable snapshot of an NPC, for assertions. */
        npcState: (index: number): Record<string, unknown> => {
          const npc = world.npcs[index]
          if (!npc) return {}
          return {
            x: npc.x,
            groundY: npc.groundY,
            state: npc.state,
            frame: npc.currentFrame,
            facingRight: npc.facingRight,
            flipX: npc.flipX,
            isWalking: npc.isWalking,
            fps: npc.fps,
            hp: npc.hp,
            maxHp: npc.maxHp,
            hitbox: { ...npc.hitbox },
            patrolLeft: npc.patrolLeft,
            patrolRight: npc.patrolRight,
            width: npc.width,
            height: npc.height,
            spriteLoaded: npc.sprite !== null,
          }
        },
      },
    })
  }
}

boot().catch((err) => {
  console.error('[main] failed to start', err)
  const app = document.querySelector('#app')
  if (app) {
    app.innerHTML = `<div class="loading loading-error">Failed to start: ${String(err)}</div>`
  }
})
