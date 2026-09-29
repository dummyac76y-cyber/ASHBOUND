/**
 * Headless smoke test for the web port's game logic.
 *
 * The rendering path needs a browser, but physics, the animation state machine
 * and hit detection are pure and run in plain Node. Run with:
 *   node --experimental-strip-types --no-warnings src/game/logic.test.ts
 */
import { GameWorld } from './GameWorld.ts'
import { PlayerController, rectsIntersect } from './PlayerController.ts'
import { PlayerAction } from './PlayerAction.ts'
import type { SpriteAnimationSystem } from './SpriteAnimationSystem.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name} ${detail}`)
  }
}

/** Minimal stand-in exposing only what PlayerController/GameWorld consume. */
function stubAnimations() {
  const system = {
    currentAction: PlayerAction.IDLE,
    currentFrameIndex: 0,
    isFinished: false,
    elapsedTimeSeconds: 0,
    playAction(action: PlayerAction, restartIfSame = false) {
      if (system.currentAction === action && !restartIfSame) return false
      system.currentAction = action
      system.currentFrameIndex = 0
      system.isFinished = false
      return true
    },
    update() {},
    getSheet() {
      return undefined
    },
    getConfig() {
      return undefined
    },
    getAllActions() {
      return Object.values(PlayerAction)
    },
  }
  return system as unknown as SpriteAnimationSystem & typeof system
}

const anim = stubAnimations()
const world = new GameWorld(anim, null)
const player = world.player

console.log('rect intersection')
check('overlapping rects intersect', rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 15, bottom: 15 }))
check(
  'separated rects do not intersect',
  !rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 20, top: 0, right: 30, bottom: 10 }),
)
check(
  'touching edges do not intersect',
  !rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }),
)

console.log('spawn state')
check('player spawns on the floor', player.groundY === GameWorld.FLOOR_Y, `got ${player.groundY}`)
check('player starts at spawn x', player.x === GameWorld.SPAWN_X, `got ${player.x}`)
check('starts facing right', player.isFacingRight)
check('starts on IDLE', anim.currentAction === PlayerAction.IDLE)

console.log('movement + walk state')
player.setMovementInput(1)
world.update(1 / 60)
check('moves right', player.x > GameWorld.SPAWN_X, `got ${player.x}`)
check('still facing right', player.isFacingRight)
check('enters WALK', anim.currentAction === PlayerAction.WALK, `got ${anim.currentAction}`)
check('vx matches walk speed', Math.abs(player.vx - 150) < 1, `got ${player.vx}`)

player.setMovementInput(-1)
world.update(1 / 60)
check('turns around on left input', !player.isFacingRight)

player.setMovementInput(0)
for (let i = 0; i < 10; i++) world.update(1 / 60)
check('returns to IDLE when stopped', anim.currentAction === PlayerAction.IDLE, `got ${anim.currentAction}`)

console.log('world bounds')
player.setMovementInput(-1)
for (let i = 0; i < 600; i++) world.update(1 / 60)
check('clamped to left bound', player.x >= player.width / 2 - 0.001, `got ${player.x}`)
player.setMovementInput(1)
for (let i = 0; i < 1200; i++) world.update(1 / 60)
check('clamped to right bound', player.x <= GameWorld.WORLD_WIDTH - player.width / 2 + 0.001, `got ${player.x}`)

console.log('jump')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
check('jump accepted while grounded', player.onJump())
check('airborne after jump', !player.isGrounded)
check('JUMP state while airborne', anim.currentAction === PlayerAction.JUMP, `got ${anim.currentAction}`)
check('jump rejected while airborne', !player.onJump())
for (let i = 0; i < 200; i++) world.update(1 / 60)
check('lands back on the floor', player.isGrounded && Math.abs(player.groundY - GameWorld.FLOOR_Y) < 0.001)

console.log('dash')
const staminaBefore = player.stamina
check('dash accepted', player.onDash())
check('dash costs 25 stamina', Math.abs(staminaBefore - 25 - player.stamina) < 0.001, `got ${player.stamina}`)
check('invulnerable during dash', player.isInvulnerable)
check('dash state active', anim.currentAction === PlayerAction.DASH, `got ${anim.currentAction}`)
check('dash rejected while dashing', !player.onDash())
for (let i = 0; i < 30; i++) world.update(1 / 60)
check('invulnerability ends after dash', !player.isInvulnerable)

