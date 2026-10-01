import { assetUrl } from '../assetUrl'

/**
 * The Ashbound main menu.
 *
 * Three things stack here and it matters that they stay three things:
 *
 * Back to front, which is the required stack:
 *
 *   1. `.main-menu-backdrop`  the supplied background artwork
 *   2. `.main-menu-overlay`   the character, on its own transparent canvas
 *   3. `.main-menu-campfire`  the campfire, on its own transparent canvas
 *   4. `.main-menu-ui`        the title, the entries, and the sub-screens
 *
 * Keeping the artwork out of the UI layer is what lets the art stay exactly as
 * supplied. If the character were baked into the background, or drawn by the UI
 * layer, then restyling the menu would mean re-touching supplied art -- and the
 * moment a background-size or a flex rule moved the text, the character would no
 * longer stand where it was composed. Nothing here transforms, filters, tints or
 * animates either layer.
 */

/** The backdrop artwork. Declared once so both engines can be checked against it. */
export const MAIN_MENU_BACKGROUND_FILE = 'main_menu.jpg'

export const MAIN_MENU_BACKGROUND_URL = assetUrl(`bg/${MAIN_MENU_BACKGROUND_FILE}`)

/**
 * The character/campfire overlay: a transparent 1280x720 canvas the same size as the
 * backdrop, with the art already positioned inside it.
 *
 * Because it is the same canvas size, drawing it in the same box with the same
 * scaling as the backdrop is what makes it register: the two are scaled by one factor
 * between them, so the character lands exactly where it was composed against the
 * background. Any other arrangement -- a different scale, a percentage offset, a
 * `background-size` on a differently-sized box -- would drift.
 */
export const MAIN_MENU_OVERLAY_FILE = 'main_menu_overlay.png'

export const MAIN_MENU_OVERLAY_URL = assetUrl(`bg/${MAIN_MENU_OVERLAY_FILE}`)

/**
 * The campfire, as its own transparent 1280x720 canvas like the character.
 *
 * Its visible ink sits at x 680..819, immediately left of the character's x 826..999, so
 * the two share no pixel today and stand side by side. The order between them is not
 * incidental, though: the stack is background -> character -> campfire -> buttons, so the
 * campfire draws in front of the character. That ordering is currently invisible; it is
 * stated here so a future revision of either canvas lands on the intended stack rather
 * than on whatever happens to be measured.
 */
export const MAIN_MENU_CAMPFIRE_FILE = 'main_menu_campfire.png'

export const MAIN_MENU_CAMPFIRE_URL = assetUrl(`bg/${MAIN_MENU_CAMPFIRE_FILE}`)

/**
 * The supplied button artwork.
 *
 * Each entry is its own 1280x720 transparent canvas holding one pre-composed plate,
 * already positioned against the background -- the same arrangement as the character
 * and the campfire. `box` is the plate's visible bounds measured from the file's alpha
 * channel, in canvas pixels. Those bounds are what place the artwork (the image is drawn
 * across the whole canvas) and what place the clickable hit area over it.
 *
 * The labels are part of the artwork, so no text is drawn over the plates; each button
 * carries an accessible name instead.
 */
export interface MenuButtonArt {
  readonly id: string
  readonly label: string
  readonly file: string
  readonly box: { x: number; y: number; w: number; h: number }
}

export const MENU_BUTTON_ART: readonly MenuButtonArt[] = [
  { id: 'start_game', label: 'START GAME', file: 'start_game.png', box: { x: 83, y: 130, w: 332, h: 113 } },
  { id: 'load_game', label: 'LOAD GAME', file: 'load_game.png', box: { x: 80, y: 266, w: 335, h: 114 } },
  { id: 'settings', label: 'SETTINGS', file: 'settings.png', box: { x: 80, y: 403, w: 335, h: 107 } },
  { id: 'quit', label: 'QUIT', file: 'quit.png', box: { x: 83, y: 540, w: 332, h: 107 } },
  { id: 'credits', label: 'CREDITS', file: 'credits.png', box: { x: 1196, y: 33, w: 52, h: 58 } },
]

/** Which screen the menu is showing. The entries live on `main`. */
export type MenuScreen = 'main' | 'load' | 'settings' | 'quit' | 'credits'

