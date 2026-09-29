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
    spawnX: g.GameWorld.SPAWN_X,
    arenaCenter: g.GameWorld.ARENA_CENTER_X,
    worldWidth: g.GameWorld.WORLD_WIDTH,
    logicalWidth: g.GameWorld.LOGICAL_WIDTH,
    playerWidth: g.world.player.width,
    dummyX: g.world.dummies[0].x,
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
   * The backdrop alone, drawn exactly as the game draws it: same world-space
   * camera transform, same uniform scale, drawn once at world (0, 0). Used as the
   * subtraction reference so only world objects are measured.
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
    const bg = g.world.background
    b.drawImage(bg.image, 0, 0, bg.width, bg.height, 0, 0, bg.width * g.GameWorld.BACKGROUND_SCALE, bg.height * g.GameWorld.BACKGROUND_SCALE)
    return b.getImageData(0, 0, c.width, c.height).data
  }

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

// --- 4. Camera is clamped to the world ---------------------------------------
console.log('camera clamping')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.resume()
    const out = []
    for (const dir of [1, -1, 1, -1]) {
      g.world.player.setMovementInput(dir)
      for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r))
      out.push({ dir, playerX: g.world.player.x, cameraX: g.world.cameraX })
    }
    g.world.player.setMovementInput(0)
    return out
  })
  check(
    'the camera never leaves [0, WORLD_WIDTH - LOGICAL_WIDTH]',
    res.every((r) => r.cameraX === 0),
    res.map((r) => r.cameraX).join(', '),
  )
  check(
    'the world leaves the camera no scroll range',
    (await page.evaluate(() => window.__game.GameWorld.WORLD_WIDTH - window.__game.GameWorld.LOGICAL_WIDTH)) === 0,
    '',
  )
  check(
    'the player is stopped at the world boundary, never past it',
    res.every((r) => r.playerX >= 0 && r.playerX <= 640),
    res.map((r) => r.playerX.toFixed(1)).join(', '),
  )
  check(
    'walking left reaches the left world edge',
    Math.abs(Math.min(...res.map((r) => r.playerX)) - 22) < 1e-6,
    `min ${Math.min(...res.map((r) => r.playerX)).toFixed(2)}`,
  )
  check(
    'walking right reaches the right world edge',
    Math.abs(Math.max(...res.map((r) => r.playerX)) - 618) < 1e-6,
    `max ${Math.max(...res.map((r) => r.playerX)).toFixed(2)}`,
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
    out.push({ phase: 'walked right', dummyWorldX: d.x, cameraX: g.world.cameraX, screenX: d.x - g.world.cameraX, footRow: g.dummyFootRow(d) })

    g.world.player.setMovementInput(-1)
    for (let i = 0; i < 400; i++) await new Promise((r) => requestAnimationFrame(r))
    g.world.player.setMovementInput(0)
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r))
    out.push({ phase: 'walked back', dummyWorldX: d.x, cameraX: g.world.cameraX, screenX: d.x - g.world.cameraX, footRow: g.dummyFootRow(d) })
    return out
  })

  for (const r of res) {
    check(
      `${r.phase}: dummy world X unchanged and screen position held`,
      r.dummyWorldX === GameWorld_DUMMY_X_EXPECTED && r.cameraX === 0 && r.screenX === r.dummyWorldX,
      `worldX ${r.dummyWorldX}, cameraX ${r.cameraX}, screenX ${r.screenX}`,
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
    const out = []
    // Walk right hard, then sample the dummy where it actually lands on screen.
    g.world.player.setMovementInput(1)
    for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r))
    g.world.player.setMovementInput(0)
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r))
    g.pause()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const best = g.strawRun(g.strawColumns(180, 150, 90))
    const foot = g.dummyFootRow(g.world.dummies[0])
    return {
      mid: best.mid,
      worldX: g.world.dummies[0].x,
      cameraX: g.world.cameraX,
      foot,
      floorY: g.GameWorld.FLOOR_Y,
      playerX: g.world.player.x,
    }
  })
  check(
    'dummy renders at its world X (camera pinned at 0)',
    Math.abs(res.mid - res.worldX) < 3,
    `rendered at screen x ${res.mid.toFixed(1)}, world x ${res.worldX}`,
  )
  check('the camera really is pinned at 0', res.cameraX === 0, `cameraX ${res.cameraX}`)
  check(
    'dummy feet sit on FLOOR_Y',
    res.foot !== null && Math.abs(res.foot - res.floorY) <= 1.5,
    `feet at y=${res.foot}, floor ${res.floorY.toFixed(3)}`,
  )
  check('the player did move while the dummy held its world X', res.playerX > 600, `player at ${res.playerX.toFixed(1)}`)
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
    return { before, after, delta: 150, floorY: g.GameWorld.FLOOR_Y, width: d.width, height: d.height }
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

