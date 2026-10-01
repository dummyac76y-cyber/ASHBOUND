import { UI_FONT_FAMILY, UI_FONT_FILE, assetUrl } from '../assetUrl'

/**
 * Installs the supplied UI font, Pixelta, as a `@font-face` rule built at runtime.
 *
 * From script rather than from the stylesheet for one reason: the font has to be requested
 * through `assetUrl`, like every other asset in this project. A `url()` written into
 * style.css is a fixed string, so swapping the bytes behind the font would leave the request
 * identical and every cache would go on serving the old file -- the exact failure the
 * fingerprint manifest exists to prevent. Injecting the rule means the stylesheet needs no
 * knowledge of the path and the deploy base is still honoured.
 *
 * Also sets `--ui-font-family` rather than writing `font-family` onto anything, so the
 * stylesheet can declare one rule and decide per element whether the pixel font is right.
 * For a face with no bold in the file, `bold` here is a synthetic emboldening the browser
 * applies; the stylesheet leans on size and letter-spacing instead of weight for the menu.
 *
 * Returns whether the font is actually usable. A missing or unreadable file is not fatal --
 * the stack falls back to the system face and the game looks slightly less deliberate --
 * but the caller is told, because a silently absent font is very hard to notice.
 */
export async function installUiFont(): Promise<boolean> {
  const root = document.documentElement

  // Before anything is drawn, so the menu's first paint is already in the right face rather
  // than flashing the system font and swapping a frame later.
  const style = document.createElement('style')
  style.dataset.testid = 'ui_font_face'
  style.textContent =
    `@font-face {\n` +
    `  font-family: '${UI_FONT_FAMILY}';\n` +
    `  src: url('${assetUrl(UI_FONT_FILE)}') format('truetype');\n` +
    `  font-display: swap;\n` +
    `  font-weight: 100 900;\n` +
    `  font-style: normal;\n` +
    `}`
  document.head.append(style)
  root.style.setProperty('--ui-font-family', `'${UI_FONT_FAMILY}', ${FALLBACK_STACK}`)

  // The variable is set either way, so the fallback is declared in one place rather than
  // being repeated in every rule that wants the font.
  if (typeof document.fonts === 'undefined') return false
  try {
    // `check()` rather than `load()`: load() forces the download even if nothing on the page
    // uses the family yet, which would be a wasted 49KB before the menu is even built.
    await document.fonts.check(`16px '${UI_FONT_FAMILY}'`)
    return true
  } catch {
    return false
  }
}

/**
 * What the pixel font falls back to.
 *
 * The monospace stack is deliberate rather than the UI stack: Pixelta is a fixed-width pixel
 * face, so falling back to a proportional system font would change the measured width of
 * every label and the menu column would reflow when the font lands. Monospace keeps the
 * layout stable whether or not the supplied file is there, which is the same reason the
 * debug panels already use one.
 */
const FALLBACK_STACK = "ui-monospace, 'Courier New', monospace"