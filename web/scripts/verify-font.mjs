/**
 * Font parity: the two engines must name the same face.
 *
 * Pixelta is a supplied asset like any other, and the failure it has to avoid is the same one
 * `verify-parity.mjs` exists for with sprite geometry: the two implementations are transcribed
 * rather than shared, so nothing stops Android and the web quietly ending up on different
 * faces. That is invisible in a diff and obvious on screen -- the menu stops matching itself
 * between platforms.
 *
 * Both engines name the family from one string, so the check is that both files carry it and
 * that the file they point at is the same file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ASSET_URL = readFileSync(join(ROOT, 'web/src/assetUrl.ts'), 'utf8')
const UI_FONT = readFileSync(join(ROOT, 'web/src/ui/uiFont.ts'), 'utf8')
const MAIN_TS = readFileSync(join(ROOT, 'web/src/main.ts'), 'utf8')
const CSS = readFileSync(join(ROOT, 'web/src/style.css'), 'utf8')
const KT_TYPE = readFileSync(join(ROOT, 'app/src/main/java/com/example/ui/theme/Type.kt'), 'utf8')
const KT_MENU = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/ui/MainMenu.kt'),
  'utf8',
)
const SYNC = readFileSync(join(ROOT, 'web/scripts/sync-assets.mjs'), 'utf8')

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`)
  }
}
function section(title) {
  console.log(`\n${title}`)
}

/**
 * The family name as declared inside the font file itself, read from the `name` table.
 *
 * Not from either engine's source: a browser matches `@font-face` on the name in the file,
 * not on whatever the stylesheet calls it, so a typo in either source would leave a rule
 * pointing at a face that does not exist and the page would silently fall back.
 */
function fontFamilyName(path) {
  const d = readFileSync(path)
  const numTables = d.readUInt16BE(4)
  let nameOff = 0
  let nameLen = 0
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    if (d.toString('latin1', o, o + 4) === 'name') {
      nameOff = d.readUInt32BE(o + 8)
      nameLen = d.readUInt32BE(o + 12)
    }
  }
  if (!nameLen) throw new Error(`${path}: no name table`)
  const count = d.readUInt16BE(nameOff + 2)
  const strOff = nameOff + d.readUInt16BE(nameOff + 4)
  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12
    const platformId = d.readUInt16BE(r)
    const nameId = d.readUInt16BE(r + 6)
    const len = d.readUInt16BE(r + 8)
    const off = d.readUInt16BE(r + 10)
    if (nameId !== 1) continue
    const raw = d.subarray(strOff + off, strOff + off + len)
    return platformId === 3 ? raw.toString('utf16le').replace(/(.)(.)/g, '$2$1') : raw.toString('latin1')
  }
  throw new Error(`${path}: no family name in the name table`)
}

section('The supplied font')
const webFont = join(ROOT, 'app/src/main/assets/fonts/Pixelta.ttf')
const androidFont = join(ROOT, 'app/src/main/res/font/pixelta.ttf')
check('the font lives in assets/fonts so sync-assets can see it', existsSync(webFont))
check('and in res/font for Android', existsSync(androidFont))
check(
  'both engines ship the same bytes',
  existsSync(webFont) &&
    existsSync(androidFont) &&
    readFileSync(webFont).equals(readFileSync(androidFont)),
  'one copy per platform, identical',
)
// The whitelist is a single regex literal in the copy loop; find it and read the extensions
// off it rather than slicing the file around a marker.
const wl = SYNC.match(/else if \(\/\\\.\(([^)]*)\)/)
check(
  'sync-assets copies fonts, or the web @font-face would 404',
  !!wl && /ttf/i.test(wl[1]),
  wl ? `whitelist: ${wl[1]}` : 'no extension whitelist found',
)

const family = existsSync(webFont) ? fontFamilyName(webFont) : null
check('the font declares a family name', family !== null, String(family))
check('the file is a TrueType sfnt', existsSync(webFont) && readFileSync(webFont).readUInt32BE(0) === 0x00010000)

section('One family name on both engines')
check('the web declares the family from one constant', /UI_FONT_FAMILY\s*=\s*'Pixelta'/.test(ASSET_URL))
check('Android declares the same family name', new RegExp(`FONT_FAMILY_NAME\\s*=\\s*"${family ?? 'Pixelta'}"`).test(KT_TYPE))
check(
  'and the name in the file is the name both engines use',
  family === 'Pixelta',
  `file says ${family}`,
)

section('The font is actually applied')
check('the web installs an @font-face at runtime, through assetUrl', /@font-face/.test(UI_FONT) && /assetUrl\(UI_FONT_FILE\)/.test(UI_FONT))
check('the web requests the font before the first paint', /await installUiFont\(\)/.test(MAIN_TS))
check('the web sets a family custom property', /--ui-font-family/.test(UI_FONT) && /--ui-font-family/.test(CSS))
check('the menu text uses it', (CSS.match(/font-family:\s*var\(--ui-font-family\)/g) ?? []).length >= 4)
check('Android binds the resource to a FontFamily', /FontFamily\(\s*Font\(R\.font\.pixelta/.test(KT_TYPE))
check('Android provides it around the menu panels', /LocalTextStyle provides LocalTextStyle\.current\.copy\(fontFamily = Pixelta\)/.test(KT_MENU))
check('and the title, which sits outside that provider', (KT_MENU.match(/fontFamily = Pixelta/g) ?? []).length >= 2)
check(
  'a missing font is survivable on the web, not a throw',
  /falling back to the monospace stack/.test(MAIN_TS),
)
check(
  'the fallback stack is fixed width, so the menu cannot reflow when the font lands',
  /ui-monospace/.test(UI_FONT) && /ui-monospace/.test(CSS),
)

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} of ${checks} checks FAILED`}`)
process.exit(failures === 0 ? 0 : 1)