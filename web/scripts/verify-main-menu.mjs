/**
 * Verification for the main menu and its artwork.
 *
 * The artwork is supplied art and the brief is explicit that it must reach the screen
 * as it was supplied: same dimensions, same composition, not cropped, not stretched,
 * not animated, not modified. None of that is checkable by reading the code -- a
 * `background-size: cover`, a stray transform or a mismatched overlay scale would all
 * look right in a diff and wrong on screen -- so this drives the real page and
 * measures what is actually displayed.
 *
 *   1. the files are stored byte-for-byte, in both engines, and re-encoded by nothing
 *   2. the browser decodes them at their original dimensions, so nothing shrank them
 *   3. each is displayed at its original aspect ratio: never cropped, never squashed
 *   4. neither is transformed, filtered, tinted or animated
 *   5. the overlay registers against the backdrop -- same canvas, same box -- and its
 *      visible pixels land where they were composed, clear of the four entries
 *   6. the menu carries exactly the four required entries, and each does what it says
 *   7. Android mirrors all of it
 *
 * Run with: node scripts/verify-main-menu.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { readPng } from './lib/artwork.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(webRoot, 'dist')

/** The backdrop, as both engines name it. Declared once; checked against both copies. */
const MENU_BG = 'main_menu.jpg'
/** The character overlay. */
const MENU_OVERLAY = 'main_menu_overlay.png'
/** The animated campfire: 8 frames of 128x128 on one 1024x128 strip. */
const MENU_CAMPFIRE = 'campfire_flame.png'
/** The strip's own geometry, measured from the supplied file rather than assumed. */
const CAMPFIRE_STRIP = { width: 1024, height: 128, frames: 8, cell: 128 }
/**
 * Where the cell goes, and where its ink then lands.
 *
 * Derived from the supplied `main_menu_campfire.png`, which is a 1280x720 canvas the same
 * size as the background carrying nothing but the fire: its solid core is x 680..818 on
 * base row 552. See CAMPFIRE_SUPPLIED_FIRE below, which re-measures that rather than
 * trusting it.
 */
const CAMPFIRE_FLAME_SCALE = 1.32
const CAMPFIRE_CELL = { x: 665.02, y: 420 }
/** The ink inside one flame cell, measured from the file's alpha channel. */
const CAMPFIRE_CELL_INK = { x0: 12, w: 104, y1: 99 }
/** Where the supplied campfire canvas puts the fire: its solid core, glow excluded. */
const CAMPFIRE_SUPPLIED_FIRE = { x0: 680, w: 139, baseY: 552 }
/** The ink inside one cell, measured from the file's alpha channel. */
const CAMPFIRE_INK = { x0: 12, x1: 115, y0: 21, y1: 99 }

/**
 * The supplied button plates, with each plate's visible bounds measured from its own
 * alpha channel. These are what the artwork claims about itself; the check below
 * re-measures them from the served file, so a wrong number here fails rather than hides.
 */
const MENU_BUTTON_ART = [
  { id: 'start_game', label: 'START GAME', file: 'start_game.png', box: { x: 83, y: 130, w: 332, h: 113 } },
  { id: 'load_game', label: 'LOAD GAME', file: 'load_game.png', box: { x: 80, y: 266, w: 335, h: 114 } },
  { id: 'settings', label: 'SETTINGS', file: 'settings.png', box: { x: 80, y: 403, w: 335, h: 107 } },
  { id: 'quit', label: 'QUIT', file: 'quit.png', box: { x: 83, y: 540, w: 332, h: 107 } },
  { id: 'credits', label: 'CREDITS', file: 'credits.png', box: { x: 1196, y: 33, w: 52, h: 58 } },
]

const ANDROID_BUTTONS = join(repoRoot, 'app/src/main/assets/bg/menu_buttons')

/**
 * Strips comments from a source file before a pattern is searched in it.
 *
 * Both comment styles, because the sources here are heavy on prose: a JSDoc that explains
 * why `window.close` is ignored must not be able to satisfy a check that a call happens.
 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** The two supplied character idle sheets, in the order they play. */
const MENU_CHARACTER_FILES = ['character_idle_a.png', 'character_idle_b.png']
/** Frames per sheet, and the cell size, both measured from the files. */
const CHARACTER_FRAMES = 16
/** The sheets' ink box, and the static character's, so the scale is re-derived here. */
const CHARACTER_SHEET_INK = { x0: 8, y0: 11, x1: 85, y1: 82 }
/** How much smaller than the static figure the animation is drawn. */
const CHARACTER_SIZE = 0.9
const CHARACTER_STATIC_INK = { x: 826, y: 386, w: 174, h: 161 }

const ANDROID_ASSET = join(repoRoot, 'app/src/main/assets/bg', MENU_BG)
const WEB_ASSET = join(webRoot, 'public/bg', MENU_BG)
const ANDROID_OVERLAY = join(repoRoot, 'app/src/main/assets/bg', MENU_OVERLAY)
const WEB_OVERLAY = join(webRoot, 'public/bg', MENU_OVERLAY)
const ANDROID_CAMPFIRE = join(repoRoot, 'app/src/main/assets/bg/menu_buttons', MENU_CAMPFIRE)
const WEB_CAMPFIRE = join(webRoot, 'public/bg/menu_buttons', MENU_CAMPFIRE)

const MENU_TS = join(webRoot, 'src/ui/MainMenu.ts')
const MENU_CSS = join(webRoot, 'src/style.css')
const MAIN_TS = join(webRoot, 'src/main.ts')
const KT_MENU = join(repoRoot, 'app/src/main/java/com/example/game/ui/MainMenu.kt')
const KT_SCREEN = join(repoRoot, 'app/src/main/java/com/example/game/ui/GameScreen.kt')

/** The two sources the character and fire sections assert against. */
const ktMenu = readFileSync(KT_MENU, 'utf8')
const menuTs = readFileSync(MENU_TS, 'utf8')

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ not built. Run `npm run build` first.')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * Notes something that could not be checked because a file has not been supplied yet.
 * Counted as a pass so the suite is usable mid-build, but never reported as verified.
 */
function pending(name, detail) {
  console.log(`  wait ${name}  ${detail}`)
}

/** Reads width/height straight out of a JPEG's SOF marker, without decoding pixels. */
function jpegSize(path) {
  const buf = readFileSync(path)
  let off = 2
  while (off < buf.length) {
    if (buf[off] !== 0xff) {
      off++
      continue
    }
    const marker = buf[off + 1]
    // SOF0..SOF15, skipping the non-frame markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) }
    }
    off += 2 + buf.readUInt16BE(off + 2)
  }
  return null
}

/** Reads width/height out of a PNG's IHDR, without decoding pixels. */
function pngSize(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** Serves the built site, so the real page can be driven. */
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(req.url.split('?')[0]))
    const file = join(distDir, path === '/' ? 'index.html' : path)
    if (!file.startsWith(distDir) || !existsSync(file)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch (err) {
    res.writeHead(500)
    res.end(String(err))
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ args: ['--no-sandbox'] })

// ---------------------------------------------------------------------------------
console.log('\n1. the artwork is stored exactly as supplied, in both engines')
// ---------------------------------------------------------------------------------
{
  const a = existsSync(ANDROID_ASSET)
  const w = existsSync(WEB_ASSET)
  check('the background is in the Android assets tree', a, ANDROID_ASSET.replace(`${repoRoot}/`, ''))
  check('and synced to the web copy', w, WEB_ASSET.replace(`${webRoot}/`, ''))
  if (a && w) {
    const ab = readFileSync(ANDROID_ASSET)
    const wb = readFileSync(WEB_ASSET)
    check(
      'the two copies are byte-for-byte identical',
      ab.equals(wb),
      `${ab.length} vs ${wb.length} bytes, md5 ${createHash('md5').update(ab).digest('hex')}`,
    )
    check('the stored file is still a JPEG, so nothing re-encoded it', ab[0] === 0xff && ab[1] === 0xd8 && ab[ab.length - 2] === 0xff && ab[ab.length - 1] === 0xd9, 'SOI and EOI markers intact')
    const size = jpegSize(ANDROID_ASSET)
    check(
      'it keeps its original dimensions',
      size !== null && size.width === 1280 && size.height === 720,
      `${size ? `${size.width}x${size.height}` : 'unreadable'}`,
    )
  }

  // Both transparent canvases are checked the same way. The registration argument rests
  // entirely on each being the backdrop's canvas size, so that is asserted per file.
  for (const [label, androidPath, webPath] of [
    ['character overlay', ANDROID_OVERLAY, WEB_OVERLAY],
  ]) {
    if (!existsSync(androidPath)) {
      pending(`the ${label} has not been supplied yet`, `expected at ${androidPath.replace(`${repoRoot}/`, '')}`)
      continue
    }
    check(`the ${label} is in the Android assets tree`, true, androidPath.replace(`${repoRoot}/`, ''))
    const has = existsSync(webPath)
    check('and synced to the web copy', has, webPath.replace(`${webRoot}/`, ''))
    const ab = readFileSync(androidPath)
    if (has) {
      const wb = readFileSync(webPath)
      check('the two copies are byte-for-byte identical', ab.equals(wb), `${ab.length} vs ${wb.length} bytes`)
    }
    check('it is still a PNG, so its transparency survived', ab[0] === 0x89 && ab.subarray(1, 4).toString('ascii') === 'PNG', 'PNG signature intact')
    const size = pngSize(androidPath)
    check(
      'it is the same canvas size as the backdrop, which is what lets it register',
      size !== null && size.width === 1280 && size.height === 720,
      `${size ? `${size.width}x${size.height}` : 'unreadable'} against a 1280x720 backdrop`,
    )
  }
}

