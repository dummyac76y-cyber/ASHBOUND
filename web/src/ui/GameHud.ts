import { PlayerAction } from '../game/PlayerAction'
import type { PlayerController } from '../game/PlayerController'
import type { SpriteAnimationSystem } from '../game/SpriteAnimationSystem'

const STATE_COLORS: Record<PlayerAction, string> = {
  [PlayerAction.IDLE]: '#7de392',
  [PlayerAction.WALK]: '#64b5f6',
  [PlayerAction.ATTACK]: '#ff5252',
  [PlayerAction.HEAVY_ATTACK]: '#ff5252',
  [PlayerAction.BLOCK]: '#ffd54f',
  [PlayerAction.DASH]: '#80cbc4',
  [PlayerAction.JUMP]: '#ba68c8',
  [PlayerAction.HURT]: '#ffffff',
  [PlayerAction.DEATH]: '#ffffff',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Game Heads-Up Display showing player vitals, real-time animation state tracking,
 * and access to the Animation Inspector.
 * Mirrors GameHud.kt, built with plain DOM instead of Compose.
 */
export class GameHud {
  readonly root: HTMLElement

  private readonly hpFill: HTMLElement
  private readonly hpText: HTMLElement
  private readonly staFill: HTMLElement
  private readonly stateText: HTMLElement
  private readonly frameText: HTMLElement

  constructor(
    private readonly getPlayer: () => PlayerController,
    private readonly getAnimations: () => SpriteAnimationSystem,
    onOpenInspector: () => void,
    onResetPosition: () => void,
  ) {
    this.root = el('div', 'hud')

    // --- Left: vitals ---
    const vitals = el('div', 'hud-panel')
    vitals.append(el('div', 'hud-title', 'EXILED KNIGHT'))

    const hpRow = el('div', 'hud-row')
    hpRow.append(el('span', 'hud-label hud-label-hp', 'HP'))
    const hpTrack = el('div', 'bar bar-hp')
    this.hpFill = el('div', 'bar-fill bar-fill-hp')
    hpTrack.append(this.hpFill)
    hpRow.append(hpTrack)
    this.hpText = el('span', 'hud-mono', '100/100')
    hpRow.append(this.hpText)
    vitals.append(hpRow)

    const staRow = el('div', 'hud-row')
    staRow.append(el('span', 'hud-label hud-label-sta', 'STA'))
    const staTrack = el('div', 'bar bar-sta')
    this.staFill = el('div', 'bar-fill bar-fill-sta')
    staTrack.append(this.staFill)
    staRow.append(staTrack)
    vitals.append(staRow)

    // --- Center: animation state monitor ---
    const monitor = el('div', 'hud-panel hud-monitor')
    const stateRow = el('div', 'hud-row')
    stateRow.append(el('span', 'hud-label', 'STATE:'))
    this.stateText = el('span', 'hud-state', PlayerAction.IDLE)
    stateRow.append(this.stateText)
    monitor.append(stateRow)
    this.frameText = el('div', 'hud-mono', 'FRAME: 1/12 | 0px/s | → RIGHT')
    monitor.append(this.frameText)

    // --- Right: buttons ---
    const buttons = el('div', 'hud-buttons')
    const resetBtn = el('button', 'btn', 'RESET')
    resetBtn.type = 'button'
    resetBtn.addEventListener('click', onResetPosition)
    const configBtn = el('button', 'btn btn-primary', 'CONFIG')
    configBtn.type = 'button'
    configBtn.addEventListener('click', onOpenInspector)
    buttons.append(resetBtn, configBtn)

    this.root.append(vitals, monitor, buttons)
  }

  /** Called once per frame. Cheap: only touches textContent/width when values change. */
  update(fps: number): void {
    const player = this.getPlayer()
    const animations = this.getAnimations()

    const hpRatio = Math.min(1, Math.max(0, player.hp / player.maxHp))
    this.hpFill.style.width = `${hpRatio * 100}%`
    this.hpText.textContent = ` ${player.hp}/${player.maxHp}`

    const staRatio = Math.min(1, Math.max(0, player.stamina / player.maxStamina))
    this.staFill.style.width = `${staRatio * 100}%`

    const action = animations.currentAction
    this.stateText.textContent = action
    this.stateText.style.color = STATE_COLORS[action]

    const totalFrames = animations.getSheet(action)?.frameCount ?? 1
    const direction = player.isFacingRight ? '→ RIGHT' : '← LEFT'
    this.frameText.textContent =
      `FRAME: ${animations.currentFrameIndex + 1}/${totalFrames} | ` +
      `${Math.trunc(player.vx)}px/s | ${direction} | ${fps}fps`
  }
}
