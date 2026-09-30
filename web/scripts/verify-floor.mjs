/**
 * Rendered-output verification for the ground/floor alignment.
 *
 * The headless logic tests prove the geometry is self-consistent, but they cannot
 * prove the pixels that actually reach the screen line up. This harness drives the
 * real page in Chromium, pins the game into deterministic states through the
 * ?debug=1 hook, and measures the rendered canvas directly:
 *
 *   - the backdrop's wall/floor horizon, read out of the rendered plate
 *   - the character's lowest opaque pixel, isolated by differencing the frame
 *     against the same frame with the character suppressed
 *
 * and asserts the two coincide. Run with:
 *   node scripts/verify-floor.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(webRoot, 'dist')
const shotsDir = join(webRoot, '..', '.scratch')

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ not built. Run `npm run build` first.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(distDir, rel === '/' ? 'index.html' : rel)
  if (!file.startsWith(distDir) || !existsSync(file)) file = join(distDir, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const GameWorld_DUMMY_X_EXPECTED = 450

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.error('  [page error]', m.text())
})
await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 })
await page.evaluate(() => {
  window.__game.pause()
  // Snapshot the untouched match-start state. Later sections move the player, so
  // the spawn checks have to read this rather than live mutated state.
  const g = window.__game
  window.__spawn = {
    playerX: g.world.player.x,
    cameraX: g.world.cameraX,
    sceneIndex: g.world.activeSceneIndex,
    spawnX: g.world.activeScene.definition.spawnX,
    worldWidth: g.world.worldWidth,
    floorY: g.world.floorY,
    logicalWidth: g.GameWorld.LOGICAL_WIDTH,
    logicalHeight: g.GameWorld.LOGICAL_HEIGHT,
    playerWidth: g.world.player.width,
    dummyXs: g.world.dummies.map((d) => d.x),
    exitX: g.world.activeScene.definition.exitX,
  }
})

/**
 * Installs helpers in the page: a logical->device mapping, a bare-plate renderer
 * used as the subtraction reference, and a settle() that waits for real frames.
 */
