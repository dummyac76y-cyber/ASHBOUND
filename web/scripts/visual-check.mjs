import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import http from 'node:http'
import fs from 'node:fs'

const WEB = '/workspace/2594426d-bb11-4f70-be2b-49e2a6d55731/sessions/agent_f42c5e42-cdce-44c4-9af2-5b2f0fd490cf/web'
const DIST = path.join(WEB, 'dist')
const SCRATCH = '/workspace/2594426d-bb11-4f70-be2b-49e2a6d55731/sessions/agent_f42c5e42-cdce-44c4-9af2-5b2f0fd490cf/.scratch'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  const file = path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('nope')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://127.0.0.1:${port}/?debug=1`)
await page.waitForFunction(() => !!window.__game)
await page.waitForTimeout(500)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

// Mirrors the logical->device helpers and the foot-row probe from verify-floor.mjs.
await page.evaluate(() => {
  const g = window.__game
  const canvas = document.querySelector('canvas.game-canvas')
  g.scale = () => Math.min(canvas.width / g.GameWorld.LOGICAL_WIDTH, canvas.height / g.GameWorld.LOGICAL_HEIGHT)
  g.offX = () => (canvas.width - g.GameWorld.LOGICAL_WIDTH * g.scale()) / 2
  g.offY = () => (canvas.height - g.GameWorld.LOGICAL_HEIGHT * g.scale()) / 2
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
    b.translate(-g.world.cameraX, g.world.cameraY)
    g.world.renderCharacter(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    const half = g.GameWorld.SPRITE_DISPLAY_SIZE / 2
    const lx = g.world.player.x
    const x0 = Math.round(g.offX() + (lx - half - 4) * s)
    const x1 = Math.round(g.offX() + (lx + half + 4) * s)
    for (let ly = g.GameWorld.LOGICAL_HEIGHT - 1; ly >= 0; ly--) {
      const y = Math.round(g.offY() + ly * s)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= c.width || y < 0 || y >= c.height) continue
        if (d[(y * c.width + x) * 4 + 3] >= minAlpha) return ly
      }
    }
    return null
  }
})

// --- Both dummies are present, in world space, and on the floor ---------------
console.log('both dummies are world fixtures on the floor')
{
  const res = await page.evaluate(() => {
    const g = window.__game
    g.pause()
    return g.world.dummies.map((d) => ({
      x: d.x,
      groundY: d.groundY,
      hp: d.hp,
      maxHp: d.maxHp,
      top: d.hitbox.top,
      bottom: d.hitbox.bottom,
      floorY: g.world.floorY,
    }))
  })
  check('two dummies exist', res.length === 2, `${res.length}`)
  res.forEach((d, i) => {
    check(`dummy ${i} sits at its world X`, d.x === (i === 0 ? 450 : 570), `worldX ${d.x}`)
    check(`dummy ${i} hitbox bottom is FLOOR_Y`, Math.abs(d.bottom - d.floorY) < 1e-6, `${d.bottom}`)
    check(`dummy ${i} has a live HP bar`, d.hp === d.maxHp && d.maxHp > 0, `hp ${d.hp}/${d.maxHp}`)
  })
  check('dummies are evenly spaced by 120', res[1].x - res[0].x === 120, `gap ${res[1].x - res[0].x}`)
}

// --- Feet land on FLOOR_Y at both world boundaries ---------------------------
console.log('feet stay on the floor at both boundaries')
{
  for (const [label, dir, edge] of [
    ['left', -1, 22],
    ['right', 1, 618],
  ]) {
    const res = await page.evaluate(async (dir) => {
      const g = window.__game
      g.resume()
      g.world.player.setMovementInput(dir)
      for (let i = 0; i < 500; i++) await new Promise((r) => requestAnimationFrame(r))
      g.world.player.setMovementInput(0)
      for (let i = 0; i < 90; i++) await new Promise((r) => requestAnimationFrame(r))
      return { x: g.world.player.x, footRow: g.footRow() }
    }, dir)
    check(
      `player pinned at the ${label} boundary (x=${edge})`,
      Math.abs(res.x - edge) < 0.01,
      `x ${res.x}`,
    )
    check(
      `player feet on FLOOR_Y at the ${label} boundary`,
      res.footRow !== null && Math.abs(res.footRow - 222.083) <= 1.5,
      `feet y ${res.footRow}`,
    )
  }
}