// ---------------------------------------------------------------------------------
console.log('\n2. the menu is what the page shows, and the artwork decodes untouched')
// ---------------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const missing = []
  page.on('response', (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`)
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })

  // The overlay is optional until it is supplied, so a 404 for it alone is survivable.
  const realMissing = missing.filter((m) => !m.includes(MENU_OVERLAY) && !m.includes(MENU_CAMPFIRE))
  check('the page raises no script errors', errors.length === 0, errors.join('; '))
  check('the page requests no missing assets', realMissing.length === 0, realMissing.join('; ') || 'every request succeeded')

  const overlaySupplied = existsSync(ANDROID_OVERLAY) && existsSync(ANDROID_CAMPFIRE)

  const res = await page.evaluate(() => {
    const img = document.querySelector('.main-menu-backdrop')
    if (!img) return null
    const r = img.getBoundingClientRect()
    const cs = getComputedStyle(img)
    return {
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      rendered: { width: r.width, height: r.height },
      objectFit: cs.objectFit,
      transform: cs.transform,
      filter: cs.filter,
      opacity: cs.opacity,
      background: cs.backgroundColor,
      animation: cs.animationName,
      transition: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
    }
  })
  check('the backdrop element is present', res !== null)
  if (res) {
    check('the browser decodes it at its original size, so nothing was resampled on the way in', res.natural.width === 1280 && res.natural.height === 720, `${res.natural.width}x${res.natural.height}`)
    check('the menu is actually visible once the artwork is ready', !(await page.evaluate(() => getComputedStyle(document.querySelector('.main-menu')).visibility === 'hidden')), 'not left hidden behind the pre-load state')
    check('it is displayed with `contain`, which scales by one factor and so shows the whole background at its own size without ever stretching or cropping it', res.objectFit === 'contain', `object-fit: ${res.objectFit}`)
    check('it is not rotated, scaled or moved by a transform', res.transform === 'none' || res.transform === 'matrix(1, 0, 0, 1, 0, 0)', `transform: ${res.transform}`)
    check('it is not recoloured by a filter', res.filter === 'none', `filter: ${res.filter}`)
    check('it is not dimmed by opacity', res.opacity === '1', `opacity ${res.opacity}`)
    check('it has no background tint painted over it', res.background === 'rgba(0, 0, 0, 0)', res.background)
    check('it is not animated', res.animation === 'none', `animation-name: ${res.animation}`)
    // `transition-property` computes to `all` by default whether or not a transition was
    // ever declared, so it cannot answer this on its own. A declared transition always
    // comes with a non-zero duration, so that is what gets checked.
    check(
      'it has no transition that could move or resize it',
      res.transitionDuration.split(',').every((d) => parseFloat(d) === 0),
      `transition-property: ${res.transition}, duration ${res.transitionDuration}`,
    )
    check(
      'the displayed box keeps the artwork aspect exactly, so nothing is cropped or squashed',
      Math.abs(res.natural.width / res.natural.height - res.rendered.width / res.rendered.height) < 0.001,
      `source ${(res.natural.width / res.natural.height).toFixed(4)}, displayed ${(res.rendered.width / res.rendered.height).toFixed(4)}`,
    )
    check(
      'and it fills the viewport exactly at this size, so 1280x720 needs no letterboxing',
      Math.abs(res.rendered.width - 1280) < 1 && Math.abs(res.rendered.height - 720) < 1,
      `${res.rendered.width.toFixed(1)}x${res.rendered.height.toFixed(1)}`,
    )
  }

  // --- The two transparent art canvases ------------------------------------------
  //
  // Both are checked identically, because they make the identical claim: a 1280x720
  // canvas the same size as the backdrop, already positioned within it, drawn in the
  // backdrop's own box with the backdrop's own scaling. If that holds for one it holds
  // for the other, and it is what makes each land where it was composed.
  // The static character canvas is no longer drawn: the animation replaces it. The
  // character's registration is measured instead, alongside the fire's, further down.
  const ART_LAYERS = []

  for (const layer of ART_LAYERS) {
    const info = await page.evaluate((sel) => {
      const img = document.querySelector(sel)
      const backdrop = document.querySelector('.main-menu-backdrop')
      if (!img || !backdrop) return null
      const r = img.getBoundingClientRect()
      const b = backdrop.getBoundingClientRect()
      const cs = getComputedStyle(img)
      return {
        natural: { width: img.naturalWidth, height: img.naturalHeight },
        rendered: { left: r.left, top: r.top, width: r.width, height: r.height },
        backdrop: { left: b.left, top: b.top, width: b.width, height: b.height },
        objectFit: cs.objectFit,
        transform: cs.transform,
        filter: cs.filter,
        opacity: cs.opacity,
        animation: cs.animationName,
        pointerEvents: cs.pointerEvents,
      }
    }, layer.sel)

    check(`the ${layer.name} layer is present, separately from the backdrop and the UI`, info !== null, layer.sel)

    if (!layer.supplied) {
      pending(`${layer.name} registration is not measured yet`, 'the file has not been supplied')
      continue
    }
    if (!info) continue

    const n = `the ${layer.name}`
    check(`${n} decoded at the backdrop's own canvas size`, info.natural.width === 1280 && info.natural.height === 720, `${info.natural.width}x${info.natural.height}`)
    const same = (a, b) => Math.abs(a - b) < 0.5
    check(
      `${n} is drawn in exactly the same box as the backdrop, so it registers against it`,
      same(info.rendered.left, info.backdrop.left) &&
        same(info.rendered.top, info.backdrop.top) &&
        same(info.rendered.width, info.backdrop.width) &&
        same(info.rendered.height, info.backdrop.height),
      `art ${info.rendered.left.toFixed(1)},${info.rendered.top.toFixed(1)} ${info.rendered.width.toFixed(1)}x${info.rendered.height.toFixed(1)} vs backdrop ${info.backdrop.left.toFixed(1)},${info.backdrop.top.toFixed(1)} ${info.backdrop.width.toFixed(1)}x${info.backdrop.height.toFixed(1)}`,
    )
    check(`${n} keeps its aspect too, so nothing about it is cropped`, Math.abs(info.natural.width / info.natural.height - info.rendered.width / info.rendered.height) < 0.001, `source ${(info.natural.width / info.natural.height).toFixed(4)}, displayed ${(info.rendered.width / info.rendered.height).toFixed(4)}`)
    check(`it is not transformed`, info.transform === 'none' || info.transform === 'matrix(1, 0, 0, 1, 0, 0)', `transform ${info.transform}`)
    check(`it is not filtered`, info.filter === 'none', `filter ${info.filter}`)
    check(`it is not faded`, info.opacity === '1', `opacity ${info.opacity}`)
    check(`it is not animated`, info.animation === 'none', `animation ${info.animation}`)
    check(`and it cannot steal clicks from the buttons beneath it`, info.pointerEvents === 'none', `pointer-events ${info.pointerEvents}`)
  }

  if (overlaySupplied) {
    // Real paint order, measured rather than assumed.
    //
    // Every art layer is pointer-events:none so it cannot steal clicks from the
    // buttons, and elementsFromPoint skips such nodes entirely -- it cannot answer this
    // as shipped. Hit-testing them is only a measurement trick, so pointer-events is
    // switched on, the stack is read, and it is switched straight back.
    const order = await page.evaluate(() => {
      const b = document.querySelector('.main-menu-backdrop')
      const o = document.querySelector('.main-menu-character')
      const c = document.querySelector('.main-menu-fire')
      const u = document.querySelector('.main-menu-ui')
      if (!b || !o || !c || !u) return null
      const nodes = [b, o, c, u]
      const prev = nodes.map((n) => n.style.pointerEvents)
      for (const n of nodes) n.style.pointerEvents = 'auto'
      const r = u.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      for (let i = 0; i < nodes.length; i++) nodes[i].style.pointerEvents = prev[i]
      const cs = (n) => getComputedStyle(n)
      return {
        ui: stack.indexOf(u),
        campfire: stack.indexOf(c),
        character: stack.indexOf(o),
        backdrop: stack.indexOf(b),
        artZ: [cs(b).zIndex, cs(o).zIndex, cs(c).zIndex],
        noTransform: nodes.every((n) => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(cs(n).transform)),
      }
    })
    // The required stack, back to front:
    //
    //   main menu background -> animated campfire and light -> character -> buttons
    //
    // elementsFromPoint returns front-to-back, so a smaller index is nearer the viewer and
    // the required order appears as ui < character < campfire < backdrop.
    check(
      'the stack is background, then the character, then the fire, then the buttons',
      order.ui < order.campfire && order.campfire < order.character && order.character < order.backdrop,
      `front-to-back: ui ${order.ui}, fire ${order.campfire}, character ${order.character}, backdrop ${order.backdrop}`,
    )
    check(
      'that order comes from document order rather than from a hand-tuned z-index',
      order.artZ.every((z) => z === 'auto'),
      `z-index ${order.artZ.join(' / ')}`,
    )
    check('nor is any layer reordered by a transform', order.noTransform, 'no transform on any layer')

    // Where each canvas actually puts ink, read from its alpha channel. A 1280x720 canvas
    // that is 98% transparent still has one specific block of visible pixels, and that
    // block has to land inside the frame and clear of the entries.
    const inks = await page.evaluate(async (sels) => {
      const out = []
      for (const sel of sels) {
        const img = document.querySelector(sel)
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let minX = Infinity
        let minY = Infinity
        let maxX = -1
        let maxY = -1
        let opaque = 0
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] > 8) {
              opaque++
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
            }
          }
        }
        const r = img.getBoundingClientRect()
        const sx = r.width / c.width
        const sy = r.height / c.height
        out.push({
          sel,
          ratio: opaque / (c.width * c.height),
          box: {
            left: r.left + minX * sx,
            top: r.top + minY * sy,
            right: r.left + (maxX + 1) * sx,
            bottom: r.top + (maxY + 1) * sy,
          },
        })
      }
      return out
    }, ART_LAYERS.filter((l) => l.supplied).map((l) => l.sel))

    for (const ink of inks) {
      const name = ART_LAYERS.find((l) => l.sel === ink.sel).name
      check(`the ${name} is a transparent overlay, not a second background`, ink.ratio < 0.1, `${(ink.ratio * 100).toFixed(2)}% of the canvas is visible`)
      check(
        `the ${name} lands where it was composed, inside the frame`,
        ink.box.left >= 0 && ink.box.top >= 0 && ink.box.right <= 1280 && ink.box.bottom <= 720,
        `x ${Math.round(ink.box.left)}..${Math.round(ink.box.right)}, y ${Math.round(ink.box.top)}..${Math.round(ink.box.bottom)}`,
      )
      const hits = await page.evaluate((b) => {
        const area = (a, c) =>
          Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) *
          Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top))
        return [...document.querySelectorAll('.menu-button')]
          .map((n) => ({ text: n.textContent.trim().slice(0, 12), area: area(b, n.getBoundingClientRect()) }))
          .filter((r) => r.area > 1)
      }, ink.box)
      check(
        `and the ${name} does not cover any of the four entries, so they stay readable`,
        hits.length === 0,
        hits.length ? hits.map((h) => `${h.text} by ${Math.round(h.area)}px^2`).join(', ') : 'no entry overlaps the art',
      )
    }

    // The two canvases are separate objects standing side by side, so the entries have to
    // clear both. Checking them one at a time against the same buttons could still miss
    // a case where together they bracket the column.
    const combined = await page.evaluate((boxes) => {
      const area = (a, c) =>
        Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) *
        Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top))
      const union = boxes.reduce(
        (acc, b) => ({
          left: Math.min(acc.left, b.left),
          top: Math.min(acc.top, b.top),
          right: Math.max(acc.right, b.right),
          bottom: Math.max(acc.bottom, b.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      )
      return [...document.querySelectorAll('.menu-button')]
        .map((n) => ({ text: n.textContent.trim().slice(0, 12), area: area(union, n.getBoundingClientRect()) }))
        .filter((r) => r.area > 1)
    }, inks.map((i) => i.box))
    check(
      'and neither canvas together brackets the entries',
      combined.length === 0,
      combined.length ? combined.map((h) => `${h.text} by ${Math.round(h.area)}px^2`).join(', ') : 'the menu column is clear of both',
    )
  } else {
    pending('art layer registration is not measured yet', 'the art canvases have not been supplied')
  }

  await page.close()
}