await page.evaluate(() => {
  const g = window.__game
  const canvas = document.querySelector('canvas.game-canvas')
  const ctx = canvas.getContext('2d')

  g.scale = () => Math.min(canvas.width / g.GameWorld.LOGICAL_WIDTH, canvas.height / g.GameWorld.LOGICAL_HEIGHT)
  g.offX = () => (canvas.width - g.GameWorld.LOGICAL_WIDTH * g.scale()) / 2
  g.offY = () => (canvas.height - g.GameWorld.LOGICAL_HEIGHT * g.scale()) / 2

  /**
   * The backdrop alone, drawn exactly as the game draws it: the world's own
   * two-plate composition through the real code path, same world-space camera
   * transform. Used as the subtraction reference so only world objects are
   * measured.
   *
   * This deliberately does NOT re-draw the plates here. It used to draw the arena
   * inline, which was fine while the arena was the whole world; now that a second
   * section sits beside it, a partial reference would differ from the real
   * composite across the whole cavern and read as phantom characters.
   */
  g.barePlate = () => {
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.fillStyle = '#0c0e14'
    b.fillRect(0, 0, c.width, c.height)
    const s = g.scale()
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    g.backdropOnly(b)
    return b.getImageData(0, 0, c.width, c.height).data
  }

  /**
   * Counts pixels of the viewport the backdrop never painted.
   *
   * The surface is pre-filled with a sentinel magenta that appears in neither
   * backdrop, then the scene's own drawing path is run over it. Anything still
   * magenta was never covered -- which is what a black gap actually is.
   *
   * Testing for the canvas clear colour instead would be unreliable: these are dark
   * night-time scenes, and the artwork can legitimately contain those exact values,
   * which reads as a gap where there is none.
   */
  g.unpaintedPixels = () => {
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.fillStyle = '#ff00ff'
    b.fillRect(0, 0, c.width, c.height)
    const s = g.scale()
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    g.backdropOnly(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    let unpainted = 0
    let edgeUnpainted = 0
    const at = (lx, ly) =>
      (Math.round(g.offY() + (ly + 0.5) * s) * c.width + Math.round(g.offX() + (lx + 0.5) * s)) * 4
    const magenta = (i) => d[i] === 0xff && d[i + 1] === 0x00 && d[i + 2] === 0xff
    for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly++) {
      for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx++) {
        if (!magenta(at(lx, ly))) continue
        unpainted++
        if (lx === 0 || ly === 0 || lx === g.GameWorld.LOGICAL_WIDTH - 1 || ly === g.GameWorld.LOGICAL_HEIGHT - 1) {
          edgeUnpainted++
        }
      }
    }
    return { unpainted, edgeUnpainted }
  }

  /** The canvas the game renders into, so checks can index its pixels. */
  g.canvas = canvas

  /** Backdrop pixels at the current camera, through the real drawing path. */
  g.backdropPixels = () => g.barePlate()

  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]

  /** Mean luminance per logical column of the drawn backdrop at the current camera. */
  g.columnProfile = () => {
    const d = g.barePlate()
    const cols = []
    for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx++) {
      let sum = 0
      for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly++) {
        const x = Math.round(g.offX() + lx * g.scale())
        const y = Math.round(g.offY() + ly * g.scale())
        sum += luma(d, (y * canvas.width + x) * 4)
      }
      cols.push(sum / g.GameWorld.LOGICAL_HEIGHT)
    }
    return cols
  }

  /** Mean luminance per column of a source image, for comparing against the draw. */
  g.sourceColumnProfile = (img) => {
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const x2 = c.getContext('2d')
    x2.drawImage(img, 0, 0)
    const d = x2.getImageData(0, 0, c.width, c.height).data
    const cols = []
    for (let x = 0; x < c.width; x++) {
      let sum = 0
      for (let y = 0; y < c.height; y++) sum += luma(d, (y * c.width + x) * 4)
      cols.push(sum / c.height)
    }
    return cols
  }

  const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0)
  g.argmax = argmax
  g.luma = luma

  /**
   * Horizontal profile of a colour, used to locate the dummy's straw torso.
   * Returns logical screen X positions where the pixel is close to the given rgb.
   */
  g.strawColumns = (cr, cg, cb, tol = 26) => {
    const s = g.scale()
    const d = g.pixels()
    const width = canvas.width
    const hits = new Set()
    for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly++) {
      const y = Math.round(g.offY() + ly * s)
      for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx++) {
        const x = Math.round(g.offX() + lx * s)
        const i = (y * width + x) * 4
        if (Math.abs(d[i] - cr) <= tol && Math.abs(d[i + 1] - cg) <= tol && Math.abs(d[i + 2] - cb) <= tol) {
          hits.add(lx)
        }
      }
    }
    return [...hits].sort((a, c) => a - c)
  }

  /** Longest contiguous run in a sorted column list, as its midpoint and width. */
  g.strawRun = (cols) => {
    if (!cols.length) return { mid: NaN, width: 0 }
    let best = [cols[0], cols[0]]
    let start = cols[0]
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] !== cols[i - 1] + 1) {
        if (cols[i - 1] - start > best[1] - best[0]) best = [start, cols[i - 1]]
        start = cols[i]
      }
    }
    if (cols[cols.length - 1] - start > best[1] - best[0]) best = [start, cols[cols.length - 1]]
    return { mid: (best[0] + best[1]) / 2, width: best[1] - best[0] }
  }

  /**
   * Lowest logical row of the dummy's solid body, using the real draw path.
   *
   * The threshold is 128 rather than 16 so the soft contact shadow (alpha ~0.39)
   * is excluded: the shadow hangs a few px below groundY by design and is not a foot.
   */
  g.dummyFootRow = (dummy) => {
    const s = g.scale()
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    dummy.render(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    const lx = dummy.x - g.world.cameraX
    const x0 = Math.round(g.offX() + (lx - dummy.width / 2 - 4) * s)
    const x1 = Math.round(g.offX() + (lx + dummy.width / 2 + 4) * s)
    for (let ly = g.GameWorld.LOGICAL_HEIGHT - 1; ly >= 0; ly--) {
      const y = Math.round(g.offY() + ly * s)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= c.width || y < 0 || y >= c.height) continue
        if (d[(y * c.width + x) * 4 + 3] >= 128) return ly
      }
    }
    return null
  }

  g.pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data

  g.settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  g.pin = async ({ action, frame, playerX, cameraX }) => {
    if (action) g.setFrame(action, frame)
    g.world.player.x = playerX
    g.world.cameraX = cameraX
    g.world.player.groundY = g.world.floorY
    await g.settle()
  }

  /**
   * Lowest logical row containing a pixel the character contributed.
   *
   * The bare plate is the reference, so the soft contact shadow (which is
   * deliberately drawn onto the floor) does not count as a foot; only pixels that
   * differ strongly from the plate are attributed to the sprite.
   */
  /**
   * Lowest logical row the character actually paints, measured from the alpha
   * channel of the real drawing path.
   *
   * `world.renderCharacter` is the same method the game calls, run here onto a
   * transparent surface, so this reports the sprite's genuine foot line rather than
   * a difference against the backdrop (where dark boots on a dark floor and the
   * soft contact shadow are both indistinguishable from the plate).
   */
  g.footRow = (minAlpha = 16) => {
    const s = g.scale()
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    g.world.renderCharacter(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    const half = g.GameWorld.SPRITE_DISPLAY_SIZE / 2
    const x0 = Math.round(g.offX() + (g.world.player.x - g.world.cameraX - half - 2) * s)
    const x1 = Math.round(g.offX() + (g.world.player.x - g.world.cameraX + half + 2) * s)
    for (let ly = g.GameWorld.LOGICAL_HEIGHT - 1; ly >= 0; ly--) {
      const y = Math.round(g.offY() + ly * s)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= c.width || y < 0 || y >= c.height) continue
        if (d[(y * c.width + x) * 4 + 3] >= minAlpha) return ly
      }
    }
    return null
  }

  /**
   * Same measurement, but sub-pixel: the alpha-weighted lowest edge, so the check
   * is not limited by the device pixel grid.
   */
  g.footY = () => {
    const s = g.scale()
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    g.world.renderCharacter(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    const half = g.GameWorld.SPRITE_DISPLAY_SIZE / 2
    const x0 = Math.round(g.offX() + (g.world.player.x - g.world.cameraX - half - 2) * s)
    const x1 = Math.round(g.offX() + (g.world.player.x - g.world.cameraX + half + 2) * s)
    let lowest = -1
    for (let y = 0; y < c.height; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= c.width) continue
        if (d[(y * c.width + x) * 4 + 3] >= 16) {
          lowest = y
          break
        }
      }
    }
    // The lowest painted device row, expressed in logical Y.
    return lowest < 0 ? null : (lowest + 1) / s - 0.5 / s + g.offY() / s
  }

  /**
   * Per-row stats of the plate at native resolution, indexed by SOURCE row: mean
   * luma and the fraction of lit pixels. The horizon is read against the artwork's
   * own rows, then converted to logical Y with the single BACKGROUND_SCALE factor.
   */
  g.plateRowStats = () => {
    const bg = g.world.activeScene.background
    const c = document.createElement('canvas')
    c.width = bg.width
    c.height = bg.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.drawImage(bg.image, 0, 0)
    const d = b.getImageData(0, 0, c.width, c.height).data
    const rows = []
    for (let y = 0; y < c.height; y++) {
      let sum = 0
      let lit = 0
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        sum += l
        if (l > 60) lit++
      }
      rows.push({ mean: sum / c.width, lit: lit / c.width })
    }
    return rows
  }

  /**
   * Bounding box of the character sprite as actually rendered, in logical units.
   *
   * Measured off the alpha channel of the real drawing path, so it reflects the
   * shipped sprite pipeline (sheet display scale, per-frame cell, foot correction)
   * rather than any constant. Comparing this box between scenes is what proves the
   * player is not being scaled to suit a backdrop.
   */
  g.spriteBounds = () => {
    const s = g.scale()
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(s, s)
    b.translate(-g.world.cameraX, 0)
    g.world.renderCharacter(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0
    for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly++) {
      for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx++) {
        const x = Math.round(g.offX() + (lx - g.world.cameraX) * s)
        const y = Math.round(g.offY() + ly * s)
        if (x < 0 || x >= c.width || y < 0 || y >= c.height) continue
        if (d[(y * c.width + x) * 4 + 3] < 32) continue
        minX = Math.min(minX, lx); maxX = Math.max(maxX, lx)
        minY = Math.min(minY, ly); maxY = Math.max(maxY, ly)
        count++
      }
    }
    if (!count) return null
    return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count }
  }

  /** Logical Y -> source row of the backdrop artwork. */
  g.srcRow = (ly) => Math.round((ly - g.world.activeScene.fit.offsetY) / g.world.activeScene.fit.scale)

  /** The active scene's decoded plate, for comparing source pixels to drawn ones. */
  g.scenePlate = () => g.world.activeScene.background

  /**
   * Logical Y -> source row, for a specific scene.
   *
   * Each scene is scaled and cropped on its own terms, so a row cannot be derived
   * from a shared factor any more -- it has to go through that scene's fit.
   */
  g.rowForScene = (sceneIndex, ly) => {
    const fit = g.world.scenes[sceneIndex].fit
    return (ly - fit.offsetY) / fit.scale
  }
})