// --- 9. Spawn at the arena centre -------------------------------------------
console.log('player spawns at the arena centre')
{
  const res = await page.evaluate(() => ({
    ...window.__spawn,
    playerScreenX: window.__spawn.playerX - window.__spawn.cameraX,
  }))
  check(
    'spawn X is the arena centre, not a screen constant',
    res.spawnX === res.arenaCenter && res.spawnX === res.logicalWidth / 2,
    `spawnX ${res.spawnX}, arena centre ${res.arenaCenter}, half width ${res.logicalWidth / 2}`,
  )
  check('player starts at the spawn X', Math.abs(res.playerX - res.spawnX) < 1e-6, `playerX ${res.playerX}`)
  check(
    'spawn leaves room to walk both ways',
    res.playerX - res.playerWidth / 2 > 100 && res.worldWidth - res.playerX - res.playerWidth / 2 > 100,
    `${(res.playerX - res.playerWidth / 2).toFixed(0)}px to the left wall, ${(res.worldWidth - res.playerX - res.playerWidth / 2).toFixed(0)}px to the right`,
  )
  check(
    'camera starts centred on the player',
    Math.abs(res.playerScreenX - res.logicalWidth / 2) < 1e-6,
    `player at screen x ${res.playerScreenX.toFixed(1)}, centre ${res.logicalWidth / 2}`,
  )
  check(
    'a dummy sits to the right of the player, inside the arena',
    res.dummyX > res.spawnX && res.dummyX < res.worldWidth,
    `dummy at world x ${res.dummyX}`,
  )
}

// --- 10. Attack button has no red ------------------------------------------
console.log('attack button carries no red circle')
{
  const res = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="button_attack"]')
    const img = btn.querySelector('img')
    const cs = getComputedStyle(btn)
    const rect = btn.getBoundingClientRect()
    const irect = img.getBoundingClientRect()

    // Icon asset must be red-free too.
    const ac = document.createElement('canvas')
    ac.width = img.naturalWidth
    ac.height = img.naturalHeight
    const ax = ac.getContext('2d')
    ax.drawImage(img, 0, 0)
    const ad = ax.getImageData(0, 0, ac.width, ac.height).data
    let iconRed = 0
    for (let i = 0; i < ad.length; i += 4) {
      if (ad[i + 3] < 16) continue
      if (ad[i] > 90 && ad[i] > ad[i + 1] * 1.5 && ad[i] > ad[i + 2] * 1.5) iconRed++
    }

    const parse = (css) => {
      const m = css.match(/[\d.]+/g)
      return m ? m.slice(0, 3).map(Number) : null
    }
    return {
      bgImage: cs.backgroundImage,
      bgColor: cs.backgroundColor,
      varColor: cs.getPropertyValue('--btn-color').trim(),
      radius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      buttonSize: [Math.round(rect.width), Math.round(rect.height)],
      iconSize: [Math.round(irect.width), Math.round(irect.height)],
      iconNatural: [img.naturalWidth, img.naturalHeight],
      iconRedPixels: iconRed,
      bgRgb: parse(cs.backgroundColor),
    }
  })

  const [br, bgc, bb] = res.bgRgb ?? [0, 0, 0]
  check('button background is not a background image', res.bgImage === 'none', res.bgImage)
  check('no red anywhere in the button fill', !(br > 90 && br > bgc * 1.5 && br > bb * 1.5), `rgb(${res.bgRgb})`)
  check('button fill is the dark slate, not red', res.varColor.toLowerCase() === '#39405a', res.varColor)
  check('attack icon asset contains no red pixels', res.iconRedPixels === 0, `${res.iconRedPixels} red pixels`)
  check(
    'sword icon is about 56x56 and keeps its square aspect',
    Math.abs(res.iconSize[0] - 56) <= 2 && Math.abs(res.iconSize[1] - 56) <= 2 && res.iconSize[0] === res.iconSize[1],
    `rendered ${res.iconSize[0]}x${res.iconSize[1]}, natural ${res.iconNatural[0]}x${res.iconNatural[1]}`,
  )
  check(
    'sword icon is centred inside the button',
    Math.abs(res.iconSize[0] - res.buttonSize[0] * 0.9) <= 2,
    `icon ${res.iconSize[0]}px in a ${res.buttonSize[0]}px button`,
  )
  check('button touch area unchanged', res.buttonSize[0] === 62 && res.buttonSize[1] === 62, `${res.buttonSize}`)
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