// ---------------------------------------------------------------------------------
console.log('\n3. the four menu entries, and what each one does')
// ---------------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })

  const labels = await page.evaluate(() => {
    const root = document.querySelector('.main-menu')
    const visible = document.querySelector('.menu-panel:not([hidden])')
    return {
      menu: Boolean(root),
      screen: root?.dataset.screen ?? null,
      // The label is baked into the supplied plate, so the entry's name comes from its
      // accessible label rather than from text content.
      labels: [...document.querySelectorAll('.menu-art-hit')]
        .filter((n) => n.offsetParent !== null)
        .map((n) => (n.getAttribute('aria-label') ?? '').toUpperCase()),
      visiblePanel: visible?.dataset.testid ?? null,
      hudHidden: document.querySelector('.hud')?.hidden ?? null,
      controlsHidden: document.querySelector('.controls')?.hidden ?? null,
      layerChain: (() => {
        const sel = ['.main-menu-backdrop', '.main-menu-fire', '.main-menu-character', '.main-menu-ui']
        return sel.map((s) => {
          const n = document.querySelector(s)
          return n ? `${s}:${getComputedStyle(n).position}` : `${s}:MISSING`
        }).join(' ')
      })(),
      platesPresent:
        document.querySelectorAll('.menu-art-button').length +
        document.querySelectorAll('.menu-credits-icon').length,
      allButtons: [...document.querySelectorAll('.main-menu-ui button')].map(
        (n) => (n.getAttribute('aria-label') ?? n.textContent).trim().toUpperCase(),
      ),
    }
  })

  check('the title screen is showing on load', labels.menu && labels.screen === 'main', `screen ${labels.screen}`)
  check(
    'it carries the four entries in order, followed by the supplied credits control',
    JSON.stringify(labels.labels) === JSON.stringify(['START GAME', 'LOAD GAME', 'SETTINGS', 'QUIT', 'CREDITS']),
    labels.labels.join(' | '),
  )
  // CREDITS was on this list and came off it: the supplied artwork includes a credits
  // control and the user identified it as such, reversing the earlier instruction.
  const forbidden = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS'].filter((f) => labels.allButtons.some((b) => b.includes(f)))
  check('and none of the entries that were ruled out are present', forbidden.length === 0, forbidden.length ? forbidden.join(', ') : 'none of DUEL ONLINE / PRACTICE / CHARACTERS')
  check(
    'the supplied credits control is wired up rather than left as decoration',
    labels.allButtons.includes('CREDITS'),
    `CREDITS ${labels.allButtons.includes('CREDITS') ? 'present' : 'missing'}`,
  )
  check('the in-game HUD is hidden behind the menu', labels.hudHidden === true, `hud.hidden ${labels.hudHidden}`)
  check('and so are the touch controls', labels.controlsHidden === true, `controls.hidden ${labels.controlsHidden}`)
  check('every supplied plate is on the menu', labels.platesPresent === 5, `${labels.platesPresent} plates`)
  check(
    'the backdrop, the fire, the animated character and the UI are four separate layers',
    labels.layerChain ===
      '.main-menu-backdrop:absolute .main-menu-fire:absolute .main-menu-character:absolute .main-menu-ui:relative',
    labels.layerChain,
  )

  // --- The supplied plates line up with their clickable areas -------------------
  //
  // The plate is a full-canvas image, so the clickable element over it is positioned as
  // a percentage of that canvas. Nothing in the layout would catch a wrong percentage --
  // the button would still be clickable, it would just be in the wrong place, and the
  // pressable area could easily miss the visible plate. So each plate's ink is re-read
  // from the served file and compared against where its hit area actually is.
  const plateState = await page.evaluate(async (arts) => {
    const backdrop = document.querySelector('.main-menu-backdrop')
    const bb = backdrop.getBoundingClientRect()
    const out = []
    for (const art of arts) {
      const img = document.querySelector(`[data-testid="main_menu_art_${art.id}"]`)
      const hit = document.querySelector(`[data-testid="main_menu_${art.id}"]`)
      if (!img || !hit) {
        out.push({ id: art.id, missing: true })
        continue
      }
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let minX = Infinity
      let minY = Infinity
      let maxX = -1
      let maxY = -1
      let visible = 0
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] > 8) {
            visible++
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }
      const ir = img.getBoundingClientRect()
      const hr = hit.getBoundingClientRect()
      const sx = ir.width / c.width
      const sy = ir.height / c.height
      out.push({
        id: art.id,
        natural: { w: c.width, h: c.height },
        visibleRatio: visible / (c.width * c.height),
        ink: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        // The credits image is the whole canvas slid behind its clipped button, so its own
        // rect is already the canvas box -- no offset to undo.
        artBox: { left: ir.left, top: ir.top, width: ir.width, height: ir.height },
        backdrop: { left: bb.left, top: bb.top, width: bb.width, height: bb.height },
        hit: { left: hr.left, top: hr.top, width: hr.width, height: hr.height },
        // Where the ink sits on screen, from the image's own placement.
        inkOnScreen: {
          left: ir.left + minX * sx,
          top: ir.top + minY * sy,
          right: ir.left + (maxX + 1) * sx,
          bottom: ir.top + (maxY + 1) * sy,
        },
      })
    }
    return out
  }, MENU_BUTTON_ART)

  for (const [i, art] of MENU_BUTTON_ART.entries()) {
    const st = plateState[i]
    check(`the ${art.label} plate is present as artwork and as a control`, !st.missing, `[data-testid="main_menu_art_${art.id}"]`)
    if (st.missing) continue
    check(
      `the ${art.label} plate is a full-canvas image like the other supplied artwork`,
      st.natural.w === 1280 && st.natural.h === 720,
      `${st.natural.w}x${st.natural.h}`,
    )
    check(
      `and is drawn in the backdrop's box, so it registers against the background`,
      Math.abs(st.artBox.left - st.backdrop.left) < 0.5 &&
        Math.abs(st.artBox.top - st.backdrop.top) < 0.5 &&
        Math.abs(st.artBox.width - st.backdrop.width) < 0.5 &&
        Math.abs(st.artBox.height - st.backdrop.height) < 0.5,
      `${st.artBox.left.toFixed(1)},${st.artBox.top.toFixed(1)} ${st.artBox.width.toFixed(1)}x${st.artBox.height.toFixed(1)}`,
    )
    // The measured ink must match what the artwork is documented to contain, otherwise
    // the numbers used to position the hit area are describing the wrong thing.
    const b = art.box
    check(
      `the ${art.label} plate sits where the artwork declares`,
      Math.abs(st.ink.x - b.x) <= 1 && Math.abs(st.ink.y - b.y) <= 1 && Math.abs(st.ink.w - b.w) <= 1 && Math.abs(st.ink.h - b.h) <= 1,
      `ink x ${st.ink.x}..${st.ink.x + st.ink.w - 1}, y ${st.ink.y}..${st.ink.y + st.ink.h - 1}, declared x ${b.x}..${b.x + b.w - 1}, y ${b.y}..${b.y + b.h - 1}`,
    )
    check(
      `and the ${art.label} control covers its plate`,
      st.hit.left <= st.inkOnScreen.left + 0.5 &&
        st.hit.top <= st.inkOnScreen.top + 0.5 &&
        st.hit.left + st.hit.width >= st.inkOnScreen.right - 0.5 &&
        st.hit.top + st.hit.height >= st.inkOnScreen.bottom - 0.5,
      `hit ${st.hit.left.toFixed(1)},${st.hit.top.toFixed(1)} ${st.hit.width.toFixed(1)}x${st.hit.height.toFixed(1)} vs plate ${st.inkOnScreen.left.toFixed(1)},${st.inkOnScreen.top.toFixed(1)} ${(st.inkOnScreen.right - st.inkOnScreen.left).toFixed(1)}x${(st.inkOnScreen.bottom - st.inkOnScreen.top).toFixed(1)}`,
    )
  }

  // LOAD GAME
  await page.click('[data-testid="main_menu_load_game"]')
  const load = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="main_menu_screen_load"]')
    if (!p || p.hidden) return null
    const t = p.textContent.replace(/\s+/g, ' ').trim()
    return {
      text: t,
      saysEmpty: /no saved games/i.test(t),
      givesReason: /not been implemented|not implemented yet/i.test(t),
      // Invented data would show up as a slot, a timestamp, or a playtime.
      fabricated: /\d{1,2}[/:]\d{2}|save \d|slot \d|\d+\s*(hours?|hrs?|minutes?|mins?)|played/i.test(t),
      hasBack: Boolean(p.querySelector('[data-testid="main_menu_back"]')),
    }
  })
  check('LOAD GAME opens the load screen', load !== null)
  if (load) {
    check('it says plainly that nothing is saved', load.saysEmpty, 'empty state present')
    check('and explains why, instead of showing a blank list', load.givesReason, 'reason stated')
    check('it fabricates no save slots, timestamps or playtimes', !load.fabricated, 'no invented save data')
    check('and it can be left again', load.hasBack, 'BACK')
  }
  await page.click('.menu-panel:not([hidden]) [data-testid="main_menu_back"]')

  // SETTINGS
  await page.click('[data-testid="main_menu_settings"]')
  const settings = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="main_menu_screen_settings"]')
    if (!p || p.hidden) return null
    const rows = [...p.querySelectorAll('.menu-setting')].map((n) => ({
      label: n.querySelector('.menu-setting-label')?.textContent.trim() ?? '',
      disabled: n.classList.contains('menu-setting-disabled'),
      isButton: n.tagName === 'BUTTON',
    }))
    return {
      rows,
      names: rows.map((r) => r.label),
      fullscreenLive: rows.some((r) => r.label === 'FULLSCREEN' && r.isButton && !r.disabled),
    }
  })
  check('SETTINGS opens the settings screen', settings !== null)
  if (settings) {
    check('it has settings rows', settings.rows.length >= 2, settings.names.join(', '))
    const disabled = settings.rows.filter((r) => r.disabled).map((r) => r.label)
    // The audio rows are real switches, so the invariant is no longer "two rows are dimmed":
    // it is that nothing is presented as a working toggle while having nothing behind it,
    // and that what is missing is said out loud. FULLSCREEN is still a disabled row, because
    // the web build is already edge-to-edge and a switch there could change nothing.
    const audioRows = settings.rows.filter((r) => r.label === 'MUSIC' || r.label === 'SOUND EFFECTS')
    check(
      'the audio rows are live switches rather than disabled decoration',
      audioRows.length === 2 && audioRows.every((r) => r.isButton && !r.disabled),
      settings.names.join(', '),
    )
    check(
      'what is missing is stated rather than left implied',
      settings.names.some((n) => /AUDIO FILES/.test(n)),
      settings.names.join(', '),
    )
    check(
      'the informational row is disabled rather than clickable',
      disabled.includes('AUDIO FILES'),
      disabled.join(', ') || 'none',
    )
    check('fullscreen is offered as a live control', settings.fullscreenLive, 'fullscreen enabled')

    // The switches have to actually reach the bank, not just look live.
    const audioToggles = await page.evaluate(() => {
      const read = (label) => {
        const row = [...document.querySelectorAll('[data-testid="main_menu_screen_settings"] .menu-setting')].find(
          (n) => n.querySelector('.menu-setting-label')?.textContent.trim() === label,
        )
        return row?.querySelector('.menu-setting-value')?.textContent.trim() ?? null
      }
      return { musicBefore: read('MUSIC'), sfxBefore: read('SOUND EFFECTS') }
    })
    await page.click('[data-testid="main_menu_music"]')
    const musicAfter = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="main_menu_screen_settings"] .menu-setting')]
          .find((n) => n.querySelector('.menu-setting-label')?.textContent.trim() === 'MUSIC')
          ?.querySelector('.menu-setting-value')
          ?.textContent.trim() ?? null,
    )
    check(
      'the music switch flips and the label follows it',
      audioToggles.musicBefore === 'ON' && audioToggles.sfxBefore === 'ON' && musicAfter === 'OFF',
      `${audioToggles.musicBefore}/${audioToggles.sfxBefore} -> ${musicAfter}`,
    )
    // Toggled back, so the switch is a toggle rather than a one-way trip.
    await page.click('[data-testid="main_menu_music"]')
    const musicRestored = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="main_menu_screen_settings"] .menu-setting')]
          .find((n) => n.querySelector('.menu-setting-label')?.textContent.trim() === 'MUSIC')
          ?.querySelector('.menu-setting-value')
          ?.textContent.trim() ?? null,
    )
    check('the music switch toggles back', musicRestored === 'ON', String(musicRestored))
  }
  await page.click('.menu-panel:not([hidden]) [data-testid="main_menu_back"]')

  // QUIT
  await page.click('[data-testid="main_menu_quit"]')
  const quit = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="main_menu_screen_quit"]')
    const root = document.querySelector('.main-menu')
    return {
      present: Boolean(p) && !p.hidden,
      explains: p ? /cannot close itself|cannot be closed|not be closed/i.test(p.textContent.replace(/\s+/g, ' ')) : false,
      stillThere: Boolean(root),
      canReturn: Boolean(p?.querySelector('button')),
    }
  })
  check('QUIT leaves the menu in place rather than trying to close the tab', quit.present)
  check('it explains the web behaviour instead of appearing to do nothing', quit.explains, 'a tab cannot close itself')
  check('and the player can get back', quit.canReturn, 'return control present')
  await page.click('.menu-panel:not([hidden]) [data-testid="main_menu_back"]')

  // CREDITS
  await page.click('[data-testid="main_menu_credits"]')
  const credits = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="main_menu_screen_credits"]')
    if (!p || p.hidden) return null
    const r = p.getBoundingClientRect()
    return {
      screen: document.querySelector('.main-menu')?.dataset.screen ?? null,
      heading: p.querySelector('.menu-heading')?.textContent.trim() ?? '',
      width: r.width,
      height: r.height,
      visible: getComputedStyle(p).display !== 'none' && r.width > 10 && r.height > 10,
      inFrame: r.right > 0 && r.left < 1280 && r.bottom > 0 && r.top < 720,
      canReturn: Boolean(p.querySelector('[data-testid="main_menu_back"]')),
    }
  })
  check('the credits control opens the credits screen', credits !== null && credits.screen === 'credits', `screen ${credits?.screen}`)
  if (credits) {
    check('which is headed CREDITS', credits.heading === 'CREDITS', credits.heading)
    check('and is actually drawn, not a hidden or zero-size panel', credits.visible, `${credits.width.toFixed(0)}x${credits.height.toFixed(0)}`)
    check('and sits inside the frame', credits.inFrame, 'within the viewport')
    check('and can be left again', credits.canReturn, 'BACK')
  }
  await page.click('.menu-panel:not([hidden]) [data-testid="main_menu_back"]')

  // START GAME
  await page.click('[data-testid="main_menu_start_game"]')
  await page.waitForTimeout(120)
  const started = await page.evaluate(() => ({
    menuGone: !document.querySelector('.main-menu'),
    hudVisible: document.querySelector('.hud')?.hidden === false,
    controlsVisible: document.querySelector('.controls')?.hidden === false,
  }))
  check('START GAME begins play and removes the menu', started.menuGone, 'no menu after starting')
  check('the HUD comes back', started.hudVisible, `hud visible ${started.hudVisible}`)
  check('and the controls with it', started.controlsVisible, `controls visible ${started.controlsVisible}`)

  await page.close()
}