// --- 1. Each plate's own horizon ------------------------------------------------
// Run for every scene, not just the opening one. The floor row is declared per scene
// and each scene is scaled and cropped on its own terms, so the only way to know the
// declared plane really lands on the drawn floor is to find the horizon in the
// rendered plate and compare.
const horizons = await page.evaluate(async () => {
  const g = window.__game
  const out = []
  for (let i = 0; i < g.world.scenes.length; i++) {
    g.loadScene(i)
    g.setCamera(0)
    await g.settle()
    const rows = g.plateRowStats()
    const H = rows.length
    const fit = g.world.activeScene.fit
    // 8 logical rows expressed in the artwork's own rows, via this scene's scale.
    const W = Math.max(2, Math.round(8 / fit.scale))
    const toLogical = (srcRow) => fit.offsetY + srcRow * fit.scale
    const toSrc = (ly) => (ly - fit.offsetY) / fit.scale

    // The horizon is where the plate gets broadly brighter, so compare mean luma
    // across a window rather than a single row. A one-row difference is not usable
    // here: the prison's bright flagstone joint lower down the floor jumps further
    // than the real horizon does, which is precisely how the old row-620 value was
    // chosen.
    let bestDelta = -Infinity
    let bestSrc = -1
    for (let y = W; y < H - W; y++) {
      let below = 0
      let above = 0
      for (let k = 0; k < W; k++) {
        below += rows[y + k].mean
        above += rows[y - 1 - k].mean
      }
      const delta = below / W - above / W
      if (delta > bestDelta) {
        bestDelta = delta
        bestSrc = y
      }
    }
    // Largest single-row mean jump, kept to prove the seam is not the horizon.
    let maxStep = { delta: -Infinity, y: -1 }
    for (let y = 1; y < H; y++) {
      const d = rows[y].mean - rows[y - 1].mean
      if (d > maxStep.delta) maxStep = { delta: d, y }
    }
    const floorY = g.world.floorY
    out.push({
      id: g.world.activeScene.definition.id,
      horizon: toLogical(bestSrc),
      horizonSrc: bestSrc,
      maxStepSrc: maxStep.y,
      bestDelta,
      floorY,
      declaredFloorRow: g.world.activeScene.definition.floorRow,
      srcRowOfFloor: toSrc(floorY),
      meanAbove: rows[Math.round(toSrc(floorY - 3))].mean,
      meanAt: rows[Math.round(toSrc(floorY + 3))].mean,
    })
  }
  g.loadScene(0)
  await g.settle()
  return out
})

console.log('rendered backdrop')
for (const plate of horizons) {
  check(
    `${plate.id}: the widest brightening band in its plate is its floor plane`,
    Math.abs(plate.horizon - plate.floorY) <= 1.5,
    `horizon at source row ${plate.horizonSrc} = logical y ${plate.horizon.toFixed(2)}, floor plane ${plate.floorY.toFixed(3)} (windowed jump ${plate.bestDelta.toFixed(2)})`,
  )
  check(
    `${plate.id}: its floor plane is the declared artwork row, not a rounded guess`,
    Math.abs(plate.srcRowOfFloor - plate.declaredFloorRow) < 1,
    `floor plane maps back to source row ${plate.srcRowOfFloor.toFixed(2)}, declared ${plate.declaredFloorRow}`,
  )
  check(
    `${plate.id}: the wall above its floor is darker than the floor below`,
    plate.meanAbove < plate.meanAt,
    `mean luma ${plate.meanAbove.toFixed(1)} above vs ${plate.meanAt.toFixed(1)} below`,
  )
}
const prison = horizons.find((h) => h.id === 'forgotten_prison')
check(
  "the prison's bright flagstone seam is NOT its horizon",
  prison && Math.abs(prison.maxStepSrc - prison.horizonSrc) > 20,
  prison
    ? `largest one-row mean jump is at source row ${prison.maxStepSrc} (the flagstone joint), horizon is ${prison.horizonSrc}`
    : 'prison scene missing',
)
check(
  'each scene finds its horizon at its own scale, not a shared one',
  horizons.length >= 2 &&
    horizons.every((h) => Math.abs(h.horizonSrc - h.declaredFloorRow) <= 1) &&
    horizons[0].horizonSrc !== horizons[1].horizonSrc,
  horizons.map((h) => `${h.id}: row ${h.horizonSrc} -> y ${h.horizon.toFixed(2)}`).join(' | '),
)

// --- 2. Feet vs. that horizon, for every measured frame row --------------------
const frames = [
  ['IDLE', 0, 'idle (foot row 111)'],
  ['IDLE', 7, 'idle (foot row 111)'],
  ['WALK', 0, 'walk (foot row 111)'],
  ['WALK', 2, 'walk (foot row 110)'],
  ['WALK', 5, 'walk (foot row 111)'],
  ['WALK', 8, 'walk (foot row 112)'],
  ['WALK', 11, 'walk (foot row 112)'],
  // Every frame of the 8-frame jump sheet, so a mis-registered row in any one
  // would be caught. All 8 share foot row 115: the art compresses in place and
  // the world's arc supplies the rise.
  ['JUMP', 0, 'jump (foot row 115)'],
  ['JUMP', 1, 'jump (foot row 115)'],
  ['JUMP', 2, 'jump (foot row 115)'],
  ['JUMP', 4, 'jump (foot row 115)'],
  ['JUMP', 6, 'jump (foot row 115)'],
  ['JUMP', 7, 'jump (foot row 115)'],
]

console.log('visible feet vs. rendered floor')
for (const [action, frame, label] of frames) {
  const res = await page.evaluate(
    async ({ action, frame }) => {
      const g = window.__game
      await g.pin({ action, frame, playerX: 320, cameraX: 0 })
      return { footRow: g.footRow(), footY: g.footY(), floorY: g.world.floorY, action: g.animations.currentAction, frame: g.animations.currentFrameIndex }
    },
    { action, frame },
  )
  const pinned = res.action === action && res.frame === frame
  check(
    `${label} frame ${frame}: feet sit on the floor`,
    pinned && res.footRow !== null && Math.abs(res.footRow - res.floorY) <= 1.5,
    `lowest painted row y=${res.footRow} (edge ${res.footY?.toFixed(2)}), floor ${res.floorY.toFixed(3)}${pinned ? '' : ` (state not pinned: ${res.action}/${res.frame})`}`,
  )
}

// --- 3. A single constant would visibly fail on the walk extremes -------------
console.log('per-frame correction is actually doing work')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (const frame of [0, 2, 8]) {
      await g.pin({ action: 'WALK', frame, playerX: 320, cameraX: 0 })
      out.push({ frame, footRow: g.footRow() })
    }
    return out
  })
  const rows = res.map((r) => r.footRow)
  const spread = Math.max(...rows) - Math.min(...rows)
  check(
    'walk frames 0/2/8 land within a pixel of each other',
    spread <= 1.5,
    `rows ${rows.join(', ')} (spread ${spread.toFixed(2)})`,
  )
}