console.log('attack hit detection')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
const dummy = world.dummies[0]
player.x = dummy.x - 30
player.isFacingRight = true
check('attack accepted', player.onAttack())
check('ATTACK state active', anim.currentAction === PlayerAction.ATTACK, `got ${anim.currentAction}`)

const hpBefore = dummy.hp
// The world owns the hit check, so the active frame must be current *before*
// update() runs — that is how the real game loop drives it.
anim.currentFrameIndex = 4
world.update(1 / 60)
check('dummy took light damage', dummy.hp === hpBefore - 18, `got ${dummy.hp} from ${hpBefore}`)
check('hitbox consumed once', !player.shouldCheckAttackHit())
check('damage text spawned', world.damageTexts.length > 0)
check('sparks spawned', world.particles.length > 0)

console.log('heavy attack')
player.resetPlayer(dummy.x - 30, GameWorld.FLOOR_Y)
const heavyBefore = dummy.hp
check('heavy attack accepted', player.onHeavyAttack())
anim.currentFrameIndex = 5
world.update(1 / 60)
check('dummy took heavy damage', dummy.hp === heavyBefore - 45, `got ${dummy.hp} from ${heavyBefore}`)

console.log('attack out of range')
player.resetPlayer(dummy.x - 300, GameWorld.FLOOR_Y)
const missBefore = dummy.hp
check('attack still animates out of range', player.onAttack())
anim.currentFrameIndex = 4
world.update(1 / 60)
check('dummy untouched out of range', dummy.hp === missBefore, `got ${dummy.hp}`)

console.log('attack cannot be started mid-air')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
player.onJump()
check('airborne attack rejected', !player.onAttack())
player.onHurt(200)
for (let i = 0; i < 200; i++) world.update(1 / 60)
check('lands after hurt too', player.isGrounded)

console.log('block deflection')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
player.setBlockActive(true)
world.update(1 / 60)
check('blocking state engaged', player.isBlocking)
const blockHp = player.hp
check('blocked hit does not connect', player.onHurt(18) === false)
check('block still chips hp', player.hp < blockHp && player.hp > blockHp - 18, `got ${player.hp} from ${blockHp}`)
player.setBlockActive(false)

console.log('hurt + death')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
check('unblocked hit connects', player.onHurt(18) === true)
check('hp reduced', player.hp === 82, `got ${player.hp}`)
check('HURT state active', anim.currentAction === PlayerAction.HURT, `got ${anim.currentAction}`)
player.onHurt(1000)
check('death state at 0 hp', anim.currentAction === PlayerAction.DEATH, `got ${anim.currentAction}`)
check('dead player cannot be hurt again', player.onHurt(10) === false)
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
check('reset restores hp', player.hp === player.maxHp)
check('reset returns to IDLE', anim.currentAction === PlayerAction.IDLE)

console.log('stamina regen')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
player.stamina = 50
for (let i = 0; i < 60; i++) world.update(1 / 60)
check('stamina regenerates at 20/s', Math.abs(player.stamina - 70) < 0.5, `got ${player.stamina}`)

console.log('camera')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
for (let i = 0; i < 300; i++) world.update(1 / 60)
check('camera stays within world bounds', world.cameraX >= 0 && world.cameraX <= GameWorld.WORLD_WIDTH - GameWorld.LOGICAL_WIDTH, `got ${world.cameraX}`)

console.log('dt clamping')
player.resetPlayer(GameWorld.SPAWN_X, GameWorld.FLOOR_Y)
const xBefore = player.x
world.update(10) // a huge stall must not teleport the player
check('huge dt is clamped', Math.abs(player.x - xBefore) < 20, `moved ${player.x - xBefore}px`)

console.log('controller constructed directly')
const solo = new PlayerController(anim, 200, 260)
check('solo controller defaults sane', solo.width === 44 && solo.height === 70 && solo.maxHp === 100)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
if (failures > 0) process.exit(1)
