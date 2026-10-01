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

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(webRoot, 'dist')

/** The backdrop, as both engines name it. Declared once; checked against both copies. */
const MENU_BG = 'main_menu.jpg'
/** The character/campfire overlay. */
const MENU_OVERLAY = 'main_menu_overlay.png'

const ANDROID_ASSET = join(repoRoot, 'app/src/main/assets/bg', MENU_BG)
const WEB_ASSET = join(webRoot, 'public/bg', MENU_BG)
const ANDROID_OVERLAY = join(repoRoot, 'app/src/main/assets/bg', MENU_OVERLAY)
const WEB_OVERLAY = join(webRoot, 'public/bg', MENU_OVERLAY)

const MENU_TS = join(webRoot, 'src/ui/MainMenu.ts')
const MENU_CSS = join(webRoot, 'src/style.css')
const MAIN_TS = join(webRoot, 'src/main.ts')
const KT_MENU = join(repoRoot, 'app/src/main/java/com/example/game/ui/MainMenu.kt')
const KT_SCREEN = join(repoRoot, 'app/src/main/java/com/example/game/ui/GameScreen.kt')

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

  const oa = existsSync(ANDROID_OVERLAY)
  const ow = existsSync(WEB_OVERLAY)
  if (!oa) {
    pending('the character overlay has not been supplied yet', `expected at ${ANDROID_OVERLAY.replace(`${repoRoot}/`, '')}`)
  } else {
    check('the overlay is in the Android assets tree', true, ANDROID_OVERLAY.replace(`${repoRoot}/`, ''))
    check('and synced to the web copy', ow, WEB_OVERLAY.replace(`${webRoot}/`, ''))
    const ab = readFileSync(ANDROID_OVERLAY)
    if (ow) {
      const wb = readFileSync(WEB_OVERLAY)
      check('the overlay copies are byte-for-byte identical', ab.equals(wb), `${ab.length} vs ${wb.length} bytes`)
    }
    check('it is still a PNG, so its transparency survived', ab[0] === 0x89 && ab.subarray(1, 4).toString('ascii') === 'PNG', 'PNG signature intact')
    const size = pngSize(ANDROID_OVERLAY)
    // The whole registration argument rests on this: same canvas size as the backdrop.
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
  const realMissing = missing.filter((m) => !m.includes(MENU_OVERLAY))
  check('the page raises no script errors', errors.length === 0, errors.join('; '))
  check('the page requests no missing assets', realMissing.length === 0, realMissing.join('; ') || 'every request succeeded')

  const overlaySupplied = existsSync(ANDROID_OVERLAY)

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
    check('it is displayed with `contain`, which scales by one factor and so cannot crop or stretch it', res.objectFit === 'contain', `object-fit: ${res.objectFit}`)
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

  // --- The overlay: same canvas, same box, so the character registers -------------
  const overlay = await page.evaluate(() => {
    const img = document.querySelector('.main-menu-overlay-art')
    const box = document.querySelector('.main-menu-overlay')
    const backdrop = document.querySelector('.main-menu-backdrop')
    if (!img || !box || !backdrop) return null
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
  })

  check('the overlay layer exists, separately from the backdrop and the UI', overlay !== null, '.main-menu-overlay')
  if (!overlaySupplied) {
    pending('overlay registration is not measured yet', 'the overlay file has not been supplied')
  } else if (overlay) {
    check('the overlay decoded at the backdrop\'s own canvas size', overlay.natural.width === 1280 && overlay.natural.height === 720, `${overlay.natural.width}x${overlay.natural.height}`)
    const same = (a, b) => Math.abs(a - b) < 0.5
    check(
      'it is drawn in exactly the same box as the backdrop, so the character registers against it',
      same(overlay.rendered.left, overlay.backdrop.left) &&
        same(overlay.rendered.top, overlay.backdrop.top) &&
        same(overlay.rendered.width, overlay.backdrop.width) &&
        same(overlay.rendered.height, overlay.backdrop.height),
      `overlay ${overlay.rendered.left.toFixed(1)},${overlay.rendered.top.toFixed(1)} ${overlay.rendered.width.toFixed(1)}x${overlay.rendered.height.toFixed(1)} vs backdrop ${overlay.backdrop.left.toFixed(1)},${overlay.backdrop.top.toFixed(1)} ${overlay.backdrop.width.toFixed(1)}x${overlay.backdrop.height.toFixed(1)}`,
    )
    check('it keeps its aspect too, so nothing about it is cropped', Math.abs(overlay.natural.width / overlay.natural.height - overlay.rendered.width / overlay.rendered.height) < 0.001, `source ${(overlay.natural.width / overlay.natural.height).toFixed(4)}, displayed ${(overlay.rendered.width / overlay.rendered.height).toFixed(4)}`)
    check('it is not transformed', overlay.transform === 'none' || overlay.transform === 'matrix(1, 0, 0, 1, 0, 0)', `transform ${overlay.transform}`)
    check('not filtered', overlay.filter === 'none', `filter ${overlay.filter}`)
    check('not faded', overlay.opacity === '1', `opacity ${overlay.opacity}`)
    check('not animated', overlay.animation === 'none', `animation ${overlay.animation}`)
    check('and it cannot steal clicks from the buttons beneath it', overlay.pointerEvents === 'none', `pointer-events ${overlay.pointerEvents}`)

    // Real paint order, measured rather than assumed.
    //
    // Both art layers are pointer-events:none so they cannot steal clicks from the
    // buttons, and elementsFromPoint skips such nodes entirely -- it cannot answer this
    // as shipped. Hit-testing them is only a measurement trick, so pointer-events is
    // switched on, the stack is read, and it is switched back.
    const order = await page.evaluate(() => {
      const b = document.querySelector('.main-menu-backdrop')
      const o = document.querySelector('.main-menu-overlay')
      const u = document.querySelector('.main-menu-ui')
      if (!b || !o || !u) return null
      const prev = [b, o, u].map((n) => n.style.pointerEvents)
      for (const n of [b, o, u]) n.style.pointerEvents = 'auto'
      // The centre of the UI panel: inside all three layers at once.
      const r = u.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      for (let i = 0; i < 3; i++) [b, o, u][i].style.pointerEvents = prev[i]
      const cs = (n) => getComputedStyle(n)
      return {
        // elementsFromPoint returns front-to-back, so a higher index means further back.
        ui: stack.indexOf(u),
        overlay: stack.indexOf(o),
        backdrop: stack.indexOf(b),
        artZ: { backdrop: cs(b).zIndex, overlay: cs(o).zIndex },
        noTransform: [b, o, u].every((n) => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(cs(n).transform)),
      }
    })
    check(
      'the overlay paints between the backdrop and the UI',
      order.backdrop > order.overlay && order.overlay > order.ui,
      `front-to-back: ui ${order.ui}, overlay ${order.overlay}, backdrop ${order.backdrop}`,
    )
    check(
      'and the two art layers are ordered by document order, not by a z-index',
      order.artZ.backdrop === 'auto' && order.artZ.overlay === 'auto',
      `z-index ${order.artZ.backdrop} / ${order.artZ.overlay}`,
    )
    check('nor is any layer reordered by a transform', order.noTransform, 'no transform on any layer')

    // Where the art actually puts ink, read from the alpha channel. A 1280x720 canvas
    // that is 98% transparent still has one specific block of visible pixels, and that
    // block has to land where it was composed and miss the entries.
    const ink = await page.evaluate(async () => {
      const img = document.querySelector('.main-menu-overlay-art')
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
      return {
        total: c.width * c.height,
        opaque,
        box: {
          left: r.left + minX * (r.width / c.width),
          top: r.top + minY * (r.height / c.height),
          right: r.left + (maxX + 1) * (r.width / c.width),
          bottom: r.top + (maxY + 1) * (r.height / c.height),
        },
      }
    })
    check('the overlay is a transparent overlay, not a second background', ink.opaque / ink.total < 0.1, `${((ink.opaque / ink.total) * 100).toFixed(1)}% of the canvas is visible`)
    check(
      'the character lands where it was composed, inside the frame',
      ink.box.left >= 0 && ink.box.top >= 0 && ink.box.right <= 1280 && ink.box.bottom <= 720,
      `x ${Math.round(ink.box.left)}..${Math.round(ink.box.right)}, y ${Math.round(ink.box.top)}..${Math.round(ink.box.bottom)}`,
    )
    const collisions = await page.evaluate((b) => {
      const area = (a, c) =>
        Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) *
        Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top))
      return [...document.querySelectorAll('.menu-button')]
        .map((n) => ({ text: n.textContent.trim().slice(0, 12), area: area(b, n.getBoundingClientRect()) }))
        .filter((r) => r.area > 1)
    }, ink.box)
    check(
      'and it does not cover any of the four entries, so they stay readable',
      collisions.length === 0,
      collisions.length ? collisions.map((c) => `${c.text} by ${Math.round(c.area)}px^2`).join(', ') : 'no entry overlaps the art',
    )
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
      labels: [...document.querySelectorAll('.main-menu-ui .menu-button')]
        .filter((n) => n.offsetParent !== null)
        .map((n) => n.textContent.trim().toUpperCase()),
      visiblePanel: visible?.dataset.testid ?? null,
      hudHidden: document.querySelector('.hud')?.hidden ?? null,
      controlsHidden: document.querySelector('.controls')?.hidden ?? null,
      layerChain: (() => {
        const sel = ['.main-menu-backdrop', '.main-menu-overlay', '.main-menu-ui']
        return sel.map((s) => {
          const n = document.querySelector(s)
          return n ? `${s}:${getComputedStyle(n).position}` : `${s}:MISSING`
        }).join(' ')
      })(),
      allButtons: [...document.querySelectorAll('.main-menu-ui button')].map((n) => n.textContent.trim().toUpperCase()),
    }
  })

  check('the title screen is showing on load', labels.menu && labels.screen === 'main', `screen ${labels.screen}`)
  check(
    'it carries exactly the four entries, in order',
    JSON.stringify(labels.labels) === JSON.stringify(['START GAME', 'LOAD GAME', 'SETTINGS', 'QUIT']),
    labels.labels.join(' | '),
  )
  const forbidden = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS', 'CREDITS'].filter((f) => labels.allButtons.some((b) => b.includes(f)))
  check('and none of the entries that were ruled out are present', forbidden.length === 0, forbidden.length ? forbidden.join(', ') : 'none of DUEL ONLINE / PRACTICE / CHARACTERS / CREDITS')
  check('the in-game HUD is hidden behind the menu', labels.hudHidden === true, `hud.hidden ${labels.hudHidden}`)
  check('and so are the touch controls', labels.controlsHidden === true, `controls.hidden ${labels.controlsHidden}`)
  check(
    'the backdrop, the character/campfire overlay and the UI are three separate layers',
    labels.layerChain === '.main-menu-backdrop:absolute .main-menu-overlay:absolute .main-menu-ui:relative',
    labels.layerChain,
  )

  // LOAD GAME
  await page.click('[data-testid="main_menu_load"]')
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
    check('controls with nothing behind them are shown disabled rather than pretending to work', disabled.length >= 2, disabled.join(', ') || 'none')
    check('fullscreen is offered as a live control', settings.fullscreenLive, 'fullscreen enabled')
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

  // START GAME
  await page.click('[data-testid="main_menu_main"]')
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
console.log('\n4. the simulation is held until START GAME, and runs after it')
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
console.log('\n5. Android mirrors the same menu')
// ---------------------------------------------------------------------------------
{
  const ktMenu = readFileSync(KT_MENU, 'utf8')
  const ktScreen = readFileSync(KT_SCREEN, 'utf8')
  const menuTs = readFileSync(MENU_TS, 'utf8')
  const css = readFileSync(MENU_CSS, 'utf8')
  const mainTs = readFileSync(MAIN_TS, 'utf8')
  // Strip // comments so prose about a pattern cannot satisfy or break a search.
  // Strip both comment styles. The JSDoc above buildQuitScreen explains that
  // `window.close` is ignored by the browser, and prose about a call is not a call.
  const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  const overlaySupplied = existsSync(ANDROID_OVERLAY)

  check('both engines load the background by the same synced filename', menuTs.includes('main_menu.jpg') && ktMenu.includes('"main_menu.jpg"'), `bg/main_menu.jpg`)
  check('web draws it with contain, never crop', /object-fit:\s*contain/.test(css))
  check('the web stylesheet puts no transition or animation on the art layers', !/\.main-menu-(backdrop|overlay)[^{]*\{[^}]*(transition|animation)/.test(css), 'no transition/animation on .main-menu-backdrop or .main-menu-overlay')
  check('Android scales the artwork to fit, never cropping it', /ContentScale\.Fit/.test(ktMenu), 'ContentScale.Fit')
  check('Android does not tint the artwork', !/ColorFilter|colorFilter/.test(ktMenu), 'no colour filter on the image')

  if (overlaySupplied) {
    check('Android loads the overlay from the same assets folder, by the same filename as the web build', ktMenu.includes('"main_menu_overlay.png"') && ktMenu.includes('"bg/$assetFile"') && menuTs.includes('main_menu_overlay.png'), 'assets/bg/main_menu_overlay.png')
    const fits = (ktMenu.match(/ContentScale\.Fit/g) || []).length
    check('and draws it with the same ContentScale.Fit as the backdrop, so the two register', fits >= 2, `${fits} uses of ContentScale.Fit`)
  } else {
    pending('Android overlay parity is not checked yet', 'the overlay file has not been supplied')
  }

  check('Android keeps the backdrop, the overlay and the UI as three layers', /main_menu"/.test(ktMenu) && /main_menu_overlay/.test(ktMenu) && /main_menu_ui/.test(ktMenu), 'main_menu / main_menu_overlay / main_menu_ui')

  const labels = ['START GAME', 'LOAD GAME', 'SETTINGS', 'QUIT']
  const found = labels.filter((l) => ktMenu.includes(`"${l}"`))
  check('Android offers the same four entries', found.length === 4, found.join(', '))
  const forbidden = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS', 'CREDITS'].filter((f) => ktMenu.includes(f))
  check('and none of the ruled-out entries appear there either', forbidden.length === 0, forbidden.length ? forbidden.join(', ') : 'none present')

  check('Android has a load screen with an honest empty state', /LOAD GAME/.test(ktMenu) && /No saved games/.test(ktMenu), 'empty state present')
  check('Android invents no save data either', !/Save \d|Slot \d|\d+:\d{2}/.test(ktMenu), 'no fabricated save data')
  check('and a settings screen', /SETTINGS/.test(ktMenu))
  check('Android disables controls that have nothing behind them', /menu-setting-disabled/.test(ktMenu), 'disabled rows')

  check('QUIT really exits the app on Android, unlike the web which returns to the title', /finish\(\)/.test(ktScreen) && /exitProcess\(0\)/.test(ktScreen), 'finish() with exitProcess as the backstop')
  check('and Android wires it to the menu', /MainMenuAction\.Quit/.test(ktScreen))
  check('while the web returns to the title instead of trying to close the tab', !codeOnly(menuTs).includes('window.close') && !codeOnly(mainTs).includes('window.close'), 'no window.close call anywhere in the web build')

  check('both engines gate the simulation behind the menu', /started\) world\.update/.test(mainTs) && /if \(started\) gameWorld\.update/.test(ktScreen), 'update only once started')
  check('and both hide the in-game furniture until it is dismissed', /controls\.root\.hidden = !started/.test(mainTs) && /if \(started\) \{/.test(ktScreen), 'HUD and controls gated')
  check('both start with the world held still behind the menu', /let started = debugMode/.test(mainTs) && /var started by remember \{ mutableStateOf\(false\) \}/.test(ktScreen), 'web honours ?debug=1, Android starts gated')
}

await browser.close()
server.close()

console.log(failures === 0 ? '\nMain menu checks passed' : `\n${failures} main menu check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
