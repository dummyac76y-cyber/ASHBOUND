import { assetUrl } from '../assetUrl'

/**
 * The Ashbound main menu.
 *
 * Three things stack here and it matters that they stay three things:
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
 * Its visible ink sits at x 680..819, immediately left of the character's x 826..999,
 * so the two share no pixel at all: they stand side by side rather than one in front of
 * the other. The campfire is still drawn after the character, so that a flame reads in
 * front should either canvas ever be revised to touch. Today that ordering is
 * invisible, which is worth knowing rather than assuming.
 */
export const MAIN_MENU_CAMPFIRE_FILE = 'main_menu_campfire.png'

export const MAIN_MENU_CAMPFIRE_URL = assetUrl(`bg/${MAIN_MENU_CAMPFIRE_FILE}`)

/** Which screen the menu is showing. The entries live on `main`. */
export type MenuScreen = 'main' | 'load' | 'settings' | 'quit'

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

/** Entries that were considered and explicitly ruled out. Never add these. */
export const FORBIDDEN_ENTRIES: readonly string[] = ['DUEL ONLINE', 'PRACTICE', 'CHARACTERS', 'CREDITS']

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

    this.buildMainScreen(handlers)
    this.buildLoadScreen()
    this.buildSettingsScreen()
    this.buildQuitScreen(handlers)

    // Every screen is mounted up front and switched with `hidden`, rather than built on
    // demand. Each screen is a fixed piece of markup, so there is nothing to save by
    // deferring it -- and having them all present means switching screens cannot fail
    // halfway and leave the menu with no way back.
    for (const screen of this.screens.values()) this.ui.append(screen)

    this.root = el('div', 'main-menu')
    this.root.dataset.testid = 'main_menu'
    // Paint order: backdrop, the two transparent art canvases, then the UI. The order
    // of the two canvases between themselves is currently invisible -- their ink does
    // not touch -- but is fixed here anyway so it cannot drift.
    this.root.append(this.backdrop, this.overlay, this.campfire, this.ui)

    this.show('main')
    this.syncFullscreenLabel()

    // Leaving the menu by other means (Esc, the browser's own fullscreen gesture)
    // still has to leave the label truthful.
    document.addEventListener('fullscreenchange', () => this.syncFullscreenLabel())
  }

  /** The four entries, plus the title. */
  private buildMainScreen(handlers: MainMenuHandlers): void {
    const screen = el('div', 'menu-panel menu-panel-main')
    screen.dataset.testid = 'main_menu_screen_main'
    screen.append(el('h1', 'menu-title', 'ASHBOUND'))
    screen.append(el('p', 'menu-subtitle', 'A knight without a kingdom'))

    const list = el('div', 'menu-list')
    MAIN_ENTRIES.forEach((entry, index) => {
      const button = el('button', 'menu-button', entry.label)
      button.type = 'button'
      button.dataset.testid = `main_menu_${entry.screen}`
      button.dataset.index = String(index)
      button.addEventListener('click', () => {
        if (entry.screen === 'main') {
          // Leave before starting: the world is about to own the screen, and a menu
          // left mounted on top of it would keep swallowing input.
          this.dispose()
          handlers.onStart()
          return
        }
        this.show(entry.screen)
      })
      list.append(button)
    })
    screen.append(list)
    this.screens.set('main', screen)
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
    return Promise.all([settled(this.backdrop), settled(this.overlayImage), settled(this.campfireImage)]).then(
      () => undefined,
    )
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
