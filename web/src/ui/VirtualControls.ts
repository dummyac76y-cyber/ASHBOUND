import { assetUrl } from '../assetUrl'

export interface ControlCallbacks {
  onMove: (horizontal: number) => void
  onAttack: () => void
  onHeavyAttack: () => void
  onBlockChange: (isBlocking: boolean) => void
  onDash: () => void
  onJump: () => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const MAX_RADIUS = 45

/**
 * Analog thumbstick. Uses Pointer Events so mouse, touch and pen all work
 * through one code path, and the pointer capture keeps the drag alive when the
 * finger leaves the joystick bounds.
 */
class VirtualJoystick {
  readonly root: HTMLElement
  private readonly thumb: HTMLElement
  private pointerId: number | null = null

  constructor(private readonly onMove: (horizontal: number) => void) {
    this.root = el('div', 'joystick')
    this.root.append(el('div', 'joystick-ring'))

    const arrow = (dir: 'left' | 'right') => {
      const a = el('div', `joystick-arrow joystick-arrow-${dir}`)
      return a
    }
    this.root.append(arrow('left'), arrow('right'))

    this.thumb = el('div', 'joystick-thumb')
    this.root.append(this.thumb)

    this.root.addEventListener('pointerdown', this.handleDown)
    this.root.addEventListener('pointermove', this.handleMove)
    this.root.addEventListener('pointerup', this.handleUp)
    this.root.addEventListener('pointercancel', this.handleUp)
    // Prevent the page from scrolling / pinch-zooming while dragging the stick.
    this.root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  }

  private handleDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return
    this.pointerId = e.pointerId
    this.root.setPointerCapture(e.pointerId)
    this.applyFromPoint(e.clientX, e.clientY)
  }

  private handleMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    this.applyFromPoint(e.clientX, e.clientY)
  }

  private handleUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    this.pointerId = null
    if (this.root.hasPointerCapture(e.pointerId)) {
      this.root.releasePointerCapture(e.pointerId)
    }
    this.thumb.style.transform = 'translate(-50%, -50%)'
    this.onMove(0)
  }

  private applyFromPoint(clientX: number, clientY: number): void {
    const rect = this.root.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const dx = clientX - centerX
    const dy = clientY - centerY
    const angle = Math.atan2(dy, dx)
    const clamped = Math.min(Math.hypot(dx, dy), MAX_RADIUS)
    this.thumb.style.transform = `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`
    this.onMove(Math.min(1, Math.max(-1, (Math.cos(angle) * clamped) / MAX_RADIUS)))
  }
}

/** Icon shown on the attack button instead of the text labels. */
const ATTACK_ICON_URL = assetUrl('ui/btn_attack.png')

/**
 * Neutral medieval slate used by the icon button.
 *
 * The attack button is the one control that carries artwork instead of a text
 * label, so it is given the dark stone treatment rather than a saturated fill.
 * Painting a colour behind a sword icon reads as a coloured disc behind the
 * artwork; this is the source of the red circle, and it is removed rather than
 * covered over.
 */
const NEUTRAL_BUTTON_COLOR = '#39405a'

/**
 * Circular action button. `hold` buttons report press and release separately.
 * When `iconUrl` is supplied the artwork replaces the text labels.
 */
class ActionButton {
  readonly root: HTMLButtonElement

  constructor(
    label: string,
    sublabel: string,
    color: string,
    testTag: string,
    size: number,
    onPress: () => void,
    onRelease?: () => void,
    iconUrl?: string,
  ) {
    this.root = el('button', 'action-btn')
    this.root.type = 'button'
    this.root.dataset.testid = testTag
    this.root.setAttribute('aria-label', label)
    this.root.style.setProperty('--btn-color', color)
    this.root.style.width = `${size}px`
    this.root.style.height = `${size}px`

    if (iconUrl) {
      const img = document.createElement('img')
      img.className = 'action-btn-icon'
      img.alt = ''
      img.decoding = 'async'
      img.draggable = false
      img.src = iconUrl
      this.root.append(img)
    } else {
      this.root.append(el('span', 'action-btn-label', label))
      this.root.append(el('span', 'action-btn-sub', sublabel))
    }

    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.root.classList.add('is-pressed')
      navigator.vibrate?.(12)
      onPress()
    })

    const release = () => {
      if (!this.root.classList.contains('is-pressed')) return
      this.root.classList.remove('is-pressed')
      onRelease?.()
    }
    this.root.addEventListener('pointerup', release)
    this.root.addEventListener('pointerleave', release)
    this.root.addEventListener('pointercancel', release)
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onPress()
    })
    this.root.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') release()
    })
    // A button must not also fire a synthesized click, which would double-trigger taps.
    this.root.addEventListener('click', (e) => e.preventDefault())
  }
}

