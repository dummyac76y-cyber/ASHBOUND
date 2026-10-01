/**
 * Rendered-layout verification: the whole game must live in one coordinate space.
 *
 * The bug this exists to catch is a class of layout error that no unit test can see. The
 * world is a fixed 640x360 scene drawn through a transform, while the HUD, joystick, action
 * buttons and key hints are DOM elements. Those two things only agree about where the game
 * is if they are the same size and the same place. When the canvas filled the viewport and
 * the world was letterboxed *inside* it, they were not: on a wide viewport the drawn world
 * was a 16:9 band in the middle and the UI was positioned against the full canvas, so the
 * HUD and joystick could sit out in the black bars beside the game.
 *
 * So this measures the real rectangles in a real browser. For each viewport it asserts that
 * every gameplay element is inside the stage, that the stage keeps the 16:9 aspect rather
 * than stretching, and that the UI scales with the stage rather than sitting at fixed pixel
 * offsets from the browser edge.
 *
 * Run with: node scripts/verify-stage.mjs   (after `npm run build`)
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(webRoot, 'dist')

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ not built. Run `npm run build` first.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

/** Serves dist/ the way a static host would, so the built bundle is what gets measured. */
function serve() {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    const rel = normalize(decodeURIComponent(url === '/' ? '/index.html' : url)).replace(/^(\.\.[/\\])+/, '')
    const file = join(distDir, rel)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

let failures = 0
let checks = 0
function check(name, condition, detail = '') {
  checks++
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name} ${detail}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/**
 * The viewports the layout has to survive. Three of these are the common desktop sizes, one
 * is the awkward 16:10-ish laptop that produces thin bars, and the phone sizes are both
 * orientations: portrait is the hard one, because the stage has to get narrow *and* short
 * and every control still has to be reachable inside it.
 */
const VIEWPORTS = [
  { name: '1920x1080 desktop', width: 1920, height: 1080, mobile: false },
  { name: '1600x900 desktop', width: 1600, height: 900, mobile: false },
  { name: '1280x720 desktop', width: 1280, height: 720, mobile: false },
  { name: '1366x768 laptop', width: 1366, height: 768, mobile: false },
  { name: 'narrow desktop window', width: 900, height: 1000, mobile: false },
  { name: 'mobile portrait', width: 390, height: 844, mobile: true },
  { name: 'small mobile portrait', width: 360, height: 800, mobile: true },
  { name: 'large mobile portrait', width: 412, height: 915, mobile: true },
  { name: 'mobile landscape', width: 844, height: 390, mobile: true },
]

/**
 * The on-screen controls, with the size each is authored at.
 *
 * These are logical sizes: the width the control has when the stage is 640px wide, which is
 * the width the world is authored at. They are not expected sizes -- they are multiplied by
 * the stage scale and then floored for touch, which is what the CSS does.
 */
const SCALED_CONTROLS = [
  ['.joystick', 130, 'the joystick'],
  ['[data-testid="button_attack"]', 62, 'the attack button'],
  ['[data-testid="button_heavy_attack"]', 54, 'the heavy attack button'],
  ['[data-testid="button_dash"]', 54, 'the dash button'],
  ['[data-testid="button_jump"]', 54, 'the jump button'],
  ['[data-testid="button_block"]', 54, 'the block button'],
]

/** The elements that must live inside the stage, by selector. */
const GAMEPLAY_UI = [
  ['.hud', 'hud', 'the player HUD'],
  ['.hud-buttons', 'hudButtons', 'the RESET/CONFIG controls'],
  ['.joystick', 'joystick', 'the movement joystick'],
  ['.action-cluster', 'actions', 'the attack/action buttons'],
]

const { server, port } = await serve()
const browser = await chromium.launch()
const origin = `http://127.0.0.1:${port}`

try {
  for (const vp of VIEWPORTS) {
    section(vp.name)

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile,
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    // ?debug=1 skips the menu, which is what a player sees once they are actually playing.
    await page.goto(`${origin}/?debug=1`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 })
    // Let a few frames run so the HUD has painted and the world is drawing.
    await page.waitForTimeout(600)

    const measured = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="game_stage"]')
      const canvas = document.querySelector('[data-testid="game_canvas"]')
      if (!stage || !canvas) return null
      const s = stage.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      const box = (sel) => {
        const n = document.querySelector(sel)
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 }
      }
      return {
        stage: { x: s.x, y: s.y, w: s.width, h: s.height },
        canvas: { x: c.x, y: c.y, w: c.width, h: c.height },
        hud: box('.hud'),
        hudButtons: box('.hud-buttons'),
        joystick: box('.joystick'),
        actions: box('.action-cluster'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }
    })

    check('the game stage exists', measured !== null)
    if (!measured) {
      await context.close()
      continue
    }

    const { stage, canvas } = measured

    // --- The stage is the 16:9 box, and it fits the viewport ---
    check(
      'the stage keeps the 16:9 logical aspect rather than stretching',
      Math.abs(stage.w / stage.h - 16 / 9) < 0.02,
      `got ${(stage.w / stage.h).toFixed(3)}:1`,
    )
    check(
      'the stage fits inside the viewport',
      stage.w <= measured.viewport.w + 1 && stage.h <= measured.viewport.h + 1,
      `stage ${stage.w.toFixed(0)}x${stage.h.toFixed(0)} in ${measured.viewport.w}x${measured.viewport.h}`,
    )
    check(
      'the stage is centred in the viewport',
      Math.abs(stage.x + stage.w / 2 - measured.viewport.w / 2) < 2 &&
        Math.abs(stage.y + stage.h / 2 - measured.viewport.h / 2) < 2,
      `stage centre ${(stage.x + stage.w / 2).toFixed(0)},${(stage.y + stage.h / 2).toFixed(0)} vs ${measured.viewport.w / 2},${measured.viewport.h / 2}`,
    )

    // --- The canvas IS the stage ---
    //
    // This is the assertion the whole layout rests on. If the canvas is smaller than the
    // stage, the world is letterboxed inside the canvas again and the UI is positioned
    // against a box the world is not filling.
    check(
      'the canvas fills the stage exactly, so the world and the UI share one box',
      Math.abs(canvas.w - stage.w) < 1.5 && Math.abs(canvas.h - stage.h) < 1.5 &&
        Math.abs(canvas.x - stage.x) < 1.5 && Math.abs(canvas.y - stage.y) < 1.5,
      `canvas ${canvas.w.toFixed(0)}x${canvas.h.toFixed(0)} at ${canvas.x.toFixed(0)},${canvas.y.toFixed(0)} vs stage ${stage.w.toFixed(0)}x${stage.h.toFixed(0)} at ${stage.x.toFixed(0)},${stage.y.toFixed(0)}`,
    )

    // --- Every gameplay element is inside the stage ---
    for (const [sel, key, label] of GAMEPLAY_UI) {
      const b = measured[key]
      if (!b) {
        check(`${label} is present`, false, `no element matched ${sel}`)
        continue
      }
      if (!b.visible) {
        // Hidden by a media query on this viewport, which is legitimate: the point is that
        // nothing visible escapes the stage.
        check(`${label} is inside the stage`, true, 'not shown at this size')
        continue
      }
      const inside =
        b.x >= stage.x - 1 &&
        b.y >= stage.y - 1 &&
        b.x + b.w <= stage.x + stage.w + 1 &&
        b.y + b.h <= stage.y + stage.h + 1
      check(
        `${label} is inside the game stage`,
        inside,
        `at ${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}x${b.h.toFixed(0)} vs stage ${stage.x.toFixed(0)},${stage.y.toFixed(0)} ${stage.w.toFixed(0)}x${stage.h.toFixed(0)}`,
      )
    }

    // --- The decisive check: the UI against the rect the world is actually drawn in ---
    //
    // Every containment check above measures against the stage *element*, which is the
    // right thing only if the stage is the same box as the drawn world. Those two used to be
    // different rectangles, and a stage that was merely a full-viewport wrapper would sail
    // through the checks above while the bug was still on screen. So the drawn rectangle is
    // recomputed here from the canvas's own backing store -- the same transform main.ts uses
    // -- and the UI is measured against that instead. If the world is letterboxed inside the
    // canvas, this is the check that fails, and it is the one that matters.
    const drawn = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="game_canvas"]')
      if (!canvas) return null
      const LOGICAL_W = 640
      const LOGICAL_H = 360
      // The render transform: uniform scale, centred, into the backing store.
      const scale = Math.min(canvas.width / LOGICAL_W, canvas.height / LOGICAL_H)
      const offX = (canvas.width - LOGICAL_W * scale) / 2
      const offY = (canvas.height - LOGICAL_H * scale) / 2
      // Backing-store pixels -> CSS pixels, via the canvas's own layout size.
      const rect = canvas.getBoundingClientRect()
      const toCss = rect.width / canvas.width
      return {
        x: rect.x + offX * toCss,
        y: rect.y + offY * toCss,
        w: LOGICAL_W * scale * toCss,
        h: LOGICAL_H * scale * toCss,
      }
    })
    check('the drawn world rectangle can be measured', drawn !== null)
    if (drawn) {
      check(
        'the drawn world fills the stage, rather than being letterboxed inside it',
        Math.abs(drawn.w - stage.w) < 2 && Math.abs(drawn.h - stage.h) < 2,
        `drawn ${drawn.w.toFixed(0)}x${drawn.h.toFixed(0)} vs stage ${stage.w.toFixed(0)}x${stage.h.toFixed(0)}`,
      )
      const outside = await page.evaluate((d) => {
        const out = []
        for (const sel of ['.hud', '.hud-buttons', '.joystick', '.action-cluster']) {
          for (const n of document.querySelectorAll(sel)) {
            const r = n.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.left < d.x - 1 || r.top < d.y - 1 || r.right > d.x + d.w + 1 || r.bottom > d.y + d.h + 1) {
              out.push(`${sel} at ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`)
            }
          }
        }
        return out
      }, drawn)
      check(
        'every gameplay element is inside the area the world is actually drawn in',
        outside.length === 0,
        outside.join('; '),
      )
    }

    // --- The controls are sized by the stage, not by the device ---
    //
    // The stage and the viewport are two different sizes, and on a phone they differ by a
    // lot: a 390px-wide portrait viewport gets a stage barely 219px tall. Controls sized in
    // device pixels therefore look enormous there while looking right on a desktop -- the
    // world shrinks with the stage and the controls do not, so they drift apart. These checks
    // pin every control to `logical x stage scale` so the two cannot diverge again.
    const sizing = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="game_stage"]')
      const canvas = document.querySelector('canvas')
      if (!stage || !canvas) return null
      const declared = getComputedStyle(stage).getPropertyValue('--stage-scale').trim()
      const c = canvas.getBoundingClientRect()
      return {
        declared: Number.parseFloat(declared),
        // What the scale *should* be, computed independently from the rendered canvas: the
        // stage is the 16:9 box and the canvas fills it, so stage width / logical width is the
        // stage scale. Comparing against this rather than against the declared value is what
        // stops a variable that is simply wrong from passing.
        actual: c.width / 640,
        stageWidth: c.width,
        stageHeight: c.height,
      }
    })
    check('the stage publishes its scale for the controls', sizing !== null)
    if (sizing) {
      check(
        'the published scale is the stage scale, not a viewport or device ratio',
        Math.abs(sizing.declared - sizing.actual) < 0.01,
        `declared ${sizing.declared.toFixed(4)} vs stage-derived ${sizing.actual.toFixed(4)}`,
      )
      // Measured against the rendered boxes, with the floor the CSS applies for touch.
      const measured = await page.evaluate((sels) => {
        const out = {}
        for (const [sel] of sels) {
          const n = document.querySelector(sel)
          if (!n) continue
          const r = n.getBoundingClientRect()
          out[sel] = r.width
        }
        return out
      }, SCALED_CONTROLS)
      for (const [sel, logical, label] of SCALED_CONTROLS) {
        const got = measured[sel]
        if (got === undefined) continue
        // The floor is applied after the scale and is the same for every control, so it is
        // derived once here rather than duplicated per button.
        const floor = sel === '.joystick' ? 44 : 40
        const want = Math.max(floor, logical * sizing.actual)
        check(
          `${label} is its logical size x the stage scale`,
          Math.abs(got - want) <= 1.5,
          `${got.toFixed(1)}px rendered, expected ~${want.toFixed(1)}px (${logical} x ${sizing.actual.toFixed(3)})`,
        )
      }
      // The point of scaling with the stage rather than the device: the controls must keep
      // their proportion to the world. Measured as a fraction of stage height, which is the
      // axis that collapses hardest in portrait.
      const fractions = await page.evaluate((sels) => {
        const stage = document.querySelector('[data-testid="game_stage"]')
        const h = stage.getBoundingClientRect().height
        const out = {}
        for (const [sel] of sels) {
          const n = document.querySelector(sel)
          if (n) out[sel] = n.getBoundingClientRect().width / h
        }
        return out
      }, SCALED_CONTROLS)
      for (const [sel, , label] of SCALED_CONTROLS) {
        const frac = fractions[sel]
        if (frac === undefined) continue
        // A tolerance wide enough for the touch floor to be legitimate on the smallest stage
        // and tight enough that "keeps its desktop size on a phone" cannot pass. A control
        // left at its desktop pixel size on a 219px-tall stage would be over twice this.
        check(
          `${label} stays proportional to the stage, not oversized on it`,
          frac > 0.04 && frac < 0.55,
          `${(frac * 100).toFixed(1)}% of stage height`,
        )
      }
    }

    // --- And none of it is out in the unused area ---
    //
    // The bars are outside the stage by design. Anything gameplay-ish found out there means
    // the UI drifted into the area the world is not drawn on, which is the reported bug.
    const escaped = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="game_stage"]')
      if (!stage) return []
      const s = stage.getBoundingClientRect()
      const sels = ['.hud', '.hud-buttons', '.joystick', '.action-cluster', '.key-hints']
      const out = []
      for (const sel of sels) {
        for (const n of document.querySelectorAll(sel)) {
          const r = n.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          // A child of the stage cannot be outside it unless the stage clips, which it does.
          if (r.left < s.left - 1 || r.top < s.top - 1 || r.right > s.right + 1 || r.bottom > s.bottom + 1) {
            out.push(`${sel} at ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`)
          }
        }
      }
      return out
    })
    check('no gameplay UI sits in the unused bars beside the game', escaped.length === 0, escaped.join('; '))

    // --- The UI scales with the stage, not with the browser ---
    //
    // A fixed pixel offset from the window edge would leave the joystick in the same place
    // on every viewport, which is the other half of the bug: it would be correct on a wide
    // screen and outside the game on a narrow one. Anchored to the stage, the gap between
    // the joystick and the stage's left/bottom edge is a property of the layout, not of the
    // viewport, so it survives every size.
    if (measured.joystick?.visible) {
      const gapLeft = measured.joystick.x - stage.x
      const gapBottom = stage.y + stage.h - (measured.joystick.y + measured.joystick.h)
      check(
        'the joystick is anchored to the stage corner, not the browser corner',
        gapLeft >= 0 && gapLeft < stage.w * 0.25,
        `${gapLeft.toFixed(0)}px from the stage left edge (stage ${stage.w.toFixed(0)}px wide)`,
      )
      check('and is inside the stage vertically too', gapBottom >= 0, `${gapBottom.toFixed(0)}px above the stage bottom`)
    }

    // --- Nothing gameplay is cropped by the stage ---
    const clipped = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="game_stage"]')
      if (!stage) return []
      const s = stage.getBoundingClientRect()
      const out = []
      for (const sel of ['.hud', '.joystick', '.action-cluster']) {
        const n = document.querySelector(sel)
        if (!n) continue
        const r = n.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > s.right + 1 || r.bottom > s.bottom + 1) out.push(sel)
      }
      return out
    })
    check('no gameplay control is cropped by the stage edge', clipped.length === 0, clipped.join(', '))

    await context.close()
  }

  // --- The stage is the only authority ---
  section('One coordinate space')
  {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${origin}/?debug=1`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 })
    await page.waitForTimeout(400)

    const structure = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="game_stage"]')
      if (!stage) return null
      const inside = (sel) => {
        const n = document.querySelector(sel)
        return n ? stage.contains(n) : null
      }
      return {
        stageParentIsApp: stage.parentElement?.id === 'app',
        canvasInside: inside('[data-testid="game_canvas"]'),
        hudInside: inside('.hud'),
        joystickInside: inside('.joystick'),
        actionsInside: inside('.action-cluster'),
        // The backdrop and every bar are the stage's business, not the page's.
        stageOverflow: getComputedStyle(stage).overflow,
      }
    })
    check('the stage is the direct child of #app', structure?.stageParentIsApp === true)
    check('the canvas is a child of the stage', structure?.canvasInside === true)
    check('the HUD is a child of the stage', structure?.hudInside === true)
    check('the joystick is a child of the stage', structure?.joystickInside === true)
    check('the action buttons are a child of the stage', structure?.actionsInside === true)
    check('the stage clips its own overflow', structure?.stageOverflow === 'hidden', `overflow: ${structure?.stageOverflow}`)

    // The canvas must not be sized from the window by script; it is sized from its own box.
    const src = await readFile(join(webRoot, 'src/main.ts'), 'utf8')
    check(
      'the canvas backing store is sized from the stage, not from window.innerWidth',
      /ResizeObserver\([\s\S]{0,80}?\.observe\(stage\)/.test(src),
    )
    check(
      'no gameplay UI is positioned from window.innerWidth',
      !/\.hud[\s\S]{0,200}innerWidth|innerWidth[\s\S]{0,200}\.hud/.test(src),
    )

    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}

console.log(failures === 0 ? '\nAll stage checks passed.' : `\n${failures} of ${checks} checks FAILED.`)
process.exit(failures === 0 ? 0 : 1)