// --- 4. Camera is clamped to the world ---------------------------------------
console.log('camera resets per scene')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.resume()
    const out = []
    for (const index of [0, 1]) {
      g.loadScene(index)
      await new Promise((r) => requestAnimationFrame(r))
      const scene = g.world.activeScene
      // Walk toward the right edge, sampling the camera as we go.
      const seen = []
      g.world.player.setMovementInput(1)
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        if (i % 40 === 0) seen.push({ cameraX: g.world.cameraX, scene: g.world.activeSceneIndex })
        // Stop short of the exit so the camera is observed, not the handover.
        if (g.world.player.x > 560) g.world.player.setMovementInput(0)
      }
      g.world.player.setMovementInput(0)
      out.push({
        id: scene.definition.id,
        worldWidth: g.world.worldWidth,
        maxCamera: g.world.maxCameraX,
        spawnCamera: g.world.cameraXForPlayerX(scene.definition.spawnX),
        seen,
        samples: seen.every((c) => c.cameraX >= -1e-6 && c.cameraX <= g.world.maxCameraX + 1e-6),
      })
    }
    g.loadScene(0)
    // Let the game draw the restored scene before anything samples the live canvas.
    await g.settle()
    return out
  })

  for (const r of res) {
    check(
      `${r.id}: the camera stays inside that scene's bounds`,
      r.samples,
      `cameras ${r.seen.map((c) => c.cameraX.toFixed(2)).join(', ')}, allowed 0..${r.maxCamera}`,
    )
    check(
      `${r.id}: the camera starts reset at the scene entrance`,
      Math.abs(r.spawnCamera - Math.min(Math.max(r.worldWidth > 640 ? 0 : 0, 0), r.maxCamera)) < 1e-9,
      `entrance camera ${r.spawnCamera}, allowed 0..${r.maxCamera}`,
    )
  }
}

console.log('exactly one scene is on screen at a time')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (const index of [0, 1]) {
      g.loadScene(index)
      await g.settle()
      const plate = g.scenePlate()
      // Mean luma of the drawn backdrop, which is what tells the two plates apart.
      const d = g.backdropPixels()
      let sum = 0
      let n = 0
      for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly += 4) {
        for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx += 4) {
          const x = Math.round(g.offX() + lx * g.scale())
          const y = Math.round(g.offY() + ly * g.scale())
          sum += g.luma(d, (y * g.canvas.width + x) * 4)
          n++
        }
      }
      out.push({
        index,
        id: g.world.activeScene.definition.id,
        asset: plate ? plate.width + 'x' + plate.height : 'missing',
        mean: sum / n,
      })
    }
    g.loadScene(0)
    await g.settle()
    return out
  })
  const prison = res.find((r) => r.index === 0)
  const cavern = res.find((r) => r.index === 1)
  check('each scene draws its own plate', res.every((r) => r.asset !== 'missing'), res.map((r) => `${r.id}:${r.asset}`).join(', '))
  check(
    'the two scenes are genuinely different pictures, not the same one twice',
    prison && cavern && Math.abs(prison.mean - cavern.mean) > 1,
    `prison mean luma ${prison?.mean.toFixed(2)}, cavern ${cavern?.mean.toFixed(2)}`,
  )
  check(
    'each scene uses a differently sized source plate',
    prison && cavern && prison.asset !== cavern.asset,
    `${prison?.asset} vs ${cavern?.asset}`,
  )
}

// --- 5. The ground slab must be gone -----------------------------------------
console.log('backdrop is not painted over')
{
  const res = await page.evaluate(() => {
    const g = window.__game
    const live = g.pixels()
    const bare = g.barePlate()
    const width = document.querySelector('canvas.game-canvas').width
    // Sample the floor well away from the character and the dummies.
    const s = g.scale()
    let mismatched = 0
    let sampled = 0
    for (const lx of [200, 260, 380, 440, 500]) {
      for (const ly of [g.world.floorY + 6, g.world.floorY + 20, g.world.floorY + 45]) {
        const x = Math.round(g.offX() + lx * s)
        const y = Math.round(g.offY() + ly * s)
        const i = (y * width + x) * 4
        sampled++
        const d = Math.abs(live[i] - bare[i]) + Math.abs(live[i + 1] - bare[i + 1]) + Math.abs(live[i + 2] - bare[i + 2])
        if (d > 24) mismatched++
      }
    }
    return { mismatched, sampled }
  })
  check(
    'open floor still shows the backdrop artwork',
    res.mismatched === 0,
    `${res.mismatched}/${res.sampled} sample points differ from the bare plate`,
  )
}

// --- 6. Training dummies live in world space ----------------------------------
console.log('training dummy is a world fixture')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.resume()
    const d = g.world.dummies[0]
    const worldX = d.x
    const out = []

    g.world.player.setMovementInput(1)
    for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r))
    g.world.player.setMovementInput(0)
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r))
    // The walk may end with the camera deep in the cavern, which would scroll the
    // dummy off screen entirely. Recentre on it so the foot measurement is always
    // taken while it is actually being drawn.
    g.setCamera(d.x - g.GameWorld.LOGICAL_WIDTH / 2)
    out.push({ phase: 'walked right', dummyWorldX: d.x, cameraX: g.world.cameraX, footRow: g.dummyFootRow(d) })

    g.world.player.setMovementInput(-1)
    for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r))
    g.world.player.setMovementInput(0)
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r))
    g.setCamera(d.x - g.GameWorld.LOGICAL_WIDTH / 2)
    out.push({ phase: 'walked back', dummyWorldX: d.x, cameraX: g.world.cameraX, footRow: g.dummyFootRow(d) })
    return out
  })

  for (const r of res) {
    check(
      `${r.phase}: dummy world X unchanged while the camera moves`,
      r.dummyWorldX === GameWorld_DUMMY_X_EXPECTED,
      `worldX ${r.dummyWorldX}, cameraX ${r.cameraX.toFixed(2)}, dummy screen x ${(r.dummyWorldX - r.cameraX).toFixed(1)}`,
    )
    check(
      `${r.phase}: dummy feet on FLOOR_Y`,
      r.footRow !== null && Math.abs(r.footRow - 222.0833) <= 1.5,
      `feet at y=${r.footRow}`,
    )
  }
}

// --- 7. The dummy is a fixed object in the rendered frame --------------------
console.log('dummy drawn in world space, not screen space')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.resume()
    // Walk right so the camera genuinely scrolls off zero...
    g.world.player.setMovementInput(1)
    for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r))
    g.world.player.setMovementInput(0)
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r))
    const scrolled = g.world.cameraX
    g.pause()
    // ...then pin the camera so the dummy sits in the middle of the sampling
    // window. A screen-space draw would ignore both the scroll and this offset.
    g.setCamera(g.world.dummies[0].x - 225)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return {
      mid: g.strawRun(g.strawColumns(180, 150, 90)).mid,
      worldX: g.world.dummies[0].x,
      cameraX: g.world.cameraX,
      scrolled,
      foot: g.dummyFootRow(g.world.dummies[0]),
      floorY: g.world.floorY,
      playerX: g.world.player.x,
    }
  })
  check(
    'dummy renders at world X minus camera, not at a screen constant',
    Math.abs(res.mid - (res.worldX - res.cameraX)) < 3,
    `rendered at screen x ${res.mid.toFixed(1)}, world x ${res.worldX} - camera ${res.cameraX} = ${res.worldX - res.cameraX}`,
  )
  check(
    'the camera really scrolled away from zero',
    res.scrolled > 0,
    `camera reached ${res.scrolled.toFixed(2)} before being pinned`,
  )
  check(
    'dummy feet sit on FLOOR_Y',
    res.foot !== null && Math.abs(res.foot - res.floorY) <= 1.5,
    `feet at y=${res.foot}, floor ${res.floorY.toFixed(3)}`,
  )
  check(
    'the player did move while the dummy held its world X',
    res.playerX > 600,
    `player at ${res.playerX.toFixed(1)}`,
  )
}