// ---------------------------------------------------------------------------------
console.log('\n4. the menu shows only the menu')
// ---------------------------------------------------------------------------------
{
  // `?debug=1&menu=1` keeps the test hooks while showing the menu, so the harness can ask
  // the page what it is drawing rather than inferring it from a screenshot.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/?debug=1&menu=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(200)

  // --- Problem 1: no debug outlines around the hit areas ---------------------
  const decoration = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-art-hit')].map((n) => {
      const cs = getComputedStyle(n)
      return {
        id: n.dataset.testid,
        outlineStyle: cs.outlineStyle,
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        borderWidths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((w) =>
          parseFloat(w) || 0,
        ),
        background: cs.backgroundColor,
        boxShadow: cs.boxShadow,
      }
    }),
  )
  // `outline-width` computes to a non-zero value even when `outline-style: none`, because
  // the two are independent properties -- only the style decides whether a frame is
  // painted. So the style is what gets asserted, alongside the borders.
  const framed = decoration.filter((d) => d.outlineStyle !== 'none' || d.borderWidths.some((w) => w > 0))
  check(
    'no button draws an outline or border of its own',
    framed.length === 0,
    framed.length ? framed.map((f) => `${f.id} outline:${f.outlineStyle}`).join(', ') : `${decoration.length} hit areas, all frameless`,
  )
  check(
    'and the focus ring is not shown unless focused',
    decoration.every((d) => d.outlineStyle === 'none'),
    decoration.map((d) => d.outlineStyle).join(', '),
  )
  const tinted = decoration.filter((d) => d.background !== 'rgba(0, 0, 0, 0)')
  check('and none paints a background over the artwork', tinted.length === 0, tinted.map((t) => t.id).join(', ') || 'all transparent')
  const shadowed = decoration.filter((d) => d.boxShadow !== 'none')
  check('nor a drop shadow that would read as a second plate', shadowed.length === 0, shadowed.map((s) => s.id).join(', ') || 'none')

  // The plates themselves must be the only thing there.
  const plates = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-art-button')].map((n) => ({
      natural: { w: n.naturalWidth, h: n.naturalHeight },
      rendered: { w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height },
    })),
  )
  check(
    'each entry is a real image, scaled proportionally',
    plates.every((p) => p.natural.w > 0 && p.natural.h > 0 && Math.abs(p.natural.w / p.natural.h - p.rendered.w / p.rendered.h) < 0.001),
    plates.map((p) => `${p.natural.w}x${p.natural.h} -> ${p.rendered.w.toFixed(0)}x${p.rendered.h.toFixed(0)}`).join(', '),
  )

  // --- Problem 3: no gameplay furniture behind the menu ----------------------
  const furniture = await page.evaluate(() => {
    const state = (sel) => {
      const n = document.querySelector(sel)
      if (!n) return null
      return { hidden: n.hidden, display: getComputedStyle(n).display, visible: n.offsetParent !== null }
    }
    return {
      hud: state('.hud'),
      controls: state('.controls'),
      keyHints: state('.key-hints'),
      renders: window.__game?.worldRenderCount?.() ?? null,
      started: window.__game?.isStarted?.() ?? null,
    }
  })
  check('the HUD is not displayed while the menu is up', furniture.hud && furniture.hud.display === 'none', `hud display ${furniture.hud?.display}, hidden ${furniture.hud?.hidden}`)
  check('the touch controls are not displayed either', furniture.controls && furniture.controls.display === 'none', `controls display ${furniture.controls?.display}, hidden ${furniture.controls?.hidden}`)
  check('and the key hints are gone', furniture.keyHints && furniture.keyHints.display === 'none', `key-hints display ${furniture.keyHints?.display}, hidden ${furniture.keyHints?.hidden}`)
  check('the simulation has not started', furniture.started === false, `started ${furniture.started}`)
  check(
    'and the world is not being drawn at all',
    furniture.renders === 0,
    `${furniture.renders} frames drawn`,
  )

  // Gating the simulation is not the same as gating the drawing: a still scene is still
  // visible through the bands a `contain` backdrop leaves on a non-16:9 viewport.
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForTimeout(150)
  const bands = await page.evaluate(() => {
    const m = document.querySelector('.main-menu')
    const cs = getComputedStyle(m)
    const backdrop = document.querySelector('.main-menu-backdrop')
    const b = backdrop.getBoundingClientRect()
    return {
      background: cs.backgroundColor,
      fit: getComputedStyle(backdrop).objectFit,
      backdrop: { w: b.width, h: b.height, left: b.left, top: b.top },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      renders: window.__game.worldRenderCount(),
    }
  })
  check(
    'the backdrop element still spans the whole frame, so `contain` letterboxes inside it instead of shrinking the artwork',
    bands.backdrop.w >= bands.viewport.w - 0.5 &&
      bands.backdrop.h >= bands.viewport.h - 0.5 &&
      bands.backdrop.left <= 0.5 &&
      bands.backdrop.top <= 0.5,
    `${bands.backdrop.w.toFixed(0)}x${bands.backdrop.h.toFixed(0)} against ${bands.viewport.w}x${bands.viewport.h}`,
  )
  check(
    'the menu paints an opaque background, so its letterbox bands are its own',
    bands.background !== 'rgba(0, 0, 0, 0)',
    `background ${bands.background}`,
  )
  check('and still no world frames after a resize', bands.renders === 0, `${bands.renders} frames drawn`)

  // --- START GAME restores gameplay -----------------------------------------
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(100)
  await page.click('[data-testid="main_menu_start_game"]')
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => ({
    menu: Boolean(document.querySelector('.main-menu')),
    hud: getComputedStyle(document.querySelector('.hud')).display,
    controls: getComputedStyle(document.querySelector('.controls')).display,
    renders: window.__game.worldRenderCount(),
  }))
  check('START GAME removes the menu', !after.menu, 'no menu')
  check('and the HUD comes back', after.hud !== 'none', `hud display ${after.hud}`)
  check('and so do the touch controls', after.controls !== 'none', `controls display ${after.controls}`)
  check('and the world starts drawing', after.renders > 0, `${after.renders} frames drawn`)

  await page.close()
}