/** Every supplied menu canvas is this size, as is the backdrop. */
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720

/**
 * The four entries, in order. This list is the menu's contract: the verifier asserts
 * these labels appear, in this order, and that none of the ruled-out entries do.
 */
export const MAIN_ENTRIES: ReadonlyArray<{ label: string; screen: MenuScreen }> = [
  { label: 'START GAME', screen: 'main' },
  { label: 'LOAD GAME', screen: 'load' },
  { label: 'SETTINGS', screen: 'settings' },
  { label: 'QUIT', screen: 'quit' },
]

/** Turns canvas-pixel bounds into percentages of the artwork box. */
function boxToPercent(box: { x: number; y: number; w: number; h: number }): string {
  return [
    `left:${(box.x / CANVAS_WIDTH) * 100}%`,
    `top:${(box.y / CANVAS_HEIGHT) * 100}%`,
    `width:${(box.w / CANVAS_WIDTH) * 100}%`,
    `height:${(box.h / CANVAS_HEIGHT) * 100}%`,
  ].join(';')
}

/**
 * The same box, anchored to the right edge instead of the left.
 *
 * The credits control lives in the top-right corner, and it is the control that needs its
 * hit area grown to stay tappable. A minimum size on a left-anchored box grows to the
 * right, which runs the target off the side of the frame; on a phone viewport the plate is
 * only about ten pixels from that edge. Anchoring the right edge makes the growth go
 * inward, so the control stays on screen and stays under the finger at every viewport.
 */
function boxToPercentFromRight(box: { x: number; y: number; w: number; h: number }): string {
  return [
    `right:${100 - ((box.x + box.w) / CANVAS_WIDTH) * 100}%`,
    `top:${(box.y / CANVAS_HEIGHT) * 100}%`,
    `width:${(box.w / CANVAS_WIDTH) * 100}%`,
    `height:${(box.h / CANVAS_HEIGHT) * 100}%`,
  ].join(';')
}

/**
 * Entries that were considered and explicitly ruled out. Never add these.
 *
 * CREDITS was on this list and has been removed: the supplied artwork includes a credits
 * control, and the user identified it as such. That reverses an earlier instruction, so
 * it is called out here and in the verifier rather than being quietly absorbed -- if it
 * was a misidentification, put it back.
 */
export const FORBIDDEN_ENTRIES: readonly string[] = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS']