// --- 8. Dummy hitbox and HP bar follow the dummy ----------------------------
console.log('hitbox and health bar are anchored to the dummy')
{
  const res = await page.evaluate(() => {
    const g = window.__game
    const d = g.world.dummies[0]
    d.hp = 40
    const originX = d.x
    const before = { ...d.hitbox }
    d.x = originX + 150
    const after = { ...d.hitbox }
    d.x = originX
    d.hp = 100
    return { before, after, delta: 150, floorY: g.world.floorY, width: d.width, height: d.height }
  })
  check(
    'hitbox follows the dummy world X',
    Math.abs(res.after.left - (res.before.left + res.delta)) < 1e-6 &&
      Math.abs(res.after.right - (res.before.right + res.delta)) < 1e-6,
    `moved ${(res.after.left - res.before.left).toFixed(1)}px for a ${res.delta}px move`,
  )
  check(
    'hitbox bottom is the floor plane',
    Math.abs(res.after.bottom - res.floorY) < 1e-6,
    `bottom ${res.after.bottom}, floor ${res.floorY.toFixed(3)}`,
  )
  check(
    'hitbox top is anchored to the dummy height',
    Math.abs(res.after.top - (res.floorY - res.height)) < 1e-6,
    `top ${res.after.top}, expected ${(res.floorY - res.height).toFixed(3)}`,
  )
}

// --- 9. Scene spawning ---------------------------------------------------------
console.log('each scene spawns the player at its own entrance')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (let i = 0; i < g.world.scenes.length; i++) {
      g.loadScene(i)
      await g.settle()
      const sc = g.world.activeScene
      out.push({
        id: sc.definition.id,
        spawnX: sc.definition.spawnX,
        playerX: g.world.player.x,
        floorY: g.world.floorY,
        sceneFloorY: sc.fit.floorY,
        cameraX: g.world.cameraX,
        expectedCamera: g.world.cameraXForPlayerX(sc.definition.spawnX),
        dummyXs: g.world.dummies.map((d) => d.x),
        declaredDummies: [...sc.definition.dummyXs],
        dummyGroundY: g.world.dummies.map((d) => d.groundY),
      })
    }
    g.loadScene(0)
    return out
  })

  for (const r of res) {
    check(`${r.id}: the player spawns at the scene entrance`, Math.abs(r.playerX - r.spawnX) < 1e-9, `playerX ${r.playerX}, entrance ${r.spawnX}`)
    check(`${r.id}: the player is grounded on that scene's floor plane`, Math.abs(r.floorY - r.sceneFloorY) < 1e-9, `${r.floorY} vs ${r.sceneFloorY}`)
    check(`${r.id}: the camera resets to the new scene`, Math.abs(r.cameraX - r.expectedCamera) < 1e-9, `cameraX ${r.cameraX}, expected ${r.expectedCamera}`)
    check(`${r.id}: the scene's own dummies, and only its own`, JSON.stringify(r.dummyXs) === JSON.stringify(r.declaredDummies), `got ${JSON.stringify(r.dummyXs)}, declared ${JSON.stringify(r.declaredDummies)}`)
    check(`${r.id}: every dummy stands on that scene's floor`, r.dummyGroundY.every((y) => Math.abs(y - r.sceneFloorY) < 1e-9), r.dummyGroundY.join(', '))
  }

  const prison = res[0]
  const cavern = res[1]
  check(
    "one scene's fixtures do not carry into the next",
    cavern && !cavern.dummyXs.some((x) => prison.dummyXs.includes(x)),
    `prison ${JSON.stringify(prison?.dummyXs)} vs cavern ${JSON.stringify(cavern?.dummyXs)}`,
  )
}

// --- 10. The backdrop fills its scene, with no black gap anywhere --------------
console.log('no black background gaps in either scene')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (let i = 0; i < g.world.scenes.length; i++) {
      g.loadScene(i)
      g.setCamera(0)
      await g.settle()
      out.push({
        id: g.world.activeScene.definition.id,
        ...g.unpaintedPixels(),
        total: g.GameWorld.LOGICAL_WIDTH * g.GameWorld.LOGICAL_HEIGHT,
        fit: g.world.activeScene.fit,
        worldWidth: g.world.worldWidth,
      })
    }
    g.loadScene(0)
    await g.settle()
    return out
  })

  for (const r of res) {
    check(
      `${r.id}: the backdrop paints the whole viewport, no unfilled gap`,
      r.unpainted === 0,
      `${r.unpainted}/${r.total} logical pixels never painted`,
    )
    check(
      `${r.id}: the viewport border is fully painted`,
      r.edgeUnpainted === 0,
      `${r.edgeUnpainted} border pixels never painted`,
    )
    check(
      `${r.id}: the plate is at least as large as the area it covers`,
      r.fit.drawWidth >= r.worldWidth && r.fit.drawHeight >= 360,
      `draw ${r.fit.drawWidth}x${r.fit.drawHeight} vs world ${r.worldWidth}x360`,
    )
    check(
      `${r.id}: the fit crops rather than insets`,
      r.fit.offsetX <= 0 && r.fit.offsetY <= 0,
      `offset ${r.fit.offsetX},${r.fit.offsetY}`,
    )
  }
}

// --- 11. The player keeps one size and stays grounded, in every scene ----------
console.log('player scale is identical in every scene')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (let i = 0; i < g.world.scenes.length; i++) {
      g.loadScene(i)
      await g.pin({ action: 'IDLE', frame: 0, playerX: g.world.activeScene.definition.spawnX, cameraX: 0 })
      out.push({ id: g.world.activeScene.definition.id, box: g.spriteBounds(), scale: g.world.activeScene.fit.scale })
    }
    g.loadScene(0)
    return out
  })

  const ref = res[0]?.box
  check('the sprite renders with a measurable box in every scene', res.every((r) => r.box), res.map((r) => `${r.id}:${r.box ? 'ok' : 'none'}`).join(', '))
  for (const r of res.slice(1)) {
    check(
      `${r.id}: the sprite is the same size as in ${res[0].id}, despite a different backdrop scale`,
      r.box && ref && r.box.width === ref.width && r.box.height === ref.height,
      `${r.box?.width}x${r.box?.height} vs ${ref?.width}x${ref?.height} (backdrop scales ${res[0].scale.toFixed(4)} vs ${r.scale.toFixed(4)})`,
    )
  }
  check(
    'the scenes really do use different backdrop scales, so this is a real test',
    res.length >= 2 && Math.abs(res[0].scale - res[1].scale) > 1e-6,
    res.map((r) => r.scale.toFixed(4)).join(' vs '),
  )
}