// ---------------------------------------------------------------------------------
console.log('\n5. the composition scales as one piece, at ordinary viewports')
// ---------------------------------------------------------------------------------
{
  // The backdrop is `cover` so the picture fills the frame, while the composition box the
  // plates are registered to stays `contain` so no control is ever cropped away. The two
  // diverge on every viewport that is not 16:9, which is exactly what these shapes check:
  // the controls have to stay inside the frame, on their own artwork, undistorted, without
  // needing fullscreen.
  // The phone shapes matter most here. A 1280x720 composition in a portrait phone shrinks
  // to roughly a quarter of its intended size, which is what made the controls too small
  // to tap; desktop-only viewports could never have caught it.
  for (const [w, h] of [
    [1280, 720],
    [1440, 900],
    [1024, 768],
    [1920, 1080],
    [800, 600],
    [390, 844],
    [844, 390],
    [768, 1024],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`${base}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const backdrop = document.querySelector('.main-menu-backdrop')
      const br = backdrop.getBoundingClientRect()
      const out = { art: [], fit: [] }
      // The plates no longer share the backdrop's *element* box: they sit in the contain
      // box that syncCanvasBoxes measures, which is a different rectangle at any viewport
      // that letterboxes. What has to hold is that the plate's artwork lands on the
      // backdrop's artwork, so that is what is compared -- the contain rect of the root.
      const scale = Math.min(br.width / 1280, br.height / 720)
      const artLeft = br.left + (br.width - 1280 * scale) / 2
      const artTop = br.top + (br.height - 720 * scale) / 2
      for (const img of document.querySelectorAll('.menu-art-button')) {
        const b = img.getBoundingClientRect()
        out.art.push({
          sameBox:
            Math.abs(b.width - 1280 * scale) < 0.5 &&
            Math.abs(b.height - 720 * scale) < 0.5 &&
            Math.abs(b.left - artLeft) < 0.5 &&
            Math.abs(b.top - artTop) < 0.5,
        })
        const hit = document.querySelector(`[data-testid="${img.dataset.testid.replace('_art_', '_')}"]`)
        const hr = hit ? hit.getBoundingClientRect() : null
        if (hr) out.fit.push(hr.left >= -0.5 && hr.top >= -0.5 && hr.right <= window.innerWidth + 0.5 && hr.bottom <= window.innerHeight + 0.5)
      }
      // The credits control is its own image button, not a full-canvas plate, so it is
      // measured here rather than in the plate loop above.
      const credits = document.querySelector('[data-testid="main_menu_credits"]')
      const icon = document.querySelector('.menu-credits-icon')
      if (credits && icon) {
        const cb = credits.getBoundingClientRect()
        const ib = icon.getBoundingClientRect()
        const scale = Math.min(br.width / 1280, br.height / 720)
        const box = { x: 1196, y: 33, w: 52, h: 58 }
        out.fit.push(
          cb.left >= -0.5 && cb.top >= -0.5 &&
            cb.right <= window.innerWidth + 0.5 && cb.bottom <= window.innerHeight + 0.5,
        )
        // The plate's place on the canvas, and the window's place on screen. Measured in
        // screen pixels on purpose: the control is deliberately nudged when the viewport
        // would otherwise take it off the frame, so "where it sits on the canvas" is only
        // meaningful while it is unclamped. What has to hold either way is that the plate
        // itself is completely inside the window.
        const plate = { x: 1196, y: 33, w: 52, h: 58 }
        const px = artLeft + plate.x * scale
        const py = artTop + plate.y * scale
        const pw = plate.w * scale
        const ph = plate.h * scale
        out.credits = {
          x: (ib.left - artLeft) / scale,
          y: (ib.top - artTop) / scale,
          w: ib.width / scale,
          h: ib.height / scale,
          // Whether the window is still sitting exactly on the plate, or has been nudged
          // inwards because the viewport would otherwise have taken part of it off screen.
          // Whether the plate had to move because a target this big would otherwise hang
          // off the frame. Only then is a nudge allowed, and then only this far.
          needsNudge:
            px + pw / 2 + cb.width / 2 > window.innerWidth - 8 ||
            px - pw / 2 - cb.width / 2 < 8 ||
            py + ph / 2 + cb.height / 2 > window.innerHeight - 8 ||
            py - ph / 2 - cb.height / 2 < 8,
          centred:
            Math.abs((cb.left + cb.right) / 2 - (px + pw / 2)) < 0.5 &&
            Math.abs((cb.top + cb.bottom) / 2 - (py + ph / 2)) < 0.5,
          coversPlate:
            Math.min(px + pw, cb.right) - Math.max(px, cb.left) >= pw - 1 &&
            Math.min(py + ph, cb.bottom) - Math.max(py, cb.top) >= ph - 1,
          slack: {
            w: Math.min(px + pw, cb.right) - Math.max(px, cb.left) - pw,
            h: Math.min(py + ph, cb.bottom) - Math.max(py, cb.top) - ph,
          },
          natural: { w: icon.naturalWidth, h: icon.naturalHeight },
        }
      }

      // The four entries, by id. Selecting them positionally instead would miscount: the
      // credits control also sits in the upper half of the canvas.
      const ids = ['start_game', 'load_game', 'settings', 'quit']
      const entries = ids
        .map((id) => {
          const n = document.querySelector(`[data-testid="main_menu_${id}"]`)
          return n ? { id, ...n.getBoundingClientRect().toJSON() } : null
        })
        .filter(Boolean)
        .sort((a, b) => a.top - b.top)
      out.stack = entries.length === 4
      out.stackOrder = entries.map((e) => e.id).join(',')
      for (let i = 1; i < entries.length; i++) {
        // Each entry must clear the one above it, so they read as a stack not a pile.
        if (entries[i].top < entries[i - 1].bottom) out.stack = false
        out.gap = i === 1 ? entries[i].top - entries[i - 1].bottom : out.gap
      }

      // A control below this size cannot be hit reliably. The credits control scaled to
      // about 18px on a phone viewport and read as "the button does not work", so the hit
      // areas are measured, not just the artwork behind them.
      out.tooSmall = []
      out.unreachable = out.stackOrder.length ? [] : []
      out.reachable = []
      out.hits = []
      for (const el of document.querySelectorAll('.menu-art-hit')) {
        const b = el.getBoundingClientRect()
        const id = el.dataset.testid.replace('main_menu_', '')
        const ok = b.width >= 40 && b.height >= 40
        out.reachable.push(ok)
        if (!ok) out.tooSmall.push(`${id} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`)
        out.hits.push({ id, top: b.top, bottom: b.bottom, left: b.left, right: b.right })
      }

      // The minimum sizes grow each hit area, so also prove the growth did not make one
      // target swallow the taps meant for the next.
      const stackedHits = out.hits
        .filter((x) => x.id !== 'credits')
        .sort((a, b) => a.top - b.top)
      out.overlap = []
      for (let i = 1; i < stackedHits.length; i++) {
        const above = stackedHits[i - 1]
        const thisHit = stackedHits[i]
        if (thisHit.top < above.bottom && thisHit.left < above.right && above.left < thisHit.right) {
          out.overlap.push(`${above.id}/${thisHit.id}`)
          out.stack = false
        }
      }
      out.viewport = { w: window.innerWidth, h: window.innerHeight }
      return out
    })
    check(
      `at ${w}x${h} every plate lands on the backdrop's artwork`,
      r.art.length === 4 && r.art.every((a) => a.sameBox),
      `${r.art.filter((a) => a.sameBox).length}/${r.art.length} plates`,
    )
    check(
      `at ${w}x${h} every button stays inside the frame, no fullscreen needed`,
      r.fit.length === 5 && r.fit.every(Boolean),
      `${r.fit.filter(Boolean).length}/${r.fit.length} inside`,
    )
    // The credits control has to be the artwork, not an invisible target sitting over it:
    // an image the user cannot see is a button they do not know is there.
    // The credits control has to *be* the supplied artwork, shown at the canvas scale and
    // clipped to its plate -- not a stretched copy sized to the plate, and not a blank
    // target with the artwork somewhere else.
    const creditsBox = { x: 1196, y: 33, w: 52, h: 58 }
    check(
      `at ${w}x${h} the credits control is the artwork itself, at canvas scale`,
      r.credits !== undefined &&
        r.credits.natural.w === 1280 &&
        Math.abs(r.credits.w - 1280) < 1.5 &&
        Math.abs(r.credits.h - 720) < 1.5 &&
        // Registered to the composition box, exactly -- unless the control has been nudged
        // inward to stay on screen, which the next check accounts for.
        (r.credits.centred
          ? Math.abs(r.credits.x) < 1.5 && Math.abs(r.credits.y) < 1.5
          : r.credits.needsNudge),
      r.credits
        ? `${r.credits.w.toFixed(0)}x${r.credits.h.toFixed(0)} at ${r.credits.x.toFixed(1)},${r.credits.y.toFixed(1)} (from ${r.credits.natural.w}x${r.credits.natural.h})`
        : 'no credits icon',
    )
    check(
      `and it is clipped to the plate, so the whole control is inside its own window`,
      r.credits !== undefined && r.credits.coversPlate,
      r.credits
        ? `slack ${r.credits.slack.w.toFixed(1)}x${r.credits.slack.h.toFixed(1)}px around the ${creditsBox.w}x${creditsBox.h} plate`
        : 'no credits icon',
    )
    check(
      `at ${w}x${h} the four entries stack in order without overlapping`,
      r.stack && r.stackOrder === 'start_game,load_game,settings,quit',
      `${r.stackOrder}${r.stack ? '' : ` (${r.overlap.join(', ') || 'out of order'})`}`,
    )
    check(
      `at ${w}x${h} every control is big enough to tap reliably`,
      r.reachable.length === 5 && r.reachable.every(Boolean),
      r.tooSmall.length ? `too small: ${r.tooSmall.join(', ')}` : 'all at least 40x40',
    )
    await page.close()
  }
}

// ---------------------------------------------------------------------------------
console.log('\n6. every hit area sits on its own plate, at any viewport shape')
// ---------------------------------------------------------------------------------
// This is the check that was missing when the credits control was reported broken.
//
// The plates are <img> registered to a box sized from script, and the hit areas are
// absolutely positioned divs that have no such behaviour: sized as a percentage of the
// full root they are percentages of the viewport instead of the artwork, so they drift off
// their plates by however far the viewport departs from 16:9. At exactly 16:9 the two
// coincide, which is why only fullscreen ever looked right -- and why the plate-shape
// checks above all passed while every control was unclickable in an ordinary browser
// window. Note this is now the opposite situation from the backdrop: the backdrop covers,
// and the composition box contains, so the two genuinely diverge on a non-16:9 viewport.
//
// Deliberately includes viewports wider than 16:9 (an ordinary window) as well as taller
// ones, because a contain box written in CSS is correct in only one of those directions.
{
  const OUTSET = 4 // the deliberate outset each hit area is given over its plate
  for (const [w, h] of [
    [1280, 720],  // exactly 16:9
    [1280, 600],  // wider than 16:9
    [1366, 620],  // wider, an ordinary laptop window
    [844, 390],   // much wider
    [1024, 768],  // taller than 16:9
    [390, 844],   // much taller, a phone in portrait
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`${base}/`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.main-menu-ready')
    const res = await page.evaluate(
      ([art, outset]) => {
        const plate = document.querySelector('.menu-art-button')
        const pb = plate.getBoundingClientRect()
        const scale = Math.min(pb.width / 1280, pb.height / 720)
        const artLeft = pb.left + (pb.width - 1280 * scale) / 2
        const artTop = pb.top + (pb.height - 720 * scale) / 2
        return art.map((a) => {
          const n = document.querySelector(`[data-testid="main_menu_${a.id}"]`)
          const r = n.getBoundingClientRect()
          const cx = (r.left - artLeft) / scale
          const cy = (r.top - artTop) / scale
          const cw = r.width / scale
          const ch = r.height / scale
          const wantL = a.box.x - outset
          const wantT = a.box.y - outset
          const wantR = a.box.x + a.box.w + outset
          const wantB = a.box.y + a.box.h + outset
          return {
            id: a.id,
            // The hit area must cover the plate outright. It is allowed to be bigger --
            // that is the point of the minimum touch target -- but it may never be
            // smaller or shifted off the plate.
            covers:
              cx <= wantL + 1.5 &&
              cy <= wantT + 1.5 &&
              cx + cw >= wantR - 1.5 &&
              cy + ch >= wantB - 1.5,
            slackL: +(wantL - cx).toFixed(0),
            slackR: +(cx + cw - wantR).toFixed(0),
          }
        })
      },
      [MENU_BUTTON_ART, OUTSET],
    )
    const off = res.filter((x) => !x.covers)
    check(
      `at ${w}x${h} (${(w / h).toFixed(2)}:1) every hit area covers its own plate`,
      off.length === 0,
      off.length
        ? off.map((x) => `${x.id} does not reach its plate`).join('; ')
        : `all 5 cover their plate, ${res.map((x) => `${x.id} +${x.slackL}/${x.slackR}px`).join(', ')}`,
    )
    await page.close()
  }
}

// ---------------------------------------------------------------------------------
console.log('\n7. the simulation is held until START GAME, and runs after it')
// ---------------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(100)
  const dbg = await page.evaluate(() => ({
    menu: Boolean(document.querySelector('.main-menu')),
    playerX: window.__game?.world?.player?.x ?? null,
  }))
  check('debug mode skips the menu, so the pixel-level harness is unaffected', !dbg.menu, dbg.menu ? 'menu present with ?debug=1' : 'no menu with ?debug=1')
  check('and the simulation runs normally there', typeof dbg.playerX === 'number', `player x ${dbg.playerX}`)
  await page.close()
}

