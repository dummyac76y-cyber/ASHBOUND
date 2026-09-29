import { assetUrl } from './assetUrl'
import { GameWorld } from './game/GameWorld'
import type { PlayerAction } from './game/PlayerAction'
import { SpriteAnimationSystem } from './game/SpriteAnimationSystem'
import { AnimationInspectorDialog } from './ui/AnimationInspectorDialog'
import { GameHud } from './ui/GameHud'
import { KEY_HINTS, VirtualControls } from './ui/VirtualControls'
import './style.css'

const SPRITE_BASE = assetUrl('sprites')
const BACKGROUND_URL = assetUrl('bg/arena_bg.png')

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
  const background = await loadImage(BACKGROUND_URL)
  const world = new GameWorld(animations, background ? { image: background, width: background.width, height: background.height } : null)

  // Sheets must be decoded before the first update(), otherwise frame 0 is skipped.
  await animations.reloadAll()

  const hud = new GameHud(
    () => world.player,
    () => animations,
    () => openInspector(),
    () => world.player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y),
  )

  const controls = new VirtualControls({
    onMove: (h) => world.player.setMovementInput(h),
    onAttack: () => void world.player.onAttack(),
    onHeavyAttack: () => void world.player.onHeavyAttack(),
    onBlockChange: (b) => world.player.setBlockActive(b),
    onDash: () => void world.player.onDash(),
    onJump: () => void world.player.onJump(),
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

  app.append(hud.root, controls.root, keyHints())
  loading.remove()

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
      if (!paused) world.update(dt)

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

      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      ctx.beginPath()
      ctx.rect(0, 0, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)
      ctx.clip()
      world.render(ctx)
      ctx.restore()

      hud.update(fps)
    } else {
      lastFrameTime = now
      lastFpsCalc = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Pause the simulation when the tab is hidden so returning does not
  // fast-forward the player across the arena.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastFrameTime = 0
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