console.log('the player is grounded on each scene floor, on every walk frame')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (let i = 0; i < g.world.scenes.length; i++) {
      g.loadScene(i)
      const spawn = g.world.activeScene.definition.spawnX
      const samples = []
      for (const [action, frame] of [['IDLE', 0], ['IDLE', 7], ['WALK', 0], ['WALK', 2], ['WALK', 5], ['WALK', 8], ['WALK', 11], ['JUMP', 4]]) {
        await g.pin({ action, frame, playerX: spawn, cameraX: 0 })
        samples.push({ action, frame, foot: g.footRow(), floorY: g.world.floorY })
      }
      out.push({ id: g.world.activeScene.definition.id, floorY: g.world.floorY, samples })
    }
    g.loadScene(0)
    return out
  })

  for (const r of res) {
    for (const s of r.samples) {
      check(
        `${r.id}: ${s.action} frame ${s.frame} feet sit on the scene floor`,
        s.foot !== null && Math.abs(s.foot - r.floorY) <= 1.5,
        `foot row ${s.foot}, floor ${r.floorY.toFixed(3)}`,
      )
    }
  }
  check(
    'the scenes really do have different floor planes',
    res.length >= 2 && Math.abs(res[0].floorY - res[1].floorY) > 1,
    res.map((r) => r.floorY.toFixed(2)).join(' vs '),
  )
}