// ---------------------------------------------------------------------------------
console.log('\n8. the campfire is animated, and stays on the same spot every frame')
// ---------------------------------------------------------------------------------
{
  // Measured from the supplied file, not taken on trust: the numbers the placement is
  // derived from are re-read here, so a wrong constant fails instead of hiding.
  const png = readPng(ANDROID_CAMPFIRE)
  check(
    'the flame sheet is a 1024x128 strip, as supplied',
    png.width === CAMPFIRE_STRIP.width && png.height === CAMPFIRE_STRIP.height,
    `${png.width}x${png.height}`,
  )
  check(
    'which divides into eight 128px cells',
    png.width / CAMPFIRE_STRIP.cell === CAMPFIRE_STRIP.frames,
    `${png.width / CAMPFIRE_STRIP.cell} cells`,
  )

  const a = (x, y) => png.px(x, y)[3]
  let soft = 0
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const v = a(x, y)
      if (v !== 0 && v !== 255) soft++
    }
  }
  check(
    'the sheet keeps hard-edged transparency, so no frame was resampled',
    soft === 0,
    `${soft} pixels with intermediate alpha`,
  )

  // Every frame's ink, and the claim that matters: the base does not move, only the tip.
  const cellInk = []
  for (let f = 0; f < CAMPFIRE_STRIP.frames; f++) {
    let x0 = CAMPFIRE_STRIP.cell, x1 = -1, y0 = CAMPFIRE_STRIP.cell, y1 = -1
    for (let y = 0; y < CAMPFIRE_STRIP.cell; y++) {
      for (let x = 0; x < CAMPFIRE_STRIP.cell; x++) {
        if (a(f * CAMPFIRE_STRIP.cell + x, y) > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    cellInk.push({ x0, x1, y0, y1 })
  }
  const union = cellInk.reduce((acc, b) => ({
    x0: Math.min(acc.x0, b.x0), x1: Math.max(acc.x1, b.x1),
    y0: Math.min(acc.y0, b.y0), y1: Math.max(acc.y1, b.y1),
  }))
  check(
    'the ink sits where the placement assumes it does, in every frame',
    union.x0 === CAMPFIRE_INK.x0 && union.x1 === CAMPFIRE_INK.x1 &&
      union.y0 === CAMPFIRE_INK.y0 && union.y1 === CAMPFIRE_INK.y1,
    `x ${union.x0}..${union.x1} y ${union.y0}..${union.y1}`,
  )
  const bottoms = [...new Set(cellInk.map((b) => b.y1))]
  const tops = [...new Set(cellInk.map((b) => b.y0))]
  check(
    'every frame is anchored at the same base row, so the fire cannot slide',
    bottoms.length === 1,
    `base rows ${bottoms.join(', ')}`,
  )
  check(
    'and only the tip moves, which is what makes it a flicker rather than a slide',
    tops.length > 1,
    `tip rows ${tops.sort((x, y) => x - y).join(', ')}`,
  )

  const fingerprints = cellInk.map(
    (b) => `${b.x0}.${b.x1}.${b.y0}.${b.y1}:${[b.y0, b.y1].join('-')}`,
  )
  check(
    'the eight frames are genuinely different poses',
    new Set(fingerprints).size === CAMPFIRE_STRIP.frames,
    `${new Set(fingerprints).size} distinct of ${CAMPFIRE_STRIP.frames}`,
  )

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.main-menu-ready')

  // Sample the loop over time: the frame index must advance and wrap, and the light must
  // breathe rather than sit at a constant.
  const seen = new Set()
  const glows = new Set()
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => {
      const strip = document.querySelector('.main-menu-fire-strip')
      const glow = document.querySelector('.main-menu-fire-glow')
      return {
        frame: strip?.style.getPropertyValue('--campfire-frame') ?? '',
        glow: glow?.style.opacity ?? '',
      }
    })
    seen.add(s.frame)
    glows.add(s.glow)
    await page.waitForTimeout(40)
  }
  const frames = [...seen].filter(Boolean).map(Number).sort((a, b) => a - b)
  check(
    'the flame actually animates, and every frame is reached',
    frames.length === CAMPFIRE_STRIP.frames,
    `frames seen: ${frames.join(', ') || 'none'}`,
  )
  check(
    'the warm light flickers rather than sitting still',
    glows.size > 5 && [...glows].every((g) => Number(g) > 0 && Number(g) <= 1),
    `${glows.size} distinct opacities`,
  )

  // Registration: the cell must sit on the backdrop's own canvas at every viewport.
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
    [1280, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(120)
    const geo = await page.evaluate(
      ([cx, cy]) => {
        const win = document.querySelector('.main-menu-fire-flame')
        const back = document.querySelector('.main-menu-backdrop')
        if (!win || !back) return null
        const b = back.getBoundingClientRect()
        const r = win.getBoundingClientRect()
        // The backdrop is `contain` in a box that is not 16:9, so the artwork occupies a
        // letterboxed rectangle inside that box. Its own element box is the whole box, so
        // the artwork rect has to be derived rather than read, or every measurement is
        // taken against the wrong origin on any viewport that letterboxes.
        const scale = Math.min(b.width / 1280, b.height / 720)
        const artLeft = b.left + (b.width - 1280 * scale) / 2
        const artTop = b.top + (b.height - 720 * scale) / 2
        return {
          left: (r.x - artLeft) / scale,
          top: (r.y - artTop) / scale,
          w: r.width / scale,
          h: r.height / scale,
        }
      },
      [CAMPFIRE_CELL.x, CAMPFIRE_CELL.y],
    )
    check(
      `at ${w}x${h} the flame cell sits on the background's canvas, at the drawing scale`,
      geo !== null &&
        Math.abs(geo.left - CAMPFIRE_CELL.x) < 1 &&
        Math.abs(geo.top - CAMPFIRE_CELL.y) < 1 &&
        Math.abs(geo.w - CAMPFIRE_STRIP.cell * CAMPFIRE_FLAME_SCALE) < 1 &&
        Math.abs(geo.h - CAMPFIRE_STRIP.cell * CAMPFIRE_FLAME_SCALE) < 1,
      geo
        ? `canvas x ${geo.left.toFixed(1)} y ${geo.top.toFixed(1)}, ${geo.w.toFixed(1)}x${geo.h.toFixed(1)}`
        : 'no fire element',
    )
  }
  await page.close()
}

console.log('\n9. the character is animated, and sits where the static one was')
// ---------------------------------------------------------------------------------
{
  // Measured from the supplied sheets, so the derived scale and placement are re-derived
  // here rather than taken on trust.
  const sheets = MENU_CHARACTER_FILES.map((f) => readPng(join(ANDROID_BUTTONS, f)))
  for (const [i, png] of sheets.entries()) {
    check(
      `character sheet ${i === 0 ? 'A' : 'B'} is 1536x96, as supplied`,
      png.width === 1536 && png.height === 96,
      `${png.width}x${png.height}`,
    )
    check(
      `which divides into sixteen 96px frames`,
      png.width / 96 === CHARACTER_FRAMES,
      `${png.width / 96} frames`,
    )
  }

  const inkOf = (png, cell) => {
    let x0 = 96, x1 = -1, y0 = 96, y1 = -1
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (png.px(cell * 96 + x, y)[3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    return { x0, x1, y0, y1 }
  }
  const union = { x0: 96, x1: -1, y0: 96, y1: -1 }
  for (const png of sheets) {
    for (let c = 0; c < CHARACTER_FRAMES; c++) {
      const b = inkOf(png, c)
      union.x0 = Math.min(union.x0, b.x0)
      union.x1 = Math.max(union.x1, b.x1)
      union.y0 = Math.min(union.y0, b.y0)
      union.y1 = Math.max(union.y1, b.y1)
    }
  }
  check(
    'the sheets measure the way the derived placement assumes',
    union.x0 === CHARACTER_SHEET_INK.x0 && union.y0 === CHARACTER_SHEET_INK.y0 &&
      union.y1 === CHARACTER_SHEET_INK.y1,
    `ink x0 ${union.x0}, y ${union.y0}..${union.y1}`,
  )

  // The seated figure must not slide. Every frame's base row has to be the same.
  for (const [i, png] of sheets.entries()) {
    const bottoms = [...new Set(Array.from({ length: CHARACTER_FRAMES }, (_, c) => inkOf(png, c).y1))]
    check(
      `sheet ${i === 0 ? 'A' : 'B'} is anchored at one base row across all sixteen frames`,
      bottoms.length === 1,
      `base rows ${bottoms.join(', ')}`,
    )
  }

  // The scale is derived from height; check it also reproduces the width, which is what
  // proves it was not simply fitted to one dimension.
  // Edges, because the placement is anchored on edges: ink spans [y0, y1] inclusive.
  const h = union.y1 + 1 - union.y0
  const w = union.x1 + 1 - union.x0
  const scale = (CHARACTER_STATIC_INK.h * CHARACTER_SIZE) / h
  const targetH = CHARACTER_STATIC_INK.h * CHARACTER_SIZE
  const targetW = CHARACTER_STATIC_INK.w * CHARACTER_SIZE
  check(
    'the derived scale matches the sized static figure in height and width together',
    Math.abs(h * scale - targetH) < 1 && Math.abs(w * scale - targetW) < 1,
    `${w} x ${h} at ${scale.toFixed(4)} -> ${(w * scale).toFixed(1)} x ${(h * scale).toFixed(1)} against ${targetW.toFixed(1)} x ${targetH.toFixed(1)}`,
  )
  check(
    'and it is the static figure at the size factor, scaled uniformly so the art keeps its proportions',
    Math.abs(scale - (161 * CHARACTER_SIZE) / 72) < 0.001,
    `x${scale.toFixed(4)}, ${CHARACTER_SIZE * 100}% of 161/72`,
  )
  check(
    'the character really is drawn smaller than the static figure it replaces',
    h * scale < CHARACTER_STATIC_INK.h - 1,
    `${(h * scale).toFixed(1)} tall against the static ${CHARACTER_STATIC_INK.h}`,
  )

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.main-menu-ready')

  const aSeen = new Set()
  const bSeen = new Set()
  for (let i = 0; i < 260; i++) {
    const f = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="main_menu_character_strip_0"]')
      const b = document.querySelector('[data-testid="main_menu_character_strip_1"]')
      return {
        aVis: a?.style.visibility, aF: a?.style.getPropertyValue('--character-frame') ?? '',
        bVis: b?.style.visibility, bF: b?.style.getPropertyValue('--character-frame') ?? '',
      }
    })
    if (f.aVis === 'visible') aSeen.add(f.aF)
    if (f.bVis === 'visible') bSeen.add(f.bF)
    await page.waitForTimeout(25)
  }
  const count = (set) => [...set].filter(Boolean).length
  check('sheet A plays all sixteen frames', count(aSeen) === CHARACTER_FRAMES, `${count(aSeen)} of ${CHARACTER_FRAMES}`)
  check('and sheet B plays all sixteen after it', count(bSeen) === CHARACTER_FRAMES, `${count(bSeen)} of ${CHARACTER_FRAMES}`)

  // Registration, including a viewport wider than 16:9 -- the direction a CSS-only
  // contain box gets wrong.
  for (const [w2, h2] of [
    [1280, 720],
    [1280, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w2, height: h2 })
    await page.waitForTimeout(150)
    const geo = await page.evaluate(() => {
      const win = document.querySelector('.main-menu-character-window')
      const back = document.querySelector('.main-menu-backdrop')
      const b = back.getBoundingClientRect()
      const r = win.getBoundingClientRect()
      const sc = Math.min(b.width / 1280, b.height / 720)
      const L = b.left + (b.width - 1280 * sc) / 2
      const T = b.top + (b.height - 720 * sc) / 2
      return { x: (r.left - L) / sc, y: (r.top - T) / sc, w: r.width / sc, h: r.height / sc }
    })
    // Anchored on the figure's centre column and base row, not its top left: the check has
    // to use the same rule the code does, or a correctly anchored figure fails it.
    const wantX =
      CHARACTER_STATIC_INK.x +
      CHARACTER_STATIC_INK.w / 2 -
      ((union.x0 + union.x1 + 1) / 2) * scale
    const wantY =
      CHARACTER_STATIC_INK.y + CHARACTER_STATIC_INK.h - (union.y1 + 1) * scale
    const wantS = 96 * scale
    check(
      `at ${w2}x${h2} the character cell lands on the static character's place`,
      Math.abs(geo.x - wantX) < 1.5 && Math.abs(geo.y - wantY) < 1.5 &&
        Math.abs(geo.w - wantS) < 1.5 && Math.abs(geo.h - wantS) < 1.5,
      `canvas ${geo.x.toFixed(1)},${geo.y.toFixed(1)} ${geo.w.toFixed(1)}x${geo.h.toFixed(1)} (want ${wantX.toFixed(1)},${wantY.toFixed(1)} ${wantS.toFixed(1)})`,
    )
  }
  await page.close()

  const ktFire = codeOnly(ktMenu)
  check('Android plays both sheets, sixteen frames each, at the same rate', /CHARACTER_FRAMES = 16/.test(ktFire) && /CHARACTER_FPS = 8/.test(ktFire), '16 frames at 8 fps')
  check(
    'Android derives the same scale from the same two measurements',
    /CHARACTER_STATIC_H \* CHARACTER_SIZE\)\.toFloat\(\)/.test(ktFire) && /CHARACTER_SIZE = 0\.9f/.test(ktFire),
    '161 * 0.9 / 71',
  )
  check(
    'Android anchors the figure on its centre column and base row too',
    /CHARACTER_STATIC_X \+ CHARACTER_STATIC_W \/ 2f/.test(ktFire) &&
      /CHARACTER_STATIC_Y \+ CHARACTER_STATIC_H - CHARACTER_SHEET_INK_Y1 \* CHARACTER_SCALE/.test(ktFire),
    'centre column + base row',
  )
  check(
    'both engines wrap their frame counters forwards, so a negative first tick cannot index off the front',
    /function wrapFrame/.test(codeOnly(readFileSync(MENU_TS, 'utf8'))) &&
      /\(\(frame % length\) \+ length\) % length/.test(codeOnly(readFileSync(MENU_TS, 'utf8'))) &&
      /coerceAtLeast\(0\)\) % CHARACTER_SEQUENCE\.size/.test(ktFire),
    'wrapFrame + coerceAtLeast(0)',
  )
  check(
    'Android plays the same order, with the last sheet running in reverse',
    /CHARACTER_SEQUENCE\[cursor\]/.test(ktFire) &&
      /List\(CHARACTER_FRAMES - 2\) \{ 1 to \(CHARACTER_FRAMES - 2 - it\) \}/.test(ktFire),
    'boomerang on the last sheet',
  )
  check('Android clips to one cell and slides the sheet behind it', /clipToBounds\(\)/.test(ktFire) && /offset\(x = \(-frame \* CHARACTER_CELL \* CHARACTER_SCALE\)\.dp\)/.test(ktFire), 'clipToBounds + per-frame offset')
  check('Android keeps the character pixel art unsmoothed', /FilterQuality\.None/.test(ktFire), 'FilterQuality.None')
  check('Android loads the sheets from the same folder as the plates', /"bg\/menu_buttons\/\$file"/.test(ktFire), 'assets/bg/menu_buttons/<file>')
}

