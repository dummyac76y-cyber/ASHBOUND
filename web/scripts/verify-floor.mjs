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
await page.evaluate(() => window.__game.pause())

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

  /** The backdrop alone, at exactly the scale the game draws it. */
  g.barePlate = () => {
    const s = g.scale()
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.fillStyle = '#0c0e14'
    b.fillRect(0, 0, c.width, c.height)
    const bg = g.world.background
    // Logical dest size is the plate at BACKGROUND_SCALE; the device scale s maps
    // logical pixels onto the canvas backing store.
    const k = g.GameWorld.BACKGROUND_SCALE * s
    b.drawImage(bg.image, 0, 0, bg.width, bg.height, g.offX(), g.offY(), bg.width * k, bg.height * k)
    return b.getImageData(0, 0, c.width, c.height).data
  }

  g.pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data

  g.settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  g.pin = async ({ action, frame, playerX, cameraX }) => {
    if (action) g.setFrame(action, frame)
    g.world.player.x = playerX
    g.world.cameraX = cameraX
    g.world.player.groundY = g.GameWorld.FLOOR_Y
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
    const bg = g.world.background
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

  /** Logical Y -> source row of the backdrop artwork. */
  g.srcRow = (ly) => Math.round(ly * (g.world.background.height / g.GameWorld.LOGICAL_HEIGHT))
})

// --- 1. The plate's own horizon ------------------------------------------------
const plate = await page.evaluate(() => {
  const g = window.__game
  const rows = g.plateRowStats()
  const H = rows.length
  // 8 logical rows expressed in the artwork's own rows.
  const W = Math.round(8 * (H / g.GameWorld.LOGICAL_HEIGHT))

  // The horizon is where the plate gets broadly brighter, so compare mean luma
  // across a window rather than a single row. A one-row difference is not
  // usable here: the bright flagstone joint lower down the floor jumps further
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

  // Largest single-row mean jump, kept only to prove the seam is not the horizon.
  let maxStep = { delta: -Infinity, y: -1 }
  for (let y = 1; y < H; y++) {
    const d = rows[y].mean - rows[y - 1].mean
    if (d > maxStep.delta) maxStep = { delta: d, y }
  }

  const toLogical = (srcRow) => (srcRow * g.GameWorld.LOGICAL_HEIGHT) / H
  const horizon = toLogical(bestSrc)
  return {
    horizon,
    horizonSrc: bestSrc,
    maxStepLogicalY: toLogical(maxStep.y),
    maxStepSrc: maxStep.y,
    bestDelta,
    floorY: g.GameWorld.FLOOR_Y,
    floorSrc: Math.round((g.GameWorld.FLOOR_Y * H) / g.GameWorld.LOGICAL_HEIGHT),
    meanAbove: rows[Math.round(((g.GameWorld.FLOOR_Y - 3) * H) / g.GameWorld.LOGICAL_HEIGHT)].mean,
    meanAt: rows[Math.round(((g.GameWorld.FLOOR_Y + 3) * H) / g.GameWorld.LOGICAL_HEIGHT)].mean,
  }
})

console.log('rendered backdrop')
check(
  'widest brightening band in the rendered plate is the floor plane',
  plate.horizon !== null && Math.abs(plate.horizon - plate.floorY) <= 1.5,
  `horizon at source row ${plate.horizonSrc} = logical y=${plate.horizon.toFixed(2)}, FLOOR_Y=${plate.floorY.toFixed(3)} (windowed jump ${plate.bestDelta.toFixed(2)})`,
)
check(
  'the bright flagstone seam is NOT the horizon',
  Math.abs(plate.maxStepSrc - plate.horizonSrc) > 20,
  `largest one-row mean jump is at source row ${plate.maxStepSrc} (the flagstone joint), horizon is ${plate.horizonSrc}`,
)
check(
  'the wall above the horizon is darker than the floor below it',
  plate.meanAbove < plate.meanAt,
  `mean luma ${plate.meanAbove.toFixed(1)} above vs ${plate.meanAt.toFixed(1)} below`,
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
]

console.log('visible feet vs. rendered floor')
for (const [action, frame, label] of frames) {
  const res = await page.evaluate(
    async ({ action, frame }) => {
      const g = window.__game
      await g.pin({ action, frame, playerX: 320, cameraX: 0 })
      return { footRow: g.footRow(), footY: g.footY(), floorY: g.GameWorld.FLOOR_Y, action: g.animations.currentAction, frame: g.animations.currentFrameIndex }
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

// --- 4. Camera translation must not move the floor -----------------------------
console.log('camera translation')
for (const cameraX of [0, 137.5, 300, 560]) {
  const res = await page.evaluate(
    async (cameraX) => {
      const g = window.__game
      await g.pin({ action: 'IDLE', frame: 0, playerX: cameraX + 320, cameraX })
      return { footRow: g.footRow(), floorY: g.GameWorld.FLOOR_Y }
    },
    cameraX,
  )
  check(
    `cameraX=${cameraX}: feet stay on the floor`,
    res.footRow !== null && Math.abs(res.footRow - res.floorY) <= 1.5,
    `feet at y=${res.footRow}, floor at ${res.floorY.toFixed(3)}`,
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
      for (const ly of [g.GameWorld.FLOOR_Y + 6, g.GameWorld.FLOOR_Y + 20, g.GameWorld.FLOOR_Y + 45]) {
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

// --- 6. Visual proof -----------------------------------------------------------
await page.evaluate(async () => {
  await window.__game.pin({ action: 'IDLE', frame: 0, playerX: 300, cameraX: 0 })
})
await page.screenshot({ path: join(shotsDir, 'floor-idle.png') })
await page.evaluate(async () => {
  await window.__game.pin({ action: 'WALK', frame: 8, playerX: 300, cameraX: 0 })
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