/**
 * On-screen controls independent from character rendering.
 * Left side: virtual analog thumbstick for smooth horizontal movement.
 * Right side: action cluster with Attack, Heavy Attack, Block, Dash, Jump.
 * Mirrors VirtualControls.kt and adds keyboard bindings for desktop browsers.
 */
export class VirtualControls {
  readonly root: HTMLElement

  private readonly held = new Set<string>()
  private keyDown: (e: KeyboardEvent) => void = () => {}
  private keyUp: (e: KeyboardEvent) => void = () => {}

  constructor(callbacks: ControlCallbacks) {
    this.root = el('div', 'controls')

    this.root.append(new VirtualJoystick(callbacks.onMove).root)

    const cluster = el('div', 'action-cluster')
    const topRow = el('div', 'action-row')
    topRow.append(
      new ActionButton('HEAVY', 'ATK', '#c8452b', 'button_heavy_attack', 54, callbacks.onHeavyAttack).root,
      new ActionButton('JUMP', 'UP', '#2d7bc7', 'button_jump', 54, callbacks.onJump).root,
    )

    const midRow = el('div', 'action-row')
    midRow.append(
      new ActionButton('DASH', 'ROLL', '#389e82', 'button_dash', 54, callbacks.onDash).root,
      new ActionButton('BLOCK', 'GUARD', '#9e7a26', 'button_block', 54, callbacks.onBlockChange.bind(null, true), () =>
        callbacks.onBlockChange(false),
      ).root,
      new ActionButton('ATK', 'SLASH', NEUTRAL_BUTTON_COLOR, 'button_attack', 62, callbacks.onAttack, undefined, ATTACK_ICON_URL).root,
    )

    cluster.append(topRow, midRow)
    this.root.append(cluster)

    this.attachKeyboard(callbacks)
  }

  /**
   * Desktop bindings. Movement is axis-based and re-evaluated on every key
   * change; the discrete actions fire once per keydown (ignoring auto-repeat).
   */
  private attachKeyboard(callbacks: ControlCallbacks): void {
    const LEFT = new Set(['ArrowLeft', 'KeyA'])
    const RIGHT = new Set(['ArrowRight', 'KeyD'])
    const RELEVANT = new Set([
      'ArrowLeft',
      'ArrowRight',
      'KeyA',
      'KeyD',
      'Space',
      'KeyW',
      'KeyJ',
      'KeyK',
      'KeyL',
      'KeyH',
      'ShiftLeft',
    ])

    const applyMove = () => {
      const left = [...LEFT].some((k) => this.held.has(k))
      const right = [...RIGHT].some((k) => this.held.has(k))
      callbacks.onMove((right ? 1 : 0) - (left ? 1 : 0))
    }

    this.keyDown = (e) => {
      if (e.repeat || !RELEVANT.has(e.code)) return
      e.preventDefault()
      if (this.held.has(e.code)) return
      this.held.add(e.code)
      switch (e.code) {
        case 'Space':
        case 'KeyW':
          callbacks.onJump()
          break
        case 'KeyJ':
        case 'KeyH':
          callbacks.onAttack()
          break
        case 'KeyK':
          callbacks.onHeavyAttack()
          break
        case 'ShiftLeft':
          callbacks.onDash()
          break
        case 'KeyL':
          callbacks.onBlockChange(true)
          break
      }
      applyMove()
    }

    this.keyUp = (e) => {
      if (!this.held.has(e.code)) return
      this.held.delete(e.code)
      if (e.code === 'KeyL') callbacks.onBlockChange(false)
      applyMove()
    }

    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    // A tab switch mid-hold would otherwise leave the knight sprinting forever.
    window.addEventListener('blur', () => {
      this.held.clear()
      callbacks.onMove(0)
      callbacks.onBlockChange(false)
    })
  }
}

/** Human-readable key hints rendered under the control cluster. */
export const KEY_HINTS: ReadonlyArray<[string, string]> = [
  ['A / D', 'move'],
  ['Space', 'jump'],
  ['J', 'attack'],
  ['K', 'heavy'],
  ['L', 'block'],
  ['Shift', 'dash'],
]