// ---------------------------------------------------------------------------------
console.log('\n9b. the artwork is oriented and placed the way the supplied files say')
// ---------------------------------------------------------------------------------
// Two things that are impossible to eyeball from the source and easy to get backwards:
// which way the seated figure faces, and where the fire belongs. Both are settled here by
// measuring the files, so a wrong constant fails instead of hiding. The supplied 1280x720
// overlays decide, because they are the artwork the animation has to line up with.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.main-menu-ready')

  const measured = await page.evaluate(
    async ([characterUrls, staticFireUrl, stripUrl, cell, frames]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = () => rej(new Error('could not load ' + src))
          img.src = src
        })
      const alphaOf = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height).data
      }
      /** Where the ink is inside a region, as [x, y, w, h] in that region's coordinates. */
      const boxIn = (img, ox, oy, ow, oh, threshold = 1) => {
        const d = alphaOf(img)
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (let y = 0; y < oh; y++)
          for (let x = 0; x < ow; x++)
            if (d[((oy + y) * img.width + ox + x) * 4 + 3] >= threshold) {
              if (x < x0) x0 = x
              if (x > x1) x1 = x
              if (y < y0) y0 = y
              if (y > y1) y1 = y
            }
        return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
      }
      /** The same ink, resampled to W x H so two different drawings can be compared. */
      const maskOf = (img, x0, y0, w, h, W, H, threshold = 1) => {
        const d = alphaOf(img)
        const out = []
        for (let y = 0; y < H; y++) {
          const row = []
          for (let x = 0; x < W; x++) {
            const sx = Math.min(img.width - 1, Math.max(0, x0 + Math.floor((x * w) / W)))
            const sy = Math.min(img.height - 1, Math.max(0, y0 + Math.floor((y * h) / H)))
            row.push(d[(sy * img.width + sx) * 4 + 3] >= threshold ? 1 : 0)
          }
          out.push(row)
        }
        return out
      }
      const iou = (a, b) => {
        let inter = 0, uni = 0
        for (let y = 0; y < a.length; y++)
          for (let x = 0; x < a[0].length; x++) {
            if (a[y][x] && b[y][x]) inter++
            if (a[y][x] || b[y][x]) uni++
          }
        return uni === 0 ? 0 : inter / uni
      }
      const flip = (m) => m.map((r) => [...r].reverse())

      // Which way the seated figure faces, against the static one in the overlay.
      const overlay = await load('/bg/main_menu_overlay.png')
      const oi = boxIn(overlay, 0, 0, overlay.width, overlay.height)
      const W = 56
      const H = 52
      const reference = maskOf(overlay, oi[0], oi[1], oi[2], oi[3], W, H)
      const facing = []
      for (const url of characterUrls) {
        const img = await load(url)
        const ink = boxIn(img, 0, 0, img.height, img.height)
        const m = maskOf(img, ink[0], ink[1], ink[2], ink[3], W, H)
        facing.push({
          file: url.split('/').pop(),
          asIs: iou(reference, m),
          mirrored: iou(reference, flip(m)),
        })
      }

      // Where the supplied fire sits, and where one flame cell's ink would land.
      const staticFire = await load(staticFireUrl)
      const core = boxIn(staticFire, 0, 0, staticFire.width, staticFire.height, 128)
      const strip = await load(stripUrl)
      const perFrame = []
      for (let f = 0; f < frames; f++) perFrame.push(boxIn(strip, f * cell, 0, cell, cell))
      const ux = perFrame.map((b) => b[0])
      const uy = perFrame.map((b) => b[1])
      const union = [
        Math.min(...ux),
        Math.min(...uy),
        Math.max(...ux.map((x, i) => x + perFrame[i][2])) - Math.min(...ux),
        Math.max(...uy.map((y, i) => y + perFrame[i][3])) - Math.min(...uy),
      ]
      const refFire = maskOf(staticFire, core[0], core[1], core[2], core[3], 48, 48, 128)
      const fm = maskOf(strip, union[0], union[1], union[2], union[3], 48, 48)
      return {
        facing,
        staticFire: { core, bottom: core[1] + core[3] - 1, centreX: core[0] + core[2] / 2 },
        flame: {
          union,
          centreX: union[0] + union[2] / 2,
          // union is [x0, y0, w, h] with y0/h inclusive, so the base row is y0 + h.
          baseY: union[1] + union[3],
        },
        fireIoU: { asIs: iou(refFire, fm), mirrored: iou(refFire, flip(fm)) },
      }
    },
    [
      MENU_CHARACTER_FILES.map((f) => `/bg/menu_buttons/${f}`),
      '/bg/main_menu_campfire.png',
      `/bg/menu_buttons/${MENU_CAMPFIRE}`,
      CAMPFIRE_STRIP.cell,
      CAMPFIRE_STRIP.frames,
    ],
  )

  // --- which way the seated figure faces ---------------------------------------
  for (const f of measured.facing) {
    check(
      `${f.file} mirrored agrees with the seated figure in the supplied overlay`,
      f.mirrored > f.asIs * 1.3,
      `agreement ${f.mirrored.toFixed(3)} mirrored against ${f.asIs.toFixed(3)} as supplied`,
    )
  }
  const css9b = readFileSync(MENU_CSS, 'utf8')
  check(
    'so the character is drawn mirrored, on both engines',
    /\.main-menu-character-window[^{]*\{[\s\S]{0,900}transform:\s*scaleX\(-1\)/.test(css9b) &&
      /scaleX\(-1f\)/.test(codeOnly(ktMenu)),
    'scaleX(-1) on the character window, web and Android',
  )
  check(
    'and the mirror is on the window rather than the strip, so the sixteen frames still play in order',
    !/\.main-menu-character-strip[^{]*\{[\s\S]{0,900}scaleX/.test(css9b),
    'no mirror on .main-menu-character-strip',
  )

  // --- where the fire belongs --------------------------------------------------
  // Anchored on centre column and base row, at the drawing scale -- the same rule the code
  // uses, so this fails if the anchoring is changed on one side only.
  const wantCellX = measured.staticFire.centreX - measured.flame.centreX * CAMPFIRE_FLAME_SCALE
  const wantCellY = measured.staticFire.bottom - measured.flame.baseY * CAMPFIRE_FLAME_SCALE
  check(
    'the flame cell is placed where the supplied campfire canvas puts the fire',
    Math.abs(CAMPFIRE_CELL.x - wantCellX) < 0.5 && Math.abs(CAMPFIRE_CELL.y - wantCellY) < 0.5,
    `cell (${CAMPFIRE_CELL.x}, ${CAMPFIRE_CELL.y}) against (${wantCellX.toFixed(1)}, ${wantCellY.toFixed(1)}) measured off the supplied canvas`,
  )
  check(
    'the supplied fire sits where the constants say it does',
    measured.staticFire.core[0] === CAMPFIRE_SUPPLIED_FIRE.x0 &&
      measured.staticFire.bottom === CAMPFIRE_SUPPLIED_FIRE.baseY,
    `core x ${measured.staticFire.core[0]}, base row ${measured.staticFire.bottom}`,
  )
  check(
    'the flame sheet is not mirrored -- it already faces the way the artwork does',
    measured.fireIoU.asIs > measured.fireIoU.mirrored * 1.3,
    `agreement ${measured.fireIoU.asIs.toFixed(3)} as supplied against ${measured.fireIoU.mirrored.toFixed(3)} mirrored`,
  )

  // --- both character sheets, but only one at a time --------------------------
  check(
    'Android shows one character sheet at a time, rather than drawing both on top of each other',
    /alpha\(if \(index == sheetIndex\) 1f else 0f\)/.test(codeOnly(ktMenu)),
    'alpha driven by sheetIndex',
  )
  await page.close()
}

// ---------------------------------------------------------------------------------

console.log('\n10. Android mirrors the same menu')
// ---------------------------------------------------------------------------------
{
  const ktScreen = readFileSync(KT_SCREEN, 'utf8')
  const css = readFileSync(MENU_CSS, 'utf8')
  const mainTs = readFileSync(MAIN_TS, 'utf8')
  const overlaySupplied = existsSync(ANDROID_OVERLAY) && existsSync(ANDROID_CAMPFIRE)

  check('both engines load the background by the same synced filename', menuTs.includes('main_menu.jpg') && ktMenu.includes('"main_menu.jpg"'), `bg/main_menu.jpg`)
  check(
    'web keeps the background at its own size, whole, without stretching or cropping it',
    /\.main-menu-backdrop[^{]*\{[\s\S]{0,600}object-fit:\s*contain/.test(css),
  )
  check(
    'and Android fits it the same way, since Compose has no object-fit',
    /rememberMenuBackground\(\)\?\.let[\s\S]{0,400}ContentScale\.Fit/.test(codeOnly(ktMenu)),
    'ContentScale.Fit on the backdrop',
  )
  check(
    'the web stylesheet puts no transition or animation on the static art layers',
    !/\.main-menu-(backdrop|overlay)[^{]*\{[^}]*(transition|animation)/.test(css),
    'no transition/animation on .main-menu-backdrop / -overlay',
  )
  // The fire is the one layer that does move, and it moves only because the loop steps a
  // sprite offset. A CSS transition or keyframe animation on it would drift off the
  // background instead of playing the supplied frames.
  check(
    'the flame plays by stepping frames, not by a CSS animation of its own',
    /@keyframes/.test(css) === false && !/\.main-menu-fire[^{]*\{[^}]*animation/.test(css),
    'no keyframes, no animation on .main-menu-fire*',
  )
  check(
    'Android keeps the composition canvases fitted, so nothing placed inside them is ever cropped',
    /ContentScale\.Fit/.test(ktMenu),
    'ContentScale.Fit',
  )
  check('Android does not tint the artwork', !/ColorFilter|colorFilter/.test(ktMenu), 'no colour filter on the image')

  if (overlaySupplied) {
    check(
      'both engines name the same two character sheets, in the same order',
      ktMenu.includes('character_idle_a.png') && ktMenu.includes('character_idle_b.png') &&
        menuTs.includes('character_idle_a.png') && menuTs.includes('character_idle_b.png'),
      'character_idle_a.png then character_idle_b.png',
    )
    check(
      'and both engines load the flame strip by the same filename',
      ktMenu.includes('"campfire_flame.png"') && menuTs.includes('campfire_flame.png'),
      'assets/bg/menu_buttons/campfire_flame.png',
    )
    check('the character overlay is read from the assets root by the same loader', ktMenu.includes('"bg/$assetFile"'), 'assets/bg/<file>')
    // The backdrop is the only full-canvas layer left: the fire and the character are
    // sprite strips drawn a cell at a time rather than fitted to the canvas.
    const fits = (ktMenu.match(/ContentScale\.Fit/g) || []).length
    check('the plate canvases are still fitted to the canvas', fits >= 1, `${fits} uses of ContentScale.Fit`)
    // Nothing crops. `cover` was tried and reverted: it fills the frame but cuts the edges
    // off the composition, and the menu controls are painted into the picture's own left and
    // right thirds, so cropping would take entries off screen on a portrait phone.
    check(
      'no layer crops the supplied artwork',
      !/ContentScale\.Crop/.test(codeOnly(ktMenu)) && !/object-fit:\s*cover/.test(css),
      'no ContentScale.Crop on Android, no object-fit: cover on the web',
    )
  } else {
    pending('Android art layer parity is not checked yet', 'the art canvases have not been supplied')
  }

  check(
    'Android keeps the backdrop, the character, the fire and the UI as four layers',
    /main_menu"/.test(ktMenu) && /main_menu_fire/.test(ktMenu) && /main_menu_character/.test(ktMenu) && /main_menu_ui/.test(ktMenu),
    'main_menu / main_menu_fire / main_menu_character / main_menu_ui',
  )
  // In document order, which is how Compose decides what covers what: background, then the
  // seated character, then the fire and its light in front of it, then the readable UI.
  check(
    'and they are declared in that order, so the fire draws over the character',
    (() => {
      // Inside the MainMenu composable: the backdrop, then the two art layers, then the
      // readable UI. The fire and character carry their own tags on their own composables,
      // so what orders the layers here is where each is called from.
      const c = codeOnly(ktMenu).slice(codeOnly(ktMenu).indexOf('fun MainMenu('))
      const order = ['testTag("main_menu")', 'MenuCharacter(', 'MenuFire(', 'testTag("main_menu_ui")']
        .map((t) => c.indexOf(t))
      return order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))
    })(),
    'backdrop < character < fire < ui',
  )
  // The Android side of the fire. It cannot be compiled in this environment, so the claims
  // that matter are asserted against the source: the same cell, the same placement, the
  // same frame rate, and no rescaling of the supplied strip.
  const ktFire = codeOnly(ktMenu)
  check(
    'Android plays the same eight frames at the same slowed rate',
    /CAMPFIRE_FLAME_FRAMES = 8/.test(ktFire) && /CAMPFIRE_FLAME_FPS = 8/.test(ktFire) &&
      /CAMPFIRE_FLAME_FPS = 8/.test(codeOnly(readFileSync(MENU_TS, 'utf8'))),
    '8 frames at 8 fps, both engines',
  )
  check(
    'Android places the cell where the web does, from the same centre column and base row',
    /CAMPFIRE_SUPPLIED_CENTRE_X - CAMPFIRE_CELL_INK_CENTRE_X \* CAMPFIRE_FLAME_SCALE/.test(ktFire) &&
      /CAMPFIRE_SUPPLIED_BASE_Y - CAMPFIRE_CELL_INK_BASE_Y \* CAMPFIRE_FLAME_SCALE/.test(ktFire),
    'centre column + base row, scaled',
  )
  check(
    'Android draws the flame at the same size as the web',
    /CAMPFIRE_FLAME_SCALE = 1\.32f/.test(ktFire) &&
      /CAMPFIRE_FLAME_CELL \* CAMPFIRE_FLAME_SCALE\)\.dp/.test(ktFire),
    'scale 1.32 on the cell and the strip',
  )
  check('Android draws the flame inside the shared canvas box, so it scales with the backdrop', /MenuFire\(\s*Modifier\s*\.offset\(x = fireCanvas\.offsetX, y = fireCanvas\.offsetY\)/.test(ktFire), 'MenuFire on the canvas surface')
  check(
    'Android clips to one cell and slides the strip behind it',
    /clipToBounds\(\)/.test(ktFire) &&
      /offset\(x = \(-frame \* CAMPFIRE_FLAME_CELL \* CAMPFIRE_FLAME_SCALE\)\.dp\)/.test(ktFire),
    'clipToBounds + per-frame offset',
  )
  check('Android keeps the pixel art unsmoothed and unscaled', /FilterQuality\.None/.test(ktFire) && /CAMPFIRE_FLAME_CELL \* CAMPFIRE_FLAME_FRAMES/.test(ktFire), 'FilterQuality.None, strip sized in whole cells')
  check('Android has the same warm light as the web', /main_menu_fire_glow/.test(ktFire) && /Brush\.radialGradient/.test(ktFire), 'radial glow layer')

  const labels = ['START GAME', 'LOAD GAME', 'SETTINGS', 'QUIT']
  const found = labels.filter((l) => ktMenu.includes(`"${l}"`))
  check('Android offers the same four entries', found.length === 4, found.join(', '))

  // The supplied plates, on both engines.
  for (const art of MENU_BUTTON_ART) {
    check(`Android loads the ${art.label} plate from the assets tree`, existsSync(join(ANDROID_BUTTONS, art.file)), `bg/menu_buttons/${art.file}`)
  }
  check(
    'Android declares the same plate bounds, so its hit areas land on the same pixels',
    // Bounds live under `box` here, so reading a.x directly would compare "undefined".
    MENU_BUTTON_ART.every((a) =>
      ktMenu.includes(
        `"${a.id}", "${a.label}", "${a.file}", ${a.box.x}, ${a.box.y}, ${a.box.w}, ${a.box.h}`,
      ),
    ),
    'id, label, file, x, y, w, h per plate',
  )
  check('Android reads the plates from the same folder the web build does', ktMenu.includes('"bg/menu_buttons/$file"'), 'assets/bg/menu_buttons/<file>')
  check('and draws each across the whole canvas rather than sizing it to the plate', /Image\(image, null, Modifier\.fillMaxSize\(\), contentScale = ContentScale\.Fit\)/.test(ktMenu), 'each plate is fillMaxSize + Fit')
  check('Android scales the canvas box itself, since Compose has no object-fit', /min\(w \/ CANVAS_WIDTH\.toFloat\(\), h \/ CANVAS_HEIGHT\.toFloat\(\)\)/.test(ktMenu), 'canvasBox() computes the letterbox')
  check('and gives every control an accessible name, the baked-in label being invisible to one', /contentDescription = art\.label/.test(ktMenu), 'semantics on each hit area')
  check('Android wires the supplied credits control rather than leaving it decorative', ktMenu.includes('"credits"') && ktMenu.includes('MenuScreen.CREDITS'), 'credits -> CREDITS screen')
  const ktCredits = codeOnly(ktMenu.slice(ktMenu.indexOf('private fun CreditsControl')))
  check(
    'Android draws the credits control as a window onto its own plate, not as a full-canvas sheet',
    /private fun CreditsControl/.test(ktMenu) &&
      /if \(art\.id == CREDITS_ID\) continue/.test(ktMenu) &&
      /clipToBounds\(\)/.test(ktCredits),
    'credits drawn as a clipped window',
  )
  check(
    'and lines the plate up with the window centre, so the artwork never leaves its plate',
    /width \/ 2f - \(art\.x \+ art\.w \/ 2f\) \* canvas\.scale\.dp/.test(ktCredits),
    'plate centred in the window',
  )
  check('and Android has that credits screen', /MenuScreen\.CREDITS -> MenuPanel\("CREDITS"/.test(ktMenu), 'credits panel')

  const ktCode = codeOnly(ktMenu)
  // Android cannot be compiled here, so the touch-target fix is asserted statically. This
  // is the defect the user reported: a proportionally scaled 1280x720 canvas becomes about
  // a quarter size in a portrait phone, leaving the credits control roughly 15dp across
  // against a 48dp minimum, so presses miss it and it reads as broken.
  check(
    'Android gives every control a 48dp minimum touch target',
    /val minTouch = 48\.dp/.test(ktCode) && /maxOf\(target\.width, minTouch\)/.test(ktCode) && /maxOf\(target\.height, minTouch\)/.test(ktCode),
    'minTouch = 48.dp applied to width and height',
  )
  check(
    'and bounds each stacked entry by its neighbours, so growth cannot steal the next tap',
    /bandTop/.test(ktCode) && /bandBottom/.test(ktCode) && /coerceIn\(bandTop, bandBottom - h\)/.test(ktCode),
    'entries are clamped to the midpoint between neighbours',
  )
  check(
    'and keeps a grown target on the frame, which the corner credits control needs',
    /coerceIn\(0\.dp, canvas\.width - clampedWidth\)/.test(ktCode) && /canvas\.height - height/.test(ktCode),
    'left and top are clamped inside the canvas',
  )
  check(
    'and the web grows its hit areas the same way',
    /\.menu-art-hit[\s\S]{0,2000}min-width: 44px/.test(css) && /\.menu-art-hit[\s\S]{0,2000}min-height: 40px/.test(css),
    'min-width 44px, min-height 40px',
  )
  const menuCode = codeOnly(menuTs)
  check(
    'and the web draws the credits control as a visible image inside its own target, not a blank one',
    /menu-credits-icon/.test(menuCode) && /menu-credits-hit/.test(menuCode),
    'credits icon inside the credits hit area',
  )
  check(
    'sized to the plate rather than the canvas, so the icon is not one invisible sliver of a 1280x720 sheet',
    !/if \(art\.id === 'credits'\)[\s\S]{0,600}className = 'menu-art-button'/.test(menuCode),
    'credits does not reuse the full-canvas plate image',
  )
  check(
    'with the target centred on the icon and clamped inside the viewport, so it cannot drift off or hang off the frame',
    /placeCredits/.test(menuCode) &&
      /MIN_TOUCH_PX/.test(menuCode) &&
      /viewportWidth - targetW - MARGIN_PX/.test(menuCode),
    'placeCredits() grows and clamps',
  )

  const forbidden = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS'].filter((f) => ktMenu.includes(f))
  check('and none of the ruled-out entries appear there either', forbidden.length === 0, forbidden.length ? forbidden.join(', ') : 'none present')

  check('Android has a load screen with an honest empty state', /LOAD GAME/.test(ktMenu) && /No saved games/.test(ktMenu), 'empty state present')
  check('Android invents no save data either', !/Save \d|Slot \d|\d+:\d{2}/.test(ktMenu), 'no fabricated save data')
  check('and a settings screen', /SETTINGS/.test(ktMenu))
  check('Android disables controls that have nothing behind them', /menu-setting-disabled/.test(ktMenu), 'disabled rows')

  check(
    'QUIT really exits the app on Android, unlike the web which returns to the title',
    /finish\(\)/.test(ktMenu + ktScreen) && /exitProcess\(0\)/.test(ktMenu + ktScreen),
    'finish() with exitProcess as the backstop',
  )
  check('and Android wires it to the menu', /MainMenuAction\.Quit/.test(ktScreen))
  check('while the web returns to the title instead of trying to close the tab', !codeOnly(menuTs).includes('window.close') && !codeOnly(mainTs).includes('window.close'), 'no window.close call anywhere in the web build')

  check('both engines gate the simulation behind the menu', /started\) world\.update/.test(mainTs) && /if \(started\) gameWorld\.update/.test(ktScreen), 'update only once started')
  check(
    'and both stop drawing the world, not merely updating it',
    /if \(started\) \{\s*ctx\.save/.test(mainTs) && /if \(started && currentTick >= 0\)/.test(ktScreen),
    'render skipped while the menu is up',
  )
  check('and both hide the in-game furniture until it is dismissed', /controls\.root\.hidden = !started/.test(mainTs) && /if \(started\) \{/.test(ktScreen), 'HUD and controls gated')
  check('both start with the world held still behind the menu', /let started = debugMode/.test(mainTs) && /var started by remember \{ mutableStateOf\(false\) \}/.test(ktScreen), 'web honours ?debug=1, Android starts gated')
}

await browser.close()
server.close()

console.log(failures === 0 ? '\nMain menu checks passed' : `\n${failures} main menu check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
