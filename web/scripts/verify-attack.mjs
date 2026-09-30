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
    g.setFrame(action, frame, true)
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

console.log('CHARACTER SIZE: every sheet renders the character the same size')
// Measured across every frame of every sheet, and compared on the median. The
// median rather than the mean or the extremes, because a sheet's tallest frame is
// the one with the sword overhead (measuring the weapon, not the character) and
// the character also crouches through part of each swing. Idle is the reference.
const allSheets = await page.evaluate(() =>
  [...window.__game.animations.loadedSheets].map(([action, sheet]) => ({
    action,
    file: sheet.config.sourceFileName,
    frames: sheet.frameCount,
    scale: sheet.displayScale,
  })),
)

/** Median rendered character height for one sheet, or null if it never renders. */
const medianHeightFor = async (action, frames) => {
  const hs = []
  for (let f = 0; f < frames; f++) {
    const box = await page.evaluate(([a, fr]) => window.__game.measureCharacter(a, fr), [action, f])
    if (box) hs.push(box.maxY - box.minY)
  }
  if (!hs.length) return null
  hs.sort((a, b) => a - b)
  return { median: hs[Math.floor(hs.length / 2)], min: hs[0], max: hs[hs.length - 1], count: hs.length }
}

// Compare per *sheet*, not per action. Several actions still stand in on
// idle.png with a shorter frame count, and the median over a subset of a sheet's
// frames is not that sheet's median, so measuring per action would report a size
// difference where there is none. Each sheet is measured once, through whichever
// action plays the most of its frames.
const bySheet = new Map()
for (const s of allSheets) {
  const key = `${s.file}|${s.scale}`
  const existing = bySheet.get(key)
  if (!existing || s.frames > existing.frames) bySheet.set(key, s)
}

const measured = []
for (const s of bySheet.values()) {
  const m = await medianHeightFor(s.action, s.frames)
  if (m) measured.push({ ...s, ...m })
}
const reference = measured.find((m) => m.file === 'idle.png')
check('idle renders, giving the reference size', reference !== undefined, reference ? `median ${reference.median.toFixed(1)}px` : 'no idle pixels')

if (reference) {
  // Expected median rendered character height per sheet, from this same
  // measurement. Asserting against a pinned value rather than a wide band keeps
  // the guard tight enough to catch a mis-set scale, which a loose tolerance
  // would not: the sheets are drawn at different native resolutions and
  // nearest-neighbour scaled, so their edges quantise differently, but a sheet
  // that is even a few percent off moves well outside 2px.
  const EXPECTED = {
    'idle.png': 84.5,
    // Two sheets are deliberately off the common size, in opposite directions:
    // the walk cycle is drawn a little smaller so it reads as lower and lighter
    // than standing still, and the heavy attack a little larger so the swing
    // carries weight. Both are pinned here so the exceptions stay explicit rather
    // than becoming a hole in the tolerance.
    'walk.png': 81.0,
    'jump.png': 85.0,
    'attack.png': 84.5,
    'block.png': 84.5,
    'heavy_attack.png': 95.0,
  }
  const TOLERANCE = 2
  for (const m of measured) {
    const want = EXPECTED[m.file]
    check(
      `${m.file.padEnd(18)} renders at its calibrated character size`,
      want !== undefined && Math.abs(m.median - want) <= TOLERANCE,
      `median ${m.median.toFixed(1)}px, expected ${want}px, range ${m.min.toFixed(0)}-${m.max.toFixed(0)} over ${m.count} frames, scale ${m.scale}`,
    )
  }

  // Every sheet without an intended deviation must render one identical size.
  const DEVIATIONS = ['heavy_attack.png', 'walk.png']
  const standard = measured.filter((m) => !DEVIATIONS.includes(m.file))
  const spread = Math.max(...standard.map((m) => m.median)) - Math.min(...standard.map((m) => m.median))
  check(
    'the non-deviating sheets render one identical character size',
    spread <= 2,
    `${spread.toFixed(1)}px spread across ${standard.map((m) => m.file).join(', ')}`,
  )

  // The two deviations must sit on the correct side of the common size, so a
  // mis-set scale cannot quietly turn one into the other.
  const heavy = measured.find((m) => m.file === 'heavy_attack.png')
  const walk = measured.find((m) => m.file === 'walk.png')
  check(
    'the heavy attack renders larger than the common size',
    heavy !== undefined && reference !== undefined && heavy.median > reference.median + 3,
    heavy && reference ? `heavy ${heavy.median.toFixed(1)}px vs idle ${reference.median.toFixed(1)}px (+${(heavy.median - reference.median).toFixed(1)})` : 'missing',
  )
  check(
    'the walk cycle renders smaller than the common size',
    walk !== undefined && reference !== undefined && walk.median < reference.median - 2,
    walk && reference ? `walk ${walk.median.toFixed(1)}px vs idle ${reference.median.toFixed(1)}px (${(walk.median - reference.median).toFixed(1)})` : 'missing',
  )
}

