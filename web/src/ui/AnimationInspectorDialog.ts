import { displayName } from '../game/PlayerAction'
import type { PlayerAction } from '../game/PlayerAction'
import type { SpriteAnimationSystem } from '../game/SpriteAnimationSystem'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Live Animation Configuration & Debug Inspector dialog.
 * Enables inspecting frame dimensions, dynamically tuning FPS, adjusting frame
 * count, and testing animation transitions in real time.
 * Mirrors AnimationInspectorDialog.kt.
 */
export class AnimationInspectorDialog {
  readonly root: HTMLElement

  private selectedAction: PlayerAction
  private readonly tabList: HTMLElement
  private readonly details: HTMLElement
  private readonly onKeyDown: (e: KeyboardEvent) => void

  constructor(
    private readonly animations: SpriteAnimationSystem,
    private readonly onDismiss: () => void,
  ) {
    this.selectedAction = animations.currentAction

    this.root = el('div', 'modal-backdrop')
    const card = el('div', 'modal-card')
    card.dataset.testid = 'dialog_animation_inspector'

    // Header
    const header = el('div', 'modal-header')
    header.append(el('h2', 'modal-title', 'SPRITE ANIMATION CONFIG'))
    const closeBtn = el('button', 'btn btn-ghost', 'CLOSE')
    closeBtn.type = 'button'
    closeBtn.dataset.testid = 'button_close_inspector'
    closeBtn.addEventListener('click', () => this.onDismiss())
    header.append(closeBtn)
    card.append(header)

    const body = el('div', 'modal-body')
    this.tabList = el('div', 'tab-list')
    this.details = el('div', 'inspector-details')
    body.append(this.tabList, this.details)
    card.append(body)
    this.root.append(card)

    // Click the backdrop (but not the card) to dismiss.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.onDismiss()
    })
    this.onKeyDown = (e) => {
      if (e.key === 'Escape') this.onDismiss()
    }
    window.addEventListener('keydown', this.onKeyDown)

    this.renderTabs()
    this.renderDetails()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    this.root.remove()
  }

  private renderTabs(): void {
    this.tabList.replaceChildren()
    for (const action of this.animations.getAllActions()) {
      const isSelected = action === this.selectedAction
      const sheet = this.animations.getSheet(action)

      const tab = el('button', `tab${isSelected ? ' is-selected' : ''}`)
      tab.type = 'button'
      tab.dataset.testid = `action_tab_${action}`
      tab.append(el('span', 'tab-name', displayName(action)))
      tab.append(el('span', 'tab-meta', sheet ? `${sheet.frameCount}f @ ${sheet.config.fps}fps` : 'Pending'))
      tab.addEventListener('click', () => {
        this.selectedAction = action
        this.animations.playAction(action, true)
        this.renderTabs()
        this.renderDetails()
      })
      this.tabList.append(tab)
    }
  }

  private renderDetails(): void {
    const config = this.animations.getConfig(this.selectedAction)
    const sheet = this.animations.getSheet(this.selectedAction)
    this.details.replaceChildren()

    if (!config || !sheet) {
      this.details.append(el('p', 'inspector-empty', `No SpriteSheet loaded for ${this.selectedAction}`))
      return
    }

    this.details.append(
      el('p', 'inspector-line', `Source: ${config.sourceFileName}`),
      el('p', 'inspector-line', `Bitmap: ${sheet.image.width}x${sheet.image.height} px`),
      el('p', 'inspector-line', `Frame Size: ${sheet.frameWidth}x${sheet.frameHeight} px (${sheet.frameCount} frames)`),
    )

    // --- FPS slider ---
    const fpsHead = el('div', 'inspector-head')
    fpsHead.append(el('span', 'inspector-label', `FPS: ${config.fps}`))
    const preview = el('button', 'btn btn-primary', 'Preview')
    preview.type = 'button'
    preview.dataset.testid = 'button_play_preview'
    preview.addEventListener('click', () => this.animations.playAction(this.selectedAction, true))
    fpsHead.append(preview)

    const slider = el('input', 'slider')
    slider.type = 'range'
    slider.min = '4'
    slider.max = '30'
    slider.step = '1'
    slider.value = String(config.fps)
    slider.dataset.testid = 'slider_fps'
    slider.addEventListener('input', () => {
      const fps = Number(slider.value)
      const label = fpsHead.querySelector('.inspector-label')
      if (label) label.textContent = `FPS: ${fps}`
      void this.animations.updateConfig({ ...config, fps })
    })

    // --- Frame count stepper ---
    const countHead = el('div', 'inspector-head')
    countHead.append(el('span', 'inspector-label', `Frame Count: ${sheet.frameCount}`))
    const stepper = el('div', 'stepper')
    const step = (delta: number) => () => {
      const next = Math.max(1, sheet.frameCount + delta)
      void this.animations.updateConfig({ ...config, frameCount: next }).then(() => {
        this.renderTabs()
        this.renderDetails()
      })
    }
    const minus = el('button', 'btn btn-step', '−')
    minus.type = 'button'
    minus.addEventListener('click', step(-1))
    const plus = el('button', 'btn btn-step', '+')
    plus.type = 'button'
    plus.addEventListener('click', step(1))
    stepper.append(minus, plus)
    countHead.append(stepper)

    this.details.append(fpsHead, slider, countHead)
  }
}