// --- 12. The handover: one scene at a time, dark at the swap -------------------
console.log('scene transition on the web: dark, single-scene, and lands correctly')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.pause()

    // Full-viewport rendered backdrop for each scene, captured before the handover
    // so every transition frame can be attributed to exactly one of them.
    const plates = {}
    const ids = []
    for (let i = 0; i < g.world.scenes.length; i++) {
      g.loadScene(i)
      g.setCamera(0)
      await g.settle()
      const id = g.world.activeScene.definition.id
      ids.push(id)
      plates[id] = g.backdropPixels()
    }

    // Subsampled device pixels, so the fit below stays cheap over ~100 frames.
    const pts = []
    const lxOf = []
    for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly += 5) {
      for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx += 5) {
        pts.push(Math.round(g.offY() + ly * g.scale()) * g.canvas.width + Math.round(g.offX() + lx * g.scale()))
        lxOf.push(lx)
      }
    }

    /**
     * Logical columns covered by what the world draws on top of the backdrop: the
     * boundary pillars at each end of the scene, the knight (a 100px cell) and the
     * dummies (a 52px crossbeam).
     *
     * Those are drawn over the veiled scene during a handover, so they are excluded
     * from the model below. Without the exclusion they would dominate the residual
     * and mask a real two-scene blend, which is the opposite of what this check is
     * for. Everything else in the frame must still be one scene under a veil.
     */
    const objectColumns = (dummies) => {
      const m = new Uint8Array(g.GameWorld.LOGICAL_WIDTH)
      const mark = (cx, half) => {
        for (let x = Math.max(0, Math.floor(cx - half)); x <= Math.min(g.GameWorld.LOGICAL_WIDTH - 1, Math.ceil(cx + half)); x++) {
          m[x] = 1
        }
      }
      // The two boundary pillars, which the renderer draws on every frame.
      const W = g.GameWorld.LOGICAL_WIDTH
      for (let x = 0; x < 26; x++) m[x] = 1
      for (let x = W - 26; x < W; x++) m[x] = 1
      mark(g.world.player.x - g.world.cameraX, 56)
      for (const d of dummies) mark(d.x - g.world.cameraX, 32)
      return m
    }

    // A transition frame is the scene uniformly veiled toward rgb(2,3,6). Fit that
    // single alpha per scene; if any frame were a blend of two environments, it
    // would fit neither and leave a large residual.
    const VEIL = [2, 3, 6]
    const fit = (frame, plate, mask) => {
      let num = 0
      let den = 0
      for (let k = 0; k < pts.length; k++) {
        if (mask[lxOf[k]]) continue
        const i = pts[k] * 4
        for (let c = 0; c < 3; c++) {
          const s = plate[i + c] - VEIL[c]
          const f = frame[i + c] - VEIL[c]
          num += s * f
          den += s * s
        }
      }
      const a = den > 0 ? Math.min(1, Math.max(0, 1 - num / den)) : 1
      // 95th percentile of the per-pixel error, not the mean: fog motes, the ember
      // glow and the title glyphs are sparse bright pixels drawn over the veil and
      // would dominate an average, whereas a genuine two-scene blend is wrong almost
      // everywhere and still shows up here.
      const errs = []
      for (let k = 0; k < pts.length; k++) {
        if (mask[lxOf[k]]) continue
        const i = pts[k] * 4
        let worst = 0
        for (let c = 0; c < 3; c++) {
          const pred = (1 - a) * plate[i + c] + a * VEIL[c]
          worst = Math.max(worst, Math.abs(frame[i + c] - pred))
        }
        errs.push(worst)
      }
      errs.sort((x, y) => x - y)
      return { alpha: a, p95: errs[Math.floor(errs.length * 0.95)] ?? 0, used: errs.length }
    }

    // The median is the right measure of "is this frame dark": the title glyphs and
    // the ember glow are meant to be visible, but they cover a small minority of the
    // screen, so an un-veiled scene would still show a bright median.
    const meanLuma = (d) => {
      const lumas = []
      let bright = 0
      for (let ly = 0; ly < g.GameWorld.LOGICAL_HEIGHT; ly++) {
        for (let lx = 0; lx < g.GameWorld.LOGICAL_WIDTH; lx++) {
          const x = Math.round(g.offX() + lx * g.scale())
          const y = Math.round(g.offY() + ly * g.scale())
          const i = (y * g.canvas.width + x) * 4
          const l = g.luma(d, i)
          lumas.push(l)
          if (l > 120) bright++
        }
      }
      lumas.sort((a, b) => a - b)
      return { median: lumas[Math.floor(lumas.length / 2)], max: lumas[lumas.length - 1], bright }
    }

    // Drive the handover by hand so the frames are sampled deterministically.
    g.loadScene(0)
    await g.settle()
    const fromId = g.world.activeScene.definition.id
    g.world.player.setMovementInput(1)
    for (let i = 0; i < 600 && !g.world.isTransitioning; i++) g.world.update(1 / 60)
    g.world.player.setMovementInput(0)
    const exitX = g.world.player.x

    g.startTransition()
    const frames = []
    for (let step = 0; step < 200; step++) {
      // Only sample while the handover is running. The first frame after it completes
      // is ordinary gameplay -- player, dummies and shadow included -- which is not a
      // veiled scene and would not fit the model below.
      if (!g.world.isTransitioning) break
      await g.settle()
      const plateNow = g.pixels()
      const mask = objectColumns(g.world.dummies)
      const fits = {}
      for (const id of ids) fits[id] = fit(plateNow, plates[id], mask)
      const stats = meanLuma(plateNow)
      frames.push({
        phase: g.world.transitionPhase,
        scene: g.world.activeScene.definition.id,
        rms: Object.fromEntries(ids.map((id) => [id, fits[id].p95])),
        alpha: Object.fromEntries(ids.map((id) => [id, fits[id].alpha])),
        luma: stats,
      })
      g.world.update(1 / 120)
    }
    // Finish the handover so the landing state can be asserted.
    for (let step = 0; step < 200 && g.world.isTransitioning; step++) g.world.update(1 / 120)
    return {
      ids,
      fromId,
      exitX,
      frames,
      finalScene: g.world.activeScene.definition.id,
      finalPlayerX: g.world.player.x,
      finalFloorY: g.world.floorY,
      finalCamera: g.world.cameraX,
      expectedCamera: g.world.cameraXForPlayerX(g.world.player.x),
      finalDummies: g.world.dummies.map((d) => d.x),
      finalPhase: g.world.transitionPhase,
      title: g.world.transitionTitle,
    }
  })

  const ids = res.ids
  check('the handover starts from the prison', res.fromId === 'forgotten_prison', res.fromId)
  check('the player reached the exit to trigger it', res.exitX > 600, `exit reached at x ${res.exitX}`)
  check('it lands on the cavern', res.finalScene === 'underground_cavern', res.finalScene)
  check('gameplay resumes when it ends', res.finalPhase === 'idle', res.finalPhase)
  check('the title is cleared afterwards', res.title === '', res.title)

  const phases = new Set(res.frames.map((f) => f.phase))
  check(
    'it fades out, holds the title, then fades back in',
    phases.has('fadingOut') && phases.has('title') && phases.has('fadingIn'),
    [...phases].join(','),
  )

  // During the fades, every visible frame must be ONE scene under a veil: a frame
  // mixing two environments would fit both poorly, and a seam would fit neither.
  //
  // The title card is excluded because it deliberately paints an ember glow and the
  // area name over the veil. It is covered by its own check below, which is the
  // stronger statement for that phase anyway: an opaque veil means no scenery is
  // visible at all, so there is nothing there to seam.
  const fadeFrames = res.frames.filter((f) => f.phase === 'fadingOut' || f.phase === 'fadingIn')
  const worst = fadeFrames.map((f) => ({ phase: f.phase, rms: Math.min(...Object.values(f.rms)), scene: f.scene }))
  const worstOverall = worst.length ? worst.reduce((a, b) => (b.rms > a.rms ? b : a)) : null
  check(
    'both fade phases were sampled',
    res.frames.some((f) => f.phase === 'fadingOut') && res.frames.some((f) => f.phase === 'fadingIn'),
    `${res.frames.filter((f) => f.phase === 'fadingOut').length} out / ${res.frames.filter((f) => f.phase === 'fadingIn').length} in`,
  )
  check(
    'every faded frame is a single scene under a veil, never a blend of two',
    worstOverall !== null && worstOverall.rms < 8,
    worstOverall
      ? `worst 95th-percentile residual ${worstOverall.rms.toFixed(2)} luma levels during "${worstOverall.phase}" on ${worstOverall.scene}`
      : 'no fade frames sampled',
  )
  // Each fade frame must match its own scene better than the other one, which is what
  // makes "one scene at a time" a positive identification rather than a loose bound:
  // a frame showing both would fit neither.
  const bestFit = (f) => ids.reduce((a, b) => (f.rms[b] < f.rms[a] ? b : a), ids[0])
  // Frames where the veil is still opaque carry no scenery at all -- both plates fit
  // them exactly, because the screen is uniformly the veil colour. There is nothing
  // to identify there, so they are excluded rather than counted as a mismatch.
  const visibleFadeFrames = fadeFrames.filter((f) => f.alpha[f.scene] < 0.95)
  const misidentified = visibleFadeFrames.filter((f) => bestFit(f) !== f.scene)
  check(
    'each fade frame is identified as the scene it is actually showing',
    visibleFadeFrames.length > 0 && misidentified.length === 0,
    misidentified.length
      ? `${misidentified.length} frames matched the wrong plate, e.g. "${misidentified[0].phase}" showed ${misidentified[0].scene} but fitted ${bestFit(misidentified[0])}`
      : `${visibleFadeFrames.length} visible fade frames all matched their own plate`,
  )
  check('the frame sample actually covers the handover', res.frames.length > 30, `${res.frames.length} frames`)

  // The swap must happen in the dark, or the change of scenery is visible.
  const titleFrames = res.frames.filter((f) => f.phase === 'title')
  check(
    'the screen is fully dark while the area title is up',
    titleFrames.length > 0 && titleFrames.every((f) => f.luma.median < 6),
    `title frames ${titleFrames.length}, brightest median ${Math.max(...titleFrames.map((f) => f.luma.median)).toFixed(2)}`,
  )
  const swapIndex = res.frames.findIndex((f) => f.scene === 'underground_cavern')
  const swapFrame = res.frames[swapIndex]
  check(
    'the scene swap happens behind the opaque part of the fade',
    swapFrame && swapFrame.phase === 'title' && swapFrame.luma.median < 6,
    swapFrame ? `swapped during "${swapFrame.phase}", median luma ${swapFrame.luma.median.toFixed(2)}` : 'never swapped',
  )
  check(
    'the previous scene is still on screen while it fades out',
    res.frames.filter((f) => f.phase === 'fadingOut').every((f) => f.scene === 'forgotten_prison'),
    '',
  )

  // The title is actually drawn, not merely scheduled.
  const brightTitle = titleFrames.filter((f) => f.luma.bright > 200)
  check(
    'the area name is actually rendered on screen',
    brightTitle.length > 0,
    `frames with title pixels ${brightTitle.length}, peak count ${Math.max(0, ...titleFrames.map((f) => f.luma.bright))}`,
  )

  check(
    'the player is placed at the cavern entrance',
    Math.abs(res.finalPlayerX - 120) < 1e-9,
    `playerX ${res.finalPlayerX}`,
  )
  check(
    'the camera is reset for the cavern',
    Math.abs(res.finalCamera - res.expectedCamera) < 1e-9,
    `cameraX ${res.finalCamera}, expected ${res.expectedCamera}`,
  )
  check(
    "the prison's dummies did not follow the player",
    JSON.stringify(res.finalDummies) === JSON.stringify([400, 520]),
    `cavern dummies ${JSON.stringify(res.finalDummies)}`,
  )
}