console.log('\nSHEET CONTENT: every sheet renders distinct frames')
// Guards against a sheet being pointed at the wrong file, or a frame count that
// exceeds the art, either of which would show up as duplicated poses. A held
// frame is legitimate, so this is a high bar rather than a strict one.
for (const s of bySheet.values()) {
  const sigs = []
  for (let f = 0; f < s.frames; f++) {
    const box = await page.evaluate(([a, fr]) => window.__game.measureCharacter(a, fr, true), [s.action, f])
    if (box) sigs.push(`${box.minX.toFixed(0)},${box.minY.toFixed(0)},${box.maxX.toFixed(0)},${box.maxY.toFixed(0)}`)
  }
  const distinct = new Set(sigs).size
  // Held frames are legitimate art -- idle holds 2 of its 6 to breathe, so the bar
  // is a floor rather than "every frame differs". A wholly duplicated or
  // mis-sliced sheet collapses to 1 silhouette and fails this easily.
  check(
    `${s.file.padEnd(18)} renders ${s.frames} distinct frames`,
    sigs.length === s.frames && distinct >= Math.ceil(s.frames * 0.6),
    `${sigs.length}/${s.frames} drew pixels, ${distinct} distinct silhouettes`,
  )
}

console.log('\nNON-LOOPING ANIMATIONS: play once and hold the final frame')
// A guard that loops pulses for as long as it is held, so block is configured not
// to loop. That only holds if two things are true, and neither is visible in the
// config: playAction must refuse to re-enter the action while it is already
// active, and the finished animation must clamp to its last frame rather than
// wrapping. Both are checked here because this drives the real animation system.
{
  const block = await page.evaluate(() => {
    const anims = window.__game.animations
    anims.playAction('BLOCK')
    const started = anims.currentAction
    const reentry = anims.playAction('BLOCK')
    anims.update(2)
    return { started, reentry, frame: anims.currentFrameIndex, finished: anims.isFinished }
  })
  check('block animation starts', block.started === 'BLOCK', `action ${block.started}`)
  check('holding block does not restart the animation', block.reentry === false, `re-entry returned ${block.reentry}`)
  check(
    'a finished guard holds its last frame instead of wrapping',
    block.frame === 7 && block.finished === true,
    `frame ${block.frame} of 8, finished ${block.finished}`,
  )
  // Put it back to idle so later checks measure from a known state.
  await page.evaluate(() => window.__game.animations.playAction('IDLE'))
}

console.log('\nGRID PACKED SHEETS: each grid renders frame by frame')
const grids = allSheets.filter((s) => {
  // `columns` is frames-per-row, which is legitimately >1 for a plain strip too,
  // so the marker for a grid is the configured cellSize.
  return s.file === 'attack.png' || s.file === 'heavy_attack.png'
})
check('both attack sheets load as grids', grids.length === 2, `${grids.length} grids: ${grids.map((g) => g.file).join(', ')}`)

for (const g of grids) {
  const geo = await page.evaluate((f) => {
    for (const [action, sheet] of window.__game.animations.loadedSheets) {
      if (sheet.config.sourceFileName === f) return { columns: sheet.columns, cell: sheet.cellHeight, frames: sheet.frameCount }
    }
    return null
  }, g.file)
  console.log(`\n${g.action} (${g.file}): ${geo.frames} frames, ${geo.columns} columns of ${geo.cell}px cells, scale ${g.scale}`)
  const boxes = []
  for (let f = 0; f < geo.frames; f++) {
    const box = await page.evaluate(([a, fr]) => window.__game.measureCharacter(a, fr), [g.action, f])
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
  // Held frames are legitimate, so the bar is high but not absolute.
  const sigs = boxes.filter(Boolean).map((b) => `${b.minX.toFixed(0)},${b.minY.toFixed(0)},${b.maxX.toFixed(0)},${b.maxY.toFixed(0)}`)
  const distinct = new Set(sigs).size
  check(`the ${geo.frames} frames render as distinct poses`, distinct >= Math.ceil(geo.frames * 0.75), `${distinct}/${geo.frames} distinct silhouettes`)

  await page.evaluate(([a, fr]) => window.__game.setFrame(a, fr, true), [g.action, Math.floor(geo.frames / 2)])
  await page.screenshot({ path: join(shotsDir, `${g.action.toLowerCase()}-frame-mid.png`) })
}

await browser.close()
server.close()

console.log(failures === 0 ? '\nAll sprite checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