export interface MainMenuHandlers {
  /** START GAME. Called once; the caller is expected to tear the menu down. */
  onStart: () => void
  /**
   * QUIT.
   *
   * On the web a tab cannot close itself, so the caller returns to the title instead.
   * On Android this is where the activity finishes.
   */
  onQuit: () => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class MainMenu {
  readonly root: HTMLDivElement

  /** Layer 1. The supplied artwork. */
  private readonly backdrop: HTMLImageElement
  /** Layer 2's element, kept separate from the image so the layer can exist alone. */
  private readonly overlay: HTMLElement
  /** Layer 2. The character overlay. */
  private readonly overlayImage: HTMLImageElement
  /** Layer 3's element, kept separate from the image like layer 2's. */
  private readonly campfire: HTMLElement
  /** Layer 3. The campfire overlay. */
  private readonly campfireImage: HTMLImageElement
  /** Layer 4. Everything the player reads or clicks. */
  private readonly ui: HTMLDivElement

  private readonly screens = new Map<MenuScreen, HTMLElement>()
  /** The supplied plates and their hit areas. Shown on the title screen only. */
  private readonly artButtons: HTMLElement
  /** Every supplied plate image, so the menu can wait for them before revealing itself. */
  private readonly artImages: HTMLImageElement[] = []
  private readonly fullscreenValue: HTMLSpanElement
  private screen: MenuScreen = 'main'

  constructor(handlers: MainMenuHandlers) {
    this.backdrop = new Image()
    this.backdrop.className = 'main-menu-backdrop'
    this.backdrop.alt = ''
    this.backdrop.decoding = 'async'
    this.backdrop.draggable = false
    this.backdrop.dataset.testid = 'main_menu_backdrop'
    this.backdrop.src = MAIN_MENU_BACKGROUND_URL

    this.overlayImage = new Image()
    this.overlayImage.className = 'main-menu-overlay-art'
    this.overlayImage.alt = ''
    this.overlayImage.decoding = 'async'
    this.overlayImage.draggable = false
    this.overlayImage.src = MAIN_MENU_OVERLAY_URL

    this.overlay = el('div', 'main-menu-overlay')
    this.overlay.dataset.testid = 'main_menu_overlay'
    // Decoration only: the buttons live above it and must never lose a click to it.
    this.overlay.setAttribute('aria-hidden', 'true')
    this.overlay.append(this.overlayImage)

    // Same canvas size and the same box as the backdrop, for the same reason.
    this.campfireImage = new Image()
    this.campfireImage.className = 'main-menu-campfire-art'
    this.campfireImage.alt = ''
    this.campfireImage.decoding = 'async'
    this.campfireImage.draggable = false
    this.campfireImage.src = MAIN_MENU_CAMPFIRE_URL

    this.campfire = el('div', 'main-menu-campfire')
    this.campfire.dataset.testid = 'main_menu_campfire'
    this.campfire.setAttribute('aria-hidden', 'true')
    this.campfire.append(this.campfireImage)

    this.ui = el('div', 'main-menu-ui')
    this.ui.dataset.testid = 'main_menu_ui'

    this.fullscreenValue = el('span', 'menu-setting-value')

    this.buildMainScreen()
    this.buildLoadScreen()
    this.buildSettingsScreen()
    this.buildQuitScreen(handlers)
    this.buildCreditsScreen()
    this.artButtons = this.buildArtButtons(handlers)

    // Every screen is mounted up front and switched with `hidden`, rather than built on
    // demand. Each screen is a fixed piece of markup, so there is nothing to save by
    // deferring it -- and having them all present means switching screens cannot fail
    // halfway and leave the menu with no way back.
    for (const screen of this.screens.values()) this.ui.append(screen)
    // The plates belong to the title screen only: a sub-screen is a panel of text, and
    // leaving four plates showing underneath it would be two overlapping UIs.
    this.ui.append(this.artButtons)

    this.root = el('div', 'main-menu')
    this.root.dataset.testid = 'main_menu'
    // The stack, back to front: background, character, campfire, buttons. Appended in
    // exactly this order so paint order follows from document order and nothing has to
    // be kept in sync by hand-tuned z-index values.
    this.root.append(this.backdrop, this.overlay, this.campfire, this.ui)

    this.show('main')
    this.syncFullscreenLabel()

    // Leaving the menu by other means (Esc, the browser's own fullscreen gesture)
    // still has to leave the label truthful.
    document.addEventListener('fullscreenchange', () => this.syncFullscreenLabel())
  }

  /** The title. The four entries are supplied artwork; see `buildArtButtons`. */
  private buildMainScreen(): void {
    // The title sits above the first plate, which starts at y=130, aligned to the plates'
    // own left edge at x=83. Positioned in canvas percentages so it stays put relative
    // to the supplied artwork at any scale, exactly as the plates do.
    const screen = el('div', 'menu-title-block')
    screen.dataset.testid = 'main_menu_screen_main'
    screen.append(el('h1', 'menu-title', 'ASHBOUND'))
    screen.append(el('p', 'menu-subtitle', 'A knight without a kingdom'))
    this.screens.set('main', screen)
  }

  /**
   * The supplied plates, and a clickable area over each.
   *
   * The artwork carries its own label, so nothing is drawn on top of it; each button is a
   * transparent element sitting exactly over its plate, carrying the accessible name that
   * the baked-in label cannot.
   *
   * The hit area is the plate's measured bounds plus a small outset. Pixel-exact bounds
   * would be correct but unforgiving: the visible edge of a plate is where its border
   * starts fading, and a few pixels of slop either side is what stops a press near the
   * edge of a button from falling through to the artwork behind it.
   */
  private buildArtButtons(handlers: MainMenuHandlers): HTMLElement {
    const container = el('div', 'menu-art-buttons')
    container.dataset.testid = 'main_menu_art_buttons'

    for (const [index, art] of MENU_BUTTON_ART.entries()) {
      const image = new Image()
      image.className = 'menu-art-button'
      image.alt = ''
      image.decoding = 'async'
      image.draggable = false
      image.dataset.testid = `main_menu_art_${art.id}`
      image.src = assetUrl(`bg/menu_buttons/${art.file}`)
      this.artImages.push(image)
      // Deliberately NOT sized to the plate. The image spans the whole canvas, the same
      // as the character and campfire, and the plate lands where the artwork puts it.
      // Sizing the element to the plate would shrink the canvas and move the plate.

      const button = el('button', 'menu-art-hit')
      button.type = 'button'
      button.dataset.testid = `main_menu_${art.id}`
      button.dataset.index = String(index)
      button.setAttribute('aria-label', art.label)
      const outset = 4
      const outsetBox = {
        x: art.box.x - outset,
        y: art.box.y - outset,
        w: art.box.w + outset * 2,
        h: art.box.h + outset * 2,
      }
      button.style.cssText =
        art.id === 'credits' ? boxToPercentFromRight(outsetBox) : boxToPercent(outsetBox)
      button.addEventListener('click', () => {
        if (art.id === 'start_game') {
          // Leave before starting: the world is about to own the screen, and a menu
          // left mounted on top of it would keep swallowing input.
          this.dispose()
          handlers.onStart()
          return
        }
        this.show(art.id === 'load_game' ? 'load' : art.id === 'quit' ? 'quit' : (art.id as MenuScreen))
      })

      container.append(image, button)
    }
    return container
  }

  /**
   * CREDITS.
   *
   * Reached from the supplied corner control. This reverses an earlier instruction that
   * ruled credits out; the artwork supplies the control and the user identified it, so it
   * is wired up rather than left as decoration that looks clickable and does nothing.
   */
  private buildCreditsScreen(): void {
    const screen = el('div', 'menu-panel')
    screen.dataset.testid = 'main_menu_screen_credits'
    screen.append(el('h2', 'menu-heading', 'CREDITS'))
    screen.append(
      el(
        'p',
        'menu-subtitle',
        'Ashbound is built on the Exiled Knight engine. Artwork supplied directly by the project.',
      ),
    )
    screen.append(this.backButton())
    this.screens.set('credits', screen)
  }

  /**
   * LOAD GAME.
   *
   * There is no save system yet, so this says so. The alternative -- a plausible-looking
   * slot with a timestamp and a thumbnail -- would be worse than useless: a player would
   * load it, find nothing behind it, and have no way to tell that the menu had lied.
   */
  private buildLoadScreen(): void {
    const screen = el('div', 'menu-panel menu-panel-wide')
    screen.dataset.testid = 'main_menu_screen_load'
    screen.append(el('h2', 'menu-heading', 'LOAD GAME'))
    screen.append(el('div', 'menu-empty', 'No saved games'))
    screen.append(
      el(
        'p',
        'menu-empty-reason',
        'Saving has not been implemented yet, so there is nothing to load. Your progress will appear here once it can be kept.',
      ),
    )
    screen.append(this.backButton())
    this.screens.set('load', screen)
  }

  private buildSettingsScreen(): void {
    const screen = el('div', 'menu-panel menu-panel-wide')
    screen.dataset.testid = 'main_menu_screen_settings'
    screen.append(el('h2', 'menu-heading', 'SETTINGS'))

    const rows = el('div', 'menu-rows')
    // Music and sound are disabled rather than absent, so the screen reads as a
    // settings screen that is not finished yet instead of an empty box.
    rows.append(this.settingRow('MUSIC', 'AWAITING AUDIO ASSETS', true))
    rows.append(this.settingRow('SOUND EFFECTS', 'AWAITING AUDIO ASSETS', true))

    const fullscreen = el('button', 'menu-setting')
    fullscreen.type = 'button'
    fullscreen.dataset.testid = 'main_menu_fullscreen'
    fullscreen.append(el('span', 'menu-setting-label', 'FULLSCREEN'), this.fullscreenValue)
    fullscreen.addEventListener('click', () => void this.toggleFullscreen())
    rows.append(fullscreen)

    screen.append(rows)
    screen.append(this.backButton())
    this.screens.set('settings', screen)
  }

  /**
   * QUIT.
   *
   * On the web this cannot close the tab -- `window.close` is ignored for pages that
   * did not open them -- so rather than offering a button that silently does nothing,
   * the web build says what actually happened and offers the way back.
   */
  private buildQuitScreen(handlers: MainMenuHandlers): void {
    const screen = el('div', 'menu-panel')
    screen.dataset.testid = 'main_menu_screen_quit'
    screen.append(el('h2', 'menu-heading', 'THANKS FOR PLAYING'))
    screen.append(
      el('p', 'menu-subtitle', 'A browser tab cannot close itself, so this is where leaving ends up. On Android, QUIT closes the app.'),
    )
    const back = this.backButton('BACK TO TITLE')
    back.addEventListener('click', handlers.onQuit)
    screen.append(back)
    this.screens.set('quit', screen)
  }

  private backButton(label = 'BACK'): HTMLButtonElement {
    const button = el('button', 'menu-button menu-button-ghost menu-button-wide', label)
    button.type = 'button'
    button.dataset.testid = 'main_menu_back'
    button.addEventListener('click', () => this.show('main'))
    return button
  }

  private settingRow(label: string, value: string, disabled: boolean): HTMLElement {
    const row = el('div', `menu-setting${disabled ? ' menu-setting-disabled' : ''}`)
    row.append(el('span', 'menu-setting-label', label), el('span', 'menu-setting-value', value))
    return row
  }

  /** Switches screens. The layer structure above is untouched by this. */
  show(screen: MenuScreen): void {
    this.screen = screen
    this.root.dataset.screen = screen
    for (const [name, node] of this.screens) {
      node.hidden = name !== screen
    }
    // The plates are part of the title screen. Showing them behind a sub-screen's panel
    // would be two UIs at once, and the hit areas would still be live underneath it.
    this.artButtons.hidden = screen !== 'main'
  }

  /** The screen currently shown. Exposed for verification. */
  get currentScreen(): MenuScreen {
    return this.screen
  }

  /**
   * Reveals the menu once the artwork has decoded.
   *
   * The menu is held hidden until then. Fading it in over a half-drawn backdrop would
   * show a flash of the menu with no scene behind it, which for supplied artwork is the
   * first thing a player sees and the worst moment to look unfinished.
   */
  reveal(): void {
    this.root.classList.add('main-menu-ready')
  }

  /**
   * Resolves once both artwork layers have decoded, so neither is shown half-drawn.
   *
   * Waiting for both matters more than usual here: the two are meant to register against
   * each other, and a menu that appeared with the backdrop but not the character would
   * briefly show an empty scene.
   */
  whenReady(): Promise<void> {
    const settled = (img: HTMLImageElement): Promise<void> => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const done = (): void => {
          img.removeEventListener('load', done)
          img.removeEventListener('error', done)
          resolve()
        }
        img.addEventListener('load', done)
        img.addEventListener('error', done)
      })
    }
    // Every canvas, including the plates: revealing the menu before the buttons have
    // decoded would show a title screen with nothing clickable on it.
    return Promise.all([
      settled(this.backdrop),
      settled(this.overlayImage),
      settled(this.campfireImage),
      ...this.artImages.map(settled),
    ]).then(() => undefined)
  }

  /** The backdrop's decoded size, or null if it has not loaded. For verification. */
  get backdropSize(): { width: number; height: number } | null {
    if (!this.backdrop.naturalWidth || !this.backdrop.naturalHeight) return null
    return { width: this.backdrop.naturalWidth, height: this.backdrop.naturalHeight }
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
    } catch (err) {
      // Fullscreen can be refused (no user gesture, iOS Safari). The label below
      // reports whatever actually happened, so a refusal is visible rather than silent.
      console.warn('[menu] fullscreen request refused', err)
    }
    this.syncFullscreenLabel()
  }

  private syncFullscreenLabel(): void {
    this.fullscreenValue.textContent = document.fullscreenElement ? 'ON' : 'OFF'
  }

  /** Detaches the menu. The caller is about to hand the screen to something else. */
  dispose(): void {
    this.root.remove()
  }
}
