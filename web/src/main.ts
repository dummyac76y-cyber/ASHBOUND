import { GameWorld } from './game/GameWorld'
import { SpriteAnimationSystem } from './game/SpriteAnimationSystem'
import { AnimationInspectorDialog } from './ui/AnimationInspectorDialog'
import { GameHud } from './ui/GameHud'
import { KEY_HINTS, VirtualControls } from './ui/VirtualControls'
import './style.css'

/**
 * Asset base, derived from import.meta.env.BASE_URL so the build works from a
 * sub-path (GitHub Pages project sites, a CDN folder, a Capacitor webview).
 *
 * BASE_URL always ends in '/' — either './' for a relative build or '/' for one
 * served at the domain root. Append to it directly; stripping the slash would
 * turn './sprites' into a root-absolute '/sprites' and break sub-path hosting.
 */
const ASSET_BASE = import.meta.env.BASE_URL
const SPRITE_BASE = `${ASSET_BASE}sprites`
const BACKGROUND_URL = `${ASSET_BASE}bg/arena_bg.png`

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
  function tick(now: number): void {
    if (lastFrameTime !== 0) {
      const dt = (now - lastFrameTime) / 1000
      lastFrameTime = now
      world.update(dt)

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
}

boot().catch((err) => {
  console.error('[main] failed to start', err)
  const app = document.querySelector('#app')
  if (app) {
    app.innerHTML = `<div class="loading loading-error">Failed to start: ${String(err)}</div>`
  }
})