// --- The backdrop is one unmirrored, untiled plate ----------------------------
console.log('the backdrop is drawn once, unmirrored, untiled')
{
  // All sampling happens in the page: the live game canvas and the reference
  // plate are real <canvas>/<img> objects and cannot cross the evaluate boundary.
  //
  // The live canvas is device-scaled with smoothing, so its pixels can never equal
  // raw source samples. The reference is therefore the source plate drawn through
  // the *same* transform the game uses; the live frame must match that reference
  // and must not match a mirrored or horizontally offset copy of it.
  const res = await page.evaluate(() => {
    const g = window.__game
    const canvas = document.querySelector('canvas.game-canvas')
    const ctx = canvas.getContext('2d')

    // Freeze at the spawn frame so the dummies and player are stationary.
    g.resume()
    g.setFrame('idle', 0)
    g.world.player.x = g.world.activeScene.definition.spawnX
    g.world.cameraX = 0
    g.pause()

    const lw = canvas.width
    const lh = canvas.height
    const liveData = ctx.getImageData(0, 0, lw, lh).data

    const bg = new Image()
    return new Promise((resolve, reject) => {
      bg.onload = () => {
        try {
        // The active scene's own plate and fit: each environment is scaled to fill
        // on its own terms, so there is no single shared scale to read here.
        const scene = g.world.activeScene
        const SW = scene.definition.sourceWidth
        const SH = scene.definition.sourceHeight
        const fit = scene.fit

        // Renders the plate into a lw x lh surface using the exact transform the
        // game applies: device scale, letterbox offset, camera translate at 0.
        const renderRef = (pre) => {
          const c = document.createElement('canvas')
          c.width = lw
          c.height = lh
          const b = c.getContext('2d')
          // Matches the game, which sets imageSmoothingEnabled = false.
          b.imageSmoothingEnabled = false
          b.fillStyle = '#0c0e14'
          b.fillRect(0, 0, lw, lh)
          b.setTransform(1, 0, 0, 1, 0, 0)
          b.translate(g.offX(), g.offY())
          b.scale(g.scale(), g.scale())
          b.translate(-g.world.cameraX, g.world.cameraY)
          if (pre) pre(b)
          // The game's own single-backdrop draw: one uniform scale, no flip, cropped
          // by the scene's fit.
          b.drawImage(bg, 0, 0, SW, SH, fit.offsetX, fit.offsetY, fit.drawWidth, fit.drawHeight)
          // The boundary pillars the game also paints, so the reference matches the
          // live frame everywhere rather than only over open wall.
          b.fillStyle = 'rgb(50, 55, 70)'
          b.fillRect(0, 0, 24, g.world.floorY)
          b.fillRect(g.world.worldWidth - 24, 0, g.world.worldWidth, g.world.floorY)
          return b.getImageData(0, 0, lw, lh).data
        }

        const refData = renderRef(null)
        // A horizontally mirrored copy of the same reference.
        const mirrorData = renderRef((b) => {
          b.translate(fit.offsetX + fit.drawWidth, 0)
          b.scale(-1, 1)
        })

        // The backdrop's logical footprint, in device pixels.
        const bgDeviceW = fit.drawWidth * g.scale()
        const bgDeviceH = fit.drawHeight * g.scale()

        // Number of vertical sample columns used for the comparison.
        const bands = 18

        // A wall band well above every entity, so nothing can occlude the plate.
        const ly = Math.floor(lh * 0.12)
        const at = (data, x, y) => {
          const i = (y * lw + x) * 4
          return [data[i], data[i + 1], data[i + 2]]
        }
        const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

        // Live vs identity reference, per column band. Both metrics use the same
        // units (a mean) so the shift search below is directly comparable.
        const bandXs = []
        for (let b = 0; b < bands; b++) bandXs.push(Math.floor((lw * (b + 0.5)) / bands))

        const meanDiffVs = (data) => {
          let total = 0
          for (const x of bandXs) total += maxDiff(at(liveData, x, ly), at(data, x, ly))
          return total / bandXs.length
        }
        const meanDirect = meanDiffVs(refData)
        const meanMirror = meanDiffVs(mirrorData)

        // A tiled/duplicated backdrop would make the live frame match the reference
        // at some shifted x instead of at the same x. Search for the best shift.
        let bestShift = Infinity
        for (let shift = -lw / 2; shift <= lw / 2; shift += 2) {
          let total = 0
          for (const x of bandXs) {
            const rx = Math.round(x + shift)
            if (rx < 0 || rx >= lw) {
              total += 255
              continue
            }
            total += maxDiff(at(liveData, x, ly), at(refData, rx, ly))
          }
          const mean = total / bandXs.length
          if (mean < bestShift) bestShift = mean
        }

        // Coverage: every edge pixel must be backdrop, not the letterbox clear colour.
        const CLEAR = [12, 14, 20]
        const edgePoints = [
          [0, 0],
          [lw - 1, 0],
          [0, lh - 1],
          [lw - 1, lh - 1],
          [Math.floor(lw / 2), 0],
          [Math.floor(lw / 2), lh - 1],
        ]
        let worstEdgeClear = 0
        for (const [x, y] of edgePoints) {
          worstEdgeClear = Math.max(worstEdgeClear, maxDiff(at(liveData, x, y), CLEAR))
        }

        resolve({
          meanDirect,
          meanMirror,
          bestShift,
          worstEdgeClear,
          bands,
          sw: SW,
          sh: SH,
          bgDeviceW,
          bgDeviceH,
          lw,
          lh,
          scale: g.scale(),
        })
        } catch (err) {
          reject(err)
        }
      }
      bg.onerror = () => reject(new Error('backdrop image failed to load'))
      bg.src = '/bg/arena_bg.png'
    })
  })

  check('backdrop source is 1536x864', res.sw === 1536 && res.sh === 864, `${res.sw}x${res.sh}`)

  check(
    'every column band matches the identically-scaled plate',
    res.meanDirect === 0,
    `mean channel diff ${res.meanDirect} across ${res.bands} bands; canvas ${res.lw}x${res.lh}, scale ${res.scale}`,
  )
  check(
    'no band is a mirror of the plate',
    res.meanMirror > 0,
    `mean mirrored diff ${res.meanMirror}`,
  )
  check(
    'no horizontal shift matches better than identity (no tiling or duplication)',
    res.bestShift >= res.meanDirect,
    `best shifted match ${res.bestShift} vs identity ${res.meanDirect}`,
  )
  check(
    'the one backdrop covers the viewport exactly, with no gap or overhang',
    Math.abs(res.bgDeviceW - res.lw) <= 1 && Math.abs(res.bgDeviceH - res.lh) <= 1,
    `backdrop ${res.bgDeviceW.toFixed(1)}x${res.bgDeviceH.toFixed(1)} vs viewport ${res.lw}x${res.lh}`,
  )
  check(
    'backdrop edges are artwork, not the letterbox clear colour',
    res.worstEdgeClear > 0,
    `worst edge-vs-clear diff ${res.worstEdgeClear}`,
  )
}

// --- Screenshots for the record ---------------------------------------------
await page.evaluate(() => {
  window.__game.resume()
  const g = window.__game
  g.world.player.setMovementInput(0)
})
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(SCRATCH, 'visual-spawn.png') })
await page.evaluate(() => window.__game.pause())
await page.screenshot({ path: path.join(SCRATCH, 'visual-dummies.png') })

await browser.close()
server.close()

console.log(failures === 0 ? '\nAll visual checks passed.' : `\n${failures} visual check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