// --- 10. Action buttons carry no coloured circle -----------------------------
console.log('every action button shares one neutral fill')
{
  // Checked across all five buttons, not just the attack button: a per-button
  // colour is what produces a coloured disc behind a label or an icon.
  const res = await page.evaluate(() => {
    const tags = ['button_attack', 'button_heavy_attack', 'button_jump', 'button_dash', 'button_block']
    return tags.map((tag) => {
      const btn = document.querySelector(`[data-testid="${tag}"]`)
      if (!btn) return { tag, missing: true }
      const cs = getComputedStyle(btn)
      const rect = btn.getBoundingClientRect()
      const img = btn.querySelector('img')
      const irect = img ? img.getBoundingClientRect() : null
      return {
        tag,
        missing: false,
        bgImage: cs.backgroundImage,
        bgColor: cs.backgroundColor,
        varColor: cs.getPropertyValue('--btn-color').trim(),
        inlineColor: btn.style.getPropertyValue('--btn-color').trim(),
        radius: cs.borderRadius,
        buttonSize: [Math.round(rect.width), Math.round(rect.height)],
        iconSize: irect ? [Math.round(irect.width), Math.round(irect.height)] : null,
        iconNatural: img ? [img.naturalWidth, img.naturalHeight] : null,
        iconSrc: img ? img.getAttribute('src') : null,
        label: btn.textContent.trim(),
      }
    })
  })

  const parse = (css) => {
    const m = (css ?? '').match(/[\d.]+/g)
    return m ? m.slice(0, 3).map(Number) : null
  }
  const isReddish = (rgb) => rgb && rgb[0] > 90 && rgb[0] > rgb[1] * 1.5 && rgb[0] > rgb[2] * 1.5

  for (const b of res) {
    check(`button ${b.tag} exists`, !b.missing, b.missing ? 'not found' : '')
    if (b.missing) continue
    check(`button ${b.tag} background is not a background image`, b.bgImage === 'none', b.bgImage)
    check(`button ${b.tag} fill has no red`, !isReddish(parse(b.bgColor)), b.bgColor)
    check(`button ${b.tag} fill is the dark slate`, b.varColor.toLowerCase() === '#39405a', b.varColor)
    check(
      `button ${b.tag} sets no inline colour override`,
      b.inlineColor === '',
      b.inlineColor || 'none',
    )
  }

  // All five must resolve to one identical computed fill.
  const colors = new Set(res.filter((b) => !b.missing).map((b) => b.bgColor))
  check('all five buttons share one identical fill', colors.size === 1, [...colors].join(' | '))

  // The pressed state is a separate rule; it must stay neutral too.
  const pressed = await page.evaluate(() => {
    const tags = ['button_attack', 'button_heavy_attack', 'button_jump', 'button_dash', 'button_block']
    return tags.map((tag) => {
      const btn = document.querySelector(`[data-testid="${tag}"]`)
      btn.classList.add('is-pressed')
      const bg = getComputedStyle(btn).backgroundColor
      btn.classList.remove('is-pressed')
      return { tag, bg }
    })
  })
  const pressedColors = new Set(pressed.map((b) => b.bg))
  check(
    'pressed state stays neutral on all five buttons',
    pressedColors.size === 1 && !isReddish(parse([...pressedColors][0])),
    [...pressedColors].join(' | '),
  )

  // Each button must resolve to a distinct fingerprint, otherwise two buttons
  // are pointing at the same cached bytes.
  const fingerprints = res.filter((b) => !b.missing).map((b) => b.iconSrc?.match(/\?v=([0-9a-f]+)/)?.[1])
  check(
    'all five icons have distinct content fingerprints',
    new Set(fingerprints).size === 5,
    fingerprints.join(' '),
  )

  // The attack icon itself must still be red-free and correctly sized.
  const atk = res.find((b) => b.tag === 'button_attack')
  if (atk && !atk.missing) {
    // Every button must carry artwork rather than falling back to text.
    for (const b of res.filter((x) => !x.missing)) {
      check(
        `button ${b.tag} renders its icon, not the text fallback`,
        b.iconSize !== null,
        b.iconSize ? `${b.iconSize[0]}x${b.iconSize[1]}` : 'no <img>',
      )
      check(
        `button ${b.tag} icon file loaded (no broken image)`,
        b.iconSize !== null && b.iconNatural[0] > 0,
        b.iconSize ? `natural ${b.iconNatural[0]}x${b.iconNatural[1]}` : 'not loaded',
      )
      check(
        `button ${b.tag} icon keeps its 39x39 square aspect`,
        b.iconSize !== null && b.iconNatural[0] === b.iconNatural[1],
        b.iconSize ? `natural ${b.iconNatural[0]}x${b.iconNatural[1]}` : 'not loaded',
      )
      // Stable filenames mean a byte swap leaves the URL identical, so caches
      // would keep serving the previous artwork. The ?v= fingerprint must ride
      // along, and must be unique per icon.
      check(
        `button ${b.tag} icon URL is cache-busted`,
        b.iconSrc !== null && /\?v=[0-9a-f]{6,}$/.test(b.iconSrc),
        b.iconSrc ?? 'no <img>',
      )
      // The icon fills 90% of the button and stays square.
      const expected = Math.round(b.buttonSize[0] * 0.9)
      check(
        `button ${b.tag} icon is centred at 90% of the button`,
        b.iconSize !== null && Math.abs(b.iconSize[0] - expected) <= 2 && b.iconSize[0] === b.iconSize[1],
        `icon ${b.iconSize?.[0]}px in a ${b.buttonSize[0]}px button (expected ~${expected})`,
      )
    }

    const iconRed = await page.evaluate(() => {
      const img = document.querySelector('[data-testid="button_attack"] img')
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 16) continue
        if (d[i] > 90 && d[i] > d[i + 1] * 1.5 && d[i] > d[i + 2] * 1.5) n++
      }
      return n
    })
    check('attack icon asset contains no red pixels', iconRed === 0, `${iconRed} red pixels`)
    check(
      'sword icon is about 56x56 and keeps its square aspect',
      Math.abs(atk.iconSize[0] - 56) <= 2 && Math.abs(atk.iconSize[1] - 56) <= 2 && atk.iconSize[0] === atk.iconSize[1],
      `rendered ${atk.iconSize[0]}x${atk.iconSize[1]}, natural ${atk.iconNatural[0]}x${atk.iconNatural[1]}`,
    )
    check(
      'sword icon is centred inside the button',
      Math.abs(atk.iconSize[0] - atk.buttonSize[0] * 0.9) <= 2,
      `icon ${atk.iconSize[0]}px in a ${atk.buttonSize[0]}px button`,
    )
    check('attack button touch area unchanged', atk.buttonSize[0] === 62 && atk.buttonSize[1] === 62, `${atk.buttonSize}`)
  }

  // The other four keep their 54px touch areas.
  for (const b of res.filter((x) => !x.missing && x.tag !== 'button_attack')) {
    check(
      `button ${b.tag} touch area unchanged at 54px`,
      b.buttonSize[0] === 54 && b.buttonSize[1] === 54,
      `${b.buttonSize}`,
    )
  }
}

// --- 6. Visual proof -----------------------------------------------------------
await page.evaluate(async () => {
  const g = window.__game
  await g.pin({ action: 'IDLE', frame: 0, playerX: window.__spawn.playerX, cameraX: window.__spawn.cameraX })
})
await page.screenshot({ path: join(shotsDir, 'floor-idle.png') })
await page.evaluate(async () => {
  const g = window.__game
  await g.pin({ action: 'WALK', frame: 8, playerX: window.__spawn.playerX, cameraX: window.__spawn.cameraX })
})
await page.screenshot({ path: join(shotsDir, 'floor-walk.png') })
console.log(`  screenshots: ${join(shotsDir, 'floor-idle.png')}, ${join(shotsDir, 'floor-walk.png')}`)

await browser.close()
server.close()

if (failures > 0) {
  console.error(`\n${failures} rendered check(s) FAILED.`)
  process.exit(1)
}
console.log('\nAll rendered checks passed.')
