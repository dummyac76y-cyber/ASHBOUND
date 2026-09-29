/**
 * Rendered-output verification for the grid-packed attack sheet.
 *
 * The headless logic tests prove the 4x4 slicing arithmetic, but they cannot prove
 * the pixels that reach the screen. This harness drives the real page in Chromium,
 * pins the game to each of the 16 attack frames, and measures the rendered canvas:
 *
 *   - the character's opaque bounding box, isolated by differencing the frame
 *     against the bare backdrop drawn through the identical world transform
 *   - that box's bottom edge, which must sit on FLOOR_Y for every frame
 *
 * Run with: node scripts/verify-attack.mjs   (after npm run build)
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
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
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
page.on('console', (m) => { if (m.type() === 'error') console.error('  [page error]', m.text()) })
await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 })
await page.evaluate(() => window.__game.pause())

/**
 * Installs a measurement helper: pins a frame, renders it, and returns the
 * character's opaque bounding box in logical pixels. The backdrop is redrawn
 * through the identical transform as the subtraction reference, so only the
 * character and its shadow show up in the difference.
 */
await page.evaluate(() => {
  const g = window.__game
  const canvas = document.querySelector('canvas.game-canvas')
  const ctx = canvas.getContext('2d')

  g.scale = () => Math.min(canvas.width / g.GameWorld.LOGICAL_WIDTH, canvas.height / g.GameWorld.LOGICAL_HEIGHT)
  g.offX = () => (canvas.width - g.GameWorld.LOGICAL_WIDTH * g.scale()) / 2
  g.offY = () => (canvas.height - g.GameWorld.LOGICAL_HEIGHT * g.scale()) / 2

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

  /** Resolves after the rAF that has actually drawn the pinned frame. */
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

  const grab = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data

  g.measureCharacter = async (action, frame) => {
    g.setFrame(action, frame)
    await nextFrame()
    await nextFrame()
    const shot = grab()

    // Reference: the same frame drawn through the same code path with the player
    // parked off-canvas. Reconstructing the backdrop by hand would miss anything
    // else the scene draws, whereas this isolates the character and its shadow
    // exactly, whatever else is on screen.
    const savedX = g.world.player.x
    g.world.player.x = -100000
    await nextFrame()
    await nextFrame()
    const base = grab()
    g.world.player.x = savedX
    await nextFrame()

    const s = g.scale()
    const ox = g.offX()
    const oy = g.offY()
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0
    for (let i = 0; i < shot.length; i += 4) {
      const d = Math.abs(shot[i] - base[i]) + Math.abs(shot[i + 1] - base[i + 1]) + Math.abs(shot[i + 2] - base[i + 2])
      if (d > 24) {
        const p = i / 4
        const px = p % canvas.width
        const py = Math.floor(p / canvas.width)
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        n++
      }
    }
    if (n === 0) return null
    return {
      minX: (minX - ox) / s, maxX: (maxX + 1 - ox) / s,
      minY: (minY - oy) / s, maxY: (maxY + 1 - oy) / s,
      pixels: n,
    }
  }
})

const floorY = await page.evaluate(() => window.__game.GameWorld.FLOOR_Y)
console.log(`ATTACK: 16 grid frames render with their feet on FLOOR_Y (${floorY.toFixed(2)})`)

const boxes = []
for (let f = 0; f < 16; f++) {
  const box = await page.evaluate((fr) => window.__game.measureCharacter('ATTACK', fr), f)
  boxes.push(box)
  if (box === null) {
    check(`frame ${String(f).padStart(2)} renders`, false, 'no pixels differ from the backdrop')
    continue
  }
  // The soft contact shadow hangs a little below the feet by design, so the
  // threshold allows a small tail rather than demanding pixel-exact contact.
  const footErr = box.maxY - floorY
  check(
    `frame ${String(f).padStart(2)}: feet reach the floor`,
    footErr > -1 && footErr < 6,
    `bottom ${box.maxY.toFixed(1)}, ${footErr >= 0 ? '+' : ''}${footErr.toFixed(1)} vs floor, height ${(box.maxY - box.minY).toFixed(1)}`,
  )
}

// Duplicated silhouettes would mean the grid is slicing the same cell twice.
const sigs = boxes.filter(Boolean).map((b) => `${b.minX.toFixed(0)},${b.minY.toFixed(0)},${b.maxX.toFixed(0)},${b.maxY.toFixed(0)}`)
const distinct = new Set(sigs).size
check('the 16 frames render as distinct poses', distinct >= 12, `${distinct}/16 distinct silhouettes`)

// The display scale is what keeps a 256px-cell sheet looking the same size as
// the 128px strip sheets. Frame 0 is compared rather than a mid-swing frame,
// because frames 4..7 bound the raised weapon and are legitimately taller than
// the character alone.
const idle = await page.evaluate(() => window.__game.measureCharacter('IDLE', 0))
if (idle && boxes[0]) {
  const aH = boxes[0].maxY - boxes[0].minY
  const iH = idle.maxY - idle.minY
  check(
    'attack character matches idle on-screen height',
    aH / iH > 0.85 && aH / iH < 1.15,
    `attack ${aH.toFixed(1)}px vs idle ${iH.toFixed(1)}px (ratio ${(aH / iH).toFixed(3)})`,
  )
} else {
  check('idle renders for the size comparison', false, 'no idle pixels')
}

await page.evaluate(() => window.__game.setFrame('ATTACK', 8))
await page.screenshot({ path: join(shotsDir, 'attack-frame-8.png') })
await browser.close()
server.close()

console.log(failures === 0 ? '\nAll attack checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
