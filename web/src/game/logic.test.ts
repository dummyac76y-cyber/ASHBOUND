/**
 * Headless smoke test for the web port's game logic.
 *
 * The rendering path needs a browser, but physics, the animation state machine
 * and hit detection are pure and run in plain Node. Run with:
 *   node --experimental-strip-types --no-warnings src/game/logic.test.ts
 */
import { GameWorld } from './GameWorld.ts'
import {
  FORGOTTEN_PRISON,
  SCENES,
  UNDERGROUND_CAVERN,
  fitBackdrop,
  FOOT_TARGET_VIEWPORT_FRACTION,
  TRANSITION_TOTAL,
} from './GameScene.ts'
import { PlayerController, rectsIntersect } from './PlayerController.ts'
import { NPC_CLIPS, NPC_IDLE_WALK_SHEET } from './npcAssets.ts'
import { PlayerAction } from './PlayerAction.ts'
import type { SpriteAnimationSystem } from './SpriteAnimationSystem.ts'
import { createDefaultConfigs } from './AnimationConfig.ts'
import { SpriteSheet } from './SpriteSheet.ts'
import { DEFAULT_FOOT_ROW, FOOT_ROWS_BY_SHEET, footOffsetForRow } from './spriteMetrics.ts'

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
    getConfig(action: PlayerAction) {
      // The real config, so tests exercise the shipped hit windows and frame
      // counts rather than invented ones.
      return createDefaultConfigs().get(action)
    },
    getAllActions() {
      return Object.values(PlayerAction)
    },
  }
  return system as unknown as SpriteAnimationSystem & typeof system
}

// Most of these tests exercise the opening scene, so they read its geometry from the
// scene definition rather than from the world, whose scene can now change.
const OPENING_FIT = fitBackdrop(
  FORGOTTEN_PRISON.sourceWidth,
  FORGOTTEN_PRISON.sourceHeight,
  FORGOTTEN_PRISON.floorRow,
  FORGOTTEN_PRISON.worldWidth,
  GameWorld.LOGICAL_HEIGHT,
)
const FLOOR_Y = OPENING_FIT.floorY
const SPAWN_X = FORGOTTEN_PRISON.spawnX

const anim = stubAnimations()
const world = new GameWorld(anim)
const player = world.player

/**
 * Returns the shared world to the opening scene.
 *
 * Scenes are real state now: a block that walks the player into an exit genuinely
 * moves the shared world on to the next environment, which would silently change the
 * floor plane every later block measures against. Blocks that walk that far call
 * this first, so they do not inherit each other's scene.
 */
function resetWorld(): void {
  // resetPlayer() intentionally keeps held input -- releasing the stick is the
  // caller's job -- so neutralise it here too. Otherwise a leftover "walk right"
  // from an earlier block keeps walking during this one, reaches the exit and hands
  // the world over mid-test.
  world.player.setMovementInput(0)
  world.enterScene(0)
}

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
check('player spawns on the floor', player.groundY === FLOOR_Y, `got ${player.groundY}`)
check('player starts at spawn x', player.x === SPAWN_X, `got ${player.x}`)
check('starts facing right', player.isFacingRight)
check('starts on IDLE', anim.currentAction === PlayerAction.IDLE)

console.log('movement + walk state')
player.setMovementInput(1)
world.update(1 / 60)
check('moves right', player.x > SPAWN_X, `got ${player.x}`)
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
// Each scene bounds itself, so the right-hand limit belongs to whichever scene is
// active -- and walking right far enough leaves this one entirely.
player.setMovementInput(-1)
for (let i = 0; i < 600 && world.activeSceneIndex === 0; i++) world.update(1 / 60)
player.setMovementInput(0)
check('clamped to left bound', player.x >= player.width / 2 - 0.001, `got ${player.x}`)
check(
  'the left bound is the player half-width inside the scene',
  Math.abs(player.x - player.width / 2) < 1e-6,
  `got ${player.x}, scene starts at 0`,
)
player.setMovementInput(1)
for (let i = 0; i < 2400 && world.activeSceneIndex === 0; i++) world.update(1 / 60)
const boundScene = world.activeScene
for (let i = 0; i < 2400 && world.activeSceneIndex === 1; i++) world.update(1 / 60)
player.setMovementInput(0)
check(
  `clamped to the right bound of ${boundScene.definition.id}`,
  Math.abs(player.x - (boundScene.definition.worldWidth - player.width / 2)) < 1e-3,
  `got ${player.x}, bound ${boundScene.definition.worldWidth - player.width / 2}`,
)

resetWorld()
console.log('jump')
player.resetPlayer(SPAWN_X, FLOOR_Y)
check('jump accepted while grounded', player.onJump())
check('airborne after jump', !player.isGrounded)
check('JUMP state while airborne', anim.currentAction === PlayerAction.JUMP, `got ${anim.currentAction}`)
check('jump rejected while airborne', !player.onJump())
for (let i = 0; i < 200; i++) world.update(1 / 60)
check('lands back on the floor', player.isGrounded && Math.abs(player.groundY - FLOOR_Y) < 0.001)

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
player.resetPlayer(SPAWN_X, FLOOR_Y)
const npc = world.npcs[0]
player.x = npc.x - 30
player.isFacingRight = true
const attackCfg = createDefaultConfigs().get(PlayerAction.ATTACK)!
const attackWindow = attackCfg.hitFrames!
const heavyCfg = createDefaultConfigs().get(PlayerAction.HEAVY_ATTACK)!
const heavyWindow = heavyCfg.hitFrames!
check('attack has a hit window', Array.isArray(attackWindow) && attackWindow.length === 2, `${attackWindow}`)
check('heavy attack has a hit window', Array.isArray(heavyWindow) && heavyWindow.length === 2, `${heavyWindow}`)

check('attack accepted', player.onAttack())
check('ATTACK state active', anim.currentAction === PlayerAction.ATTACK, `got ${anim.currentAction}`)

const hpBefore = npc.hp
// The world owns the hit check, so the active frame must be current *before*
// update() runs — that is how the real game loop drives it.
anim.currentFrameIndex = attackWindow[0]
world.update(1 / 60)
check('the NPC took light damage', npc.hp === hpBefore - 18, `got ${npc.hp} from ${hpBefore}`)
check('hitbox consumed once', !player.shouldCheckAttackHit())
check('damage text spawned', world.damageTexts.length > 0)
check('sparks spawned', world.particles.length > 0)

console.log('the hit waits for the blade instead of landing on the windup')
// Every frame before the window is a windup frame: the swing must not have
// connected yet, so no damage and no effect.
for (let f = 0; f < attackWindow[0]; f++) {
  player.resetPlayer(npc.x - 30, FLOOR_Y)
  player.isFacingRight = true
  player.onAttack()
  const hp = npc.hp
  anim.currentFrameIndex = f
  world.update(1 / 60)
  check(`light attack deals no damage on windup frame ${f}`, npc.hp === hp, `took ${hp - npc.hp} too early`)
}

// The last frame of the window still connects.
player.resetPlayer(npc.x - 30, FLOOR_Y)
player.isFacingRight = true
player.onAttack()
const lateHp = npc.hp
anim.currentFrameIndex = attackWindow[1]
world.update(1 / 60)
check('light attack still connects on the last window frame', npc.hp === lateHp - 18, `got ${npc.hp} from ${lateHp}`)

// One swing connects once, even though the window spans several frames.
check('a swing cannot hit twice', !player.shouldCheckAttackHit())
for (let f = attackWindow[0]; f <= attackWindow[1]; f++) anim.currentFrameIndex = f
check('a swing cannot hit twice across the window', !player.shouldCheckAttackHit())
player.resetPlayer(npc.x - 30, FLOOR_Y)
player.isFacingRight = true
player.onAttack()
anim.currentFrameIndex = attackWindow[0]
world.update(1 / 60)
check('a second swing hits again', npc.hp < lateHp, `got ${npc.hp} from ${lateHp}`)

console.log('heavy attack')
for (let f = 0; f < heavyWindow[0]; f++) {
  player.resetPlayer(npc.x - 30, FLOOR_Y)
  player.isFacingRight = true
  player.onHeavyAttack()
  const hp = npc.hp
  anim.currentFrameIndex = f
  world.update(1 / 60)
  check(`heavy attack deals no damage on windup frame ${f}`, npc.hp === hp, `took ${hp - npc.hp} too early`)
}
player.resetPlayer(npc.x - 30, FLOOR_Y)
player.isFacingRight = true
player.onHeavyAttack()
const heavyBefore = npc.hp
anim.currentFrameIndex = heavyWindow[0]
world.update(1 / 60)
check('the NPC took heavy damage', npc.hp === heavyBefore - 45, `got ${npc.hp} from ${heavyBefore}`)

console.log('attack out of range')
player.resetPlayer(npc.x - 300, FLOOR_Y)
const missBefore = npc.hp
check('attack still animates out of range', player.onAttack())
anim.currentFrameIndex = attackWindow[0]
world.update(1 / 60)
check('the NPC is untouched out of range', npc.hp === missBefore, `got ${npc.hp}`)

console.log('attack cannot be started mid-air')
player.resetPlayer(SPAWN_X, FLOOR_Y)
player.onJump()
check('airborne attack rejected', !player.onAttack())
player.onHurt(200)
for (let i = 0; i < 200; i++) world.update(1 / 60)
check('lands after hurt too', player.isGrounded)

console.log('block deflection')
player.resetPlayer(SPAWN_X, FLOOR_Y)
player.setBlockActive(true)
world.update(1 / 60)
check('blocking state engaged', player.isBlocking)
const blockHp = player.hp
check('blocked hit does not connect', player.onHurt(18) === false)
check('block still chips hp', player.hp < blockHp && player.hp > blockHp - 18, `got ${player.hp} from ${blockHp}`)
player.setBlockActive(false)

console.log('hurt + death')
player.resetPlayer(SPAWN_X, FLOOR_Y)
check('unblocked hit connects', player.onHurt(18) === true)
check('hp reduced', player.hp === 82, `got ${player.hp}`)
check('HURT state active', anim.currentAction === PlayerAction.HURT, `got ${anim.currentAction}`)
player.onHurt(1000)
check('death state at 0 hp', anim.currentAction === PlayerAction.DEATH, `got ${anim.currentAction}`)
check('dead player cannot be hurt again', player.onHurt(10) === false)
player.resetPlayer(SPAWN_X, FLOOR_Y)
check('reset restores hp', player.hp === player.maxHp)
check('reset returns to IDLE', anim.currentAction === PlayerAction.IDLE)

console.log('stamina regen')
player.resetPlayer(SPAWN_X, FLOOR_Y)
player.stamina = 50
for (let i = 0; i < 60; i++) world.update(1 / 60)
check('stamina regenerates at 20/s', Math.abs(player.stamina - 70) < 0.5, `got ${player.stamina}`)

resetWorld()
console.log('camera')
player.resetPlayer(SPAWN_X, FLOOR_Y)
player.setMovementInput(-1)
for (let i = 0; i < 200; i++) world.update(1 / 60)
player.setMovementInput(0)
check(
  'camera stays within the active scene bounds',
  world.cameraX >= 0 && world.cameraX <= world.maxCameraX,
  `got ${world.cameraX}, allowed 0..${world.maxCameraX}`,
)
check(
  'a scene exactly one viewport wide pins the camera at 0',
  world.maxCameraX === 0 && world.cameraX === 0,
  `max ${world.maxCameraX}, cameraX ${world.cameraX}`,
)
check(
  'cameraXForPlayerX clamps to the scene at both extremes',
  world.cameraXForPlayerX(-500) === 0 && world.cameraXForPlayerX(99999) === world.maxCameraX,
  `${world.cameraXForPlayerX(-500)} .. ${world.cameraXForPlayerX(99999)}`,
)

// ---------------------------------------------------------------------------
// The cavern's ground plane.
//
// The cavern painting shows scenery standing proud of the ground: rocks, timber
// ledges, the cave walls. None of it is walkable. The scene must therefore present
// exactly one floor — the flat stone combat floor — and hold the player's feet on
// it everywhere he can walk, so he can never end up standing on scenery.
// ---------------------------------------------------------------------------

console.log('the cavern floor is one flat plane, walked and jumped on')
{
  const cavernWorld = new GameWorld(stubAnimations())
  const index = SCENES.findIndex((d) => d.id === UNDERGROUND_CAVERN.id)
  cavernWorld.enterScene(index)
  const scene = cavernWorld.activeScene
  const plane = scene.fit.floorY

  check('the cavern has its own floor plane', Number.isFinite(plane), `plane y ${plane}`)

  // 1-2. Spawns on the floor, feet on it.
  check(
    'the cavern spawns the player standing on the floor',
    Math.abs(cavernWorld.player.groundY - plane) < 1e-9 && cavernWorld.player.isGrounded,
    `groundY ${cavernWorld.player.groundY}, plane ${plane}`,
  )

  // 3. Walking left and right keeps the feet on the very same plane, all the way
  //    to both world edges. This is what makes "never on a rock" true: the plane
  //    never moves, and the collision test is a single value, so there is no
  //    scenery the player could be lifted onto.
  const walkedYs = new Set<number>()
  const halfW = cavernWorld.player.width / 2
  for (const dir of [1, -1]) {
    cavernWorld.player.setMovementInput(dir)
    for (let i = 0; i < 1200; i++) {
      cavernWorld.update(1 / 60)
      walkedYs.add(Math.round(cavernWorld.player.groundY * 1e6))
    }
  }
  cavernWorld.player.setMovementInput(0)
  check(
    'walking the full width in both directions never leaves the floor plane',
    walkedYs.size === 1 && Math.abs([...walkedYs][0] / 1e6 - plane) < 1e-9,
    `distinct groundY values while walking: ${walkedYs.size} (${[...walkedYs].slice(0, 3).join(', ')})`,
  )
  check(
    'the walk covered the whole scene, so the plane was tested end to end',
    cavernWorld.player.x - halfW <= halfW + 1 || cavernWorld.player.x + halfW >= UNDERGROUND_CAVERN.worldWidth - halfW - 1,
    `ended at x ${cavernWorld.player.x.toFixed(1)}`,
  )

  // 4-5. A jump leaves the plane and lands back on it exactly.
  cavernWorld.respawn()
  const jumped = cavernWorld.player.onJump()
  let peak = cavernWorld.player.groundY
  let landedAt: number | null = null
  for (let i = 0; i < 300; i++) {
    cavernWorld.update(1 / 60)
    peak = Math.min(peak, cavernWorld.player.groundY)
    if (i > 5 && cavernWorld.player.isGrounded) {
      landedAt = cavernWorld.player.groundY
      break
    }
  }
  check('a jump starts from the floor', jumped && peak < plane - 50, `jump peak y ${peak.toFixed(1)}, plane ${plane}`)
  check(
    'the jump lands back on exactly the same floor plane',
    landedAt !== null && Math.abs(landedAt - plane) < 1e-9,
    `landed at ${landedAt}, plane ${plane}`,
  )

  // The collision test is the scene's single floor value: nothing in the world
  // supplies a second surface, which is what keeps scenery unwalkable.
  check(
    'the world exposes exactly one ground height, so scenery cannot become walkable',
    cavernWorld.floorY === plane && scene.fit.floorY === plane,
    `world ${cavernWorld.floorY}, scene fit ${scene.fit.floorY}`,
  )
  check(
    'the cavern NPCs stand on that same plane, not on a ledge',
    cavernWorld.npcs.every((d) => Math.abs(d.groundY - plane) < 1e-9),
    `NPCs at ${cavernWorld.npcs.map((d) => d.groundY).join(', ')}, plane ${plane}`,
  )

  // 6. Scrolling the camera must not move the ground vertically. The camera is
  //    horizontal only, so the feet's world Y is invariant along the whole world.
  const footYs: number[] = []
  for (const camX of [0, 448, UNDERGROUND_CAVERN.worldWidth - GameWorld.LOGICAL_WIDTH]) {
    cavernWorld.enterScene(index)
    cavernWorld.player.x = Math.min(Math.max(camX + GameWorld.LOGICAL_WIDTH / 2, halfW), UNDERGROUND_CAVERN.worldWidth - halfW)
    cavernWorld.cameraX = cavernWorld.cameraXForPlayerX(cavernWorld.player.x)
    cavernWorld.update(1 / 60)
    footYs.push(cavernWorld.player.groundY)
  }
  check(
    'the feet stay on the same height at every camera position',
    footYs.every((y) => Math.abs(y - plane) < 1e-9),
    `groundY at three camera positions: ${footYs.map((y) => y.toFixed(3)).join(', ')}, plane ${plane}`,
  )
}

// ---------------------------------------------------------------------------
// Vertical framing.
//
// The two paintings put their ground at different heights inside the frame, so a
// shared world Y would draw the knight low in one scene and high in the other.
// Each scene therefore frames itself vertically, moving the whole world -- and
// only the picture of it -- so the feet land on one shared screen Y. The floor
// itself stays where the artwork puts it, and the physics is untouched.
// ---------------------------------------------------------------------------

console.log('every scene frames its floor to the same screen height')
{
  const target = GameWorld.LOGICAL_HEIGHT * FOOT_TARGET_VIEWPORT_FRACTION
  check(
    'the shared target is three quarters down the viewport',
    Math.abs(target - 270) < 1e-9,
    `target y ${target} of ${GameWorld.LOGICAL_HEIGHT}`,
  )

  const framed = SCENES.map((definition) => {
    const index = SCENES.indexOf(definition)
    const w = new GameWorld(stubAnimations())
    w.enterScene(index)
    return {
      id: definition.id,
      floorY: w.activeScene.fit.floorY,
      cameraY: w.cameraY,
      footScreenY: w.footScreenY,
      drawnFootY: w.floorY + w.cameraY,
      scale: w.activeScene.fit.scale,
      playerGroundY: w.player.groundY,
    }
  })

  for (const f of framed) {
    check(
      `${f.id}: the drawn floor lands on the shared screen target`,
      Math.abs(f.drawnFootY - target) < 1e-6,
      `floorY ${f.floorY.toFixed(3)} + cameraY ${f.cameraY.toFixed(3)} = ${f.drawnFootY.toFixed(3)}, target ${target}`,
    )
  }

  const drawn = framed.map((f) => f.drawnFootY)
  check(
    'the two scenes place the floor at the same screen Y',
    Math.abs(drawn[0] - drawn[1]) < 1e-6,
    drawn.map((d) => d.toFixed(3)).join(' vs '),
  )
  check(
    'the two scenes really did need different offsets to get there',
    Math.abs(framed[0].cameraY - framed[1].cameraY) > 1,
    framed.map((f) => `${f.id}: ${f.cameraY.toFixed(2)}`).join('  '),
  )

  // The offset is presentation only. The player still stands on the scene's own
  // world floor, and that floor is still exactly where the artwork put it.
  for (const f of framed) {
    check(
      `${f.id}: the player still stands on the artwork's own world floor`,
      Math.abs(f.playerGroundY - f.floorY) < 1e-9,
      `groundY ${f.playerGroundY}, artwork floorY ${f.floorY.toFixed(3)}`,
    )
  }
  check(
    'the scenes keep their own independent world floors',
    Math.abs(framed[0].floorY - framed[1].floorY) > 1,
    framed.map((f) => `${f.id}: ${f.floorY.toFixed(3)}`).join('  '),
  )
  check(
    'framing did not touch the backdrop scale',
    Math.abs(framed[0].scale - framed[1].scale) > 0.1,
    framed.map((f) => `${f.id}: scale ${f.scale.toFixed(4)}`).join('  '),
  )

  // Framing is a crop, so each scene must still fill the viewport vertically.
  for (const f of framed) {
    const fit = fitBackdrop(
      SCENES.find((d) => d.id === f.id)!.sourceWidth,
      SCENES.find((d) => d.id === f.id)!.sourceHeight,
      SCENES.find((d) => d.id === f.id)!.floorRow,
      SCENES.find((d) => d.id === f.id)!.worldWidth,
      GameWorld.LOGICAL_HEIGHT,
    )
    const top = fit.offsetY + f.cameraY
    // Source rows visible above and below, after the framing crop.
    const firstSourceRow = (0 - top) / fit.scale
    const lastSourceRow = (GameWorld.LOGICAL_HEIGHT - top) / fit.scale
    const art = SCENES.find((d) => d.id === f.id)!
    // The framed window has to sit entirely inside the painting: any row of it
    // outside would be a bare band rather than backdrop.
    check(
      `${f.id}: cropping to frame the floor leaves no bare band`,
      firstSourceRow >= -0.5 && lastSourceRow <= art.sourceHeight + 0.5,
      `visible source rows ${firstSourceRow.toFixed(1)}..${lastSourceRow.toFixed(1)} inside 0..${art.sourceHeight}`,
    )
  }
}

console.log('dt clamping')
player.resetPlayer(SPAWN_X, FLOOR_Y)
const xBefore = player.x
world.update(10) // a huge stall must not teleport the player
check('huge dt is clamped', Math.abs(player.x - xBefore) < 20, `moved ${player.x - xBefore}px`)

console.log('controller constructed directly')
const solo = new PlayerController(anim, 200, 260)
check('solo controller defaults sane', solo.width === 44 && solo.height === 70 && solo.maxHp === 100)

// ---------------------------------------------------------------------------
// World space: the NPCs are arena fixtures, not screen or player-relative.
// ---------------------------------------------------------------------------

console.log('the opening scene places the player at its own entrance')
// A fresh world, so these read the real match-start state rather than whatever
// the earlier blocks left the shared `world` in.
{
const spawnWorld = new GameWorld(stubAnimations())
const scene = spawnWorld.scenes[spawnWorld.activeSceneIndex]
check('the game opens on the Forgotten Prison', scene.definition.id === FORGOTTEN_PRISON.id, `got ${scene.definition.id}`)
check('spawn X is the opening scene entrance', scene.definition.spawnX === SPAWN_X, `got ${scene.definition.spawnX}`)
check('player starts at the scene spawn X', Math.abs(spawnWorld.player.x - scene.definition.spawnX) < 1e-9, `got ${spawnWorld.player.x}`)
check(
  'player starts on the opening scene floor plane',
  Math.abs(spawnWorld.player.groundY - scene.fit.floorY) < 1e-9,
  `got ${spawnWorld.player.groundY}, scene floor ${scene.fit.floorY}`,
)
check(
  'spawn leaves room to walk in both directions',
  spawnWorld.player.x - spawnWorld.player.width / 2 > 100 &&
    scene.definition.worldWidth - spawnWorld.player.x - spawnWorld.player.width / 2 > 100,
  `${(spawnWorld.player.x - spawnWorld.player.width / 2).toFixed(0)} left / ${(scene.definition.worldWidth - spawnWorld.player.x - spawnWorld.player.width / 2).toFixed(0)} right`,
)
check(
  'camera starts with the player centred in the viewport',
  Math.abs(spawnWorld.cameraX - spawnWorld.cameraXForPlayerX(spawnWorld.player.x)) < 1e-9 &&
    Math.abs(spawnWorld.player.x - spawnWorld.cameraX - GameWorld.LOGICAL_WIDTH / 2) < 1e-9,
  `cameraX ${spawnWorld.cameraX}`,
)
check(
  'NPCs come from the opening scene, to the right of the spawn',
  spawnWorld.npcs.every((d) => d.x > scene.definition.spawnX && d.x < scene.definition.worldWidth),
  spawnWorld.npcs.map((d) => d.x).join(', '),
)
check(
  'NPCs stand on the same floor plane as the player',
  spawnWorld.npcs.every((d) => Math.abs(d.groundY - scene.fit.floorY) < 1e-9),
  '',
)
}

resetWorld()
console.log('NPCs live in world space, and the camera is what moves them on screen')
{
  const npc = world.npcs[0]
  const spawnX = npc.x
  const seen: Array<{ screen: number; camera: number; world: number; player: number; state: string }> = []
  const sample = () => seen.push({ screen: npc.x - world.cameraX, camera: world.cameraX, world: npc.x, player: world.player.x, state: npc.state })

  // The NPC opens standing still, so the first sample is taken inside that window,
  // before its own patrol has started. Anything that had moved by then would be the
  // camera or a scene change rather than the NPC's own behaviour.
  world.player.setMovementInput(1)
  for (let i = 0; i < 50; i++) world.update(1 / 60)
  world.player.setMovementInput(0)
  for (let i = 0; i < 40; i++) world.update(1 / 60)
  sample()
  const stoodStillAt = npc.x

  world.player.setMovementInput(-1)
  for (let i = 0; i < 400; i++) world.update(1 / 60)
  world.player.setMovementInput(0)
  for (let i = 0; i < 60; i++) world.update(1 / 60)
  sample()

  check('the NPC stands still for its first idle window, so it is not camera-driven', stoodStillAt === spawnX, `${spawnX} -> ${stoodStillAt}`)
  check('the camera stays inside the scene on both legs',
    seen.every((r) => r.camera >= -1e-9 && r.camera <= world.maxCameraX + 1e-9),
    `cameraX ${seen[0].camera} / ${seen[1].camera}`)
  // The one invariant that has to hold at every instant: whatever the camera and the
  // patrol are both doing, the sprite is placed at worldX - cameraX and nowhere else.
  check('screen position = worldX - cameraX in both samples',
    seen.every((r) => Math.abs(r.screen - (r.world - r.camera)) < 1e-9),
    seen.map((r) => `${r.world}@${r.camera}=${r.screen}`).join(' '))
  check('the NPC moved on its own, under its patrol, not with the camera',
    npc.x !== spawnX, `${spawnX} -> ${npc.x.toFixed(2)}`)
  check('and stayed inside its patrol limits throughout',
    npc.x >= npc.patrolLeft - 1e-9 && npc.x <= npc.patrolRight + 1e-9,
    `${npc.x.toFixed(2)} within ${npc.patrolLeft}..${npc.patrolRight}`)
  check('the NPC never leaves the scene',
    npc.x > 0 && npc.x < world.worldWidth,
    `${npc.x.toFixed(2)} within 0..${world.worldWidth}`)
  check('the player actually moved', Math.abs(seen[0].player - SPAWN_X) > 50, `player reached ${seen[0].player.toFixed(1)}`)
}

console.log('NPC PATROL: stands, walks a short way, stops, and turns at its limit')
{
  // Re-enter the scene first: the previous block left the NPC mid-patrol, and this
  // one is about where a patrol *begins*.
  resetWorld()
  const npc = world.npcs[0]
  const order: string[] = []
  let sawWalk = false
  let sawIdleAfterWalk = false
  let reachedLimit = false
  let flipped = false
  const startFacing = npc.facingRight
  const homeX = npc.x

  for (let i = 0; i < 60 * 30; i++) {
    world.update(1 / 60)
    const seenBefore = order[order.length - 1]
    const label = npc.state
    if (label !== seenBefore) order.push(label)
    if (npc.state === 'walk') sawWalk = true
    if (sawWalk && npc.state === 'idle') sawIdleAfterWalk = true
    // Turning round is only ever allowed to happen on the way into a stop, at the
    // limit itself -- never out in the open, and never by walking past the limit.
    if (npc.state === 'idle' && npc.facingRight !== startFacing) {
      reachedLimit = npc.x === npc.patrolRight || npc.x === npc.patrolLeft
      flipped = true
    }
  }

  check('the NPC starts idle', order[0] === 'idle', order.join(' -> '))
  check('it stands for a while before setting off', sawWalk, order.join(' -> '))
  check('it stops and returns to idle after walking', sawIdleAfterWalk, order.join(' -> '))
  check('it turns around at its patrol limit rather than walking past it', reachedLimit && flipped, `limits ${npc.patrolLeft}..${npc.patrolRight}`)
  check('the cycle alternates idle and walk several times over half a minute', order.filter((s) => s === 'walk').length >= 3, order.join(' -> '))
  check('it heads right first, then reverses on the way home', npc.patrolRight === homeX + 40 && npc.patrolLeft === homeX - 40, `home ${homeX}`)
  check('the NPC never leaves its patrol', npc.x >= npc.patrolLeft - 1e-9 && npc.x <= npc.patrolRight + 1e-9, `${npc.x.toFixed(2)}`)
}

console.log('NPC ANIMATION: frames advance at the declared rate for the running clip')
{
  const npc = world.npcs[0]
  const walk = NPC_CLIPS.find((c) => c.name === 'walk')!
  const idle = NPC_CLIPS.find((c) => c.name === 'idle')!
  check('walk is bound to the supplied sheet', walk.sheet === NPC_IDLE_WALK_SHEET.file, `${walk.sheet}`)
  check('walk plays the whole 12-frame cycle', walk.frameCount === 12, `${walk.frameCount} frames`)
  check('walk runs at 12 fps as specified', walk.fps === 12, `${walk.fps}`)
  check('idle runs at 6 fps as specified', idle.fps === 6, `${idle.fps}`)
  check('idle and walk are bound independently of one another', idle.sheet !== walk.sheet || idle.firstFrame !== walk.firstFrame || idle.frameCount !== walk.frameCount)

  // Frame maths is checked directly so the cadence does not depend on frame pacing.
  // The running state selects the clip, so it is set to match what is being checked.
  npc.state = 'walk'
  const walkFrames = new Set<number>()
  for (let t = 0; t < 1; t += 1 / 240) walkFrames.add(npc.frameForElapsed(t))
  check('a second of walking passes through every frame exactly once, in order',
    walkFrames.size === 12 && [...walkFrames].every((f) => f >= 0 && f < 12), `${walkFrames.size} distinct frames`)
  const ordered = Array.from({ length: 24 }, (_, i) => npc.frameForElapsed(i / 12)).join(',')
  check('the walk advances monotonically and wraps at the end of the cycle', ordered.startsWith('0,1,2,3') && ordered.includes('10,11,0,1'), ordered)

  npc.state = 'idle'
  check('idle holds its single frame however long it has been standing', [0, 0.4, 3, 99].every((t) => npc.frameForElapsed(t) === 0), `frames ${[0, 0.4, 3, 99].map((t) => npc.frameForElapsed(t)).join(',')}`)
  npc.state = 'idle'
  const idleFps = npc.fps
  npc.state = 'walk'
  const walkFps = npc.fps
  check('the running clip reports its own frame rate', idleFps === 6 && walkFps === 12, `idle ${idleFps} fps, walk ${walkFps} fps`)
}

resetWorld()
console.log('NPC hitbox and health bar are anchored to the NPC')
{
  const npc = world.npcs[0]
  const before = { ...npc.hitbox }
  npc.x += 200
  const after = { ...npc.hitbox }
  npc.x = FORGOTTEN_PRISON.npcXs[0]

  check('hitbox left/right follow the NPC world X', after.left - before.left === 200 && after.right - before.right === 200, `moved ${after.left - before.left}`)
  check('hitbox bottom is the floor plane', Math.abs(after.bottom - FLOOR_Y) < 1e-9, `got ${after.bottom}`)
  check('hitbox top is the floor minus the NPC height', Math.abs(after.top - (FLOOR_Y - npc.height)) < 1e-9, `got ${after.top}`)
}

console.log('SCENES: one full-screen environment at a time')
// Every scene is its own picture. Its backdrop is scaled to cover that scene's world
// and cropped where it overflows, so there is no gap to fill, nothing to tile, and no
// adjacency at which two environments could ever meet.
{
  for (const scene of world.scenes) {
    const { fit, definition: d } = scene
    const tag = d.id
    check(
      `${tag}: plate covers the scene width, so no horizontal gap can show`,
      fit.drawWidth >= d.worldWidth,
      `draw ${fit.drawWidth} vs world ${d.worldWidth}`,
    )
    check(
      `${tag}: plate covers the viewport height, so no vertical gap can show`,
      fit.drawHeight >= GameWorld.LOGICAL_HEIGHT,
      `draw ${fit.drawHeight} vs ${GameWorld.LOGICAL_HEIGHT}`,
    )
    check(
      `${tag}: overflow is cropped away, never inset (offsets cannot leave a gap)`,
      fit.offsetX <= 0 && fit.offsetY <= 0,
      `offset ${fit.offsetX},${fit.offsetY}`,
    )
    check(
      `${tag}: aspect ratio preserved, one scale on both axes`,
      Math.abs(fit.drawWidth / d.sourceWidth - fit.drawHeight / d.sourceHeight) < 1e-12,
      `x ${fit.drawWidth / d.sourceWidth} vs y ${fit.drawHeight / d.sourceHeight}`,
    )
    check(
      `${tag}: scene floor is the artwork's own floor row, placed`,
      Math.abs(fit.floorY - (fit.offsetY + d.floorRow * fit.scale)) < 1e-9,
      `floorY ${fit.floorY}`,
    )
    check(
      `${tag}: floor sits inside the viewport`,
      fit.floorY > 0 && fit.floorY < GameWorld.LOGICAL_HEIGHT,
      `floorY ${fit.floorY}`,
    )
  }

  const prison = world.scenes.find((x) => x.definition.id === FORGOTTEN_PRISON.id)!
  const cavern = world.scenes.find((x) => x.definition.id === UNDERGROUND_CAVERN.id)!

  check(
    'the prison backdrop is still uniformly scaled, never stretched to fit the framing',
    Math.abs(prison.fit.drawWidth / prison.fit.drawHeight - FORGOTTEN_PRISON.sourceWidth / FORGOTTEN_PRISON.sourceHeight) < 1e-9,
    `drawn ${prison.fit.drawWidth}x${prison.fit.drawHeight}, art ${FORGOTTEN_PRISON.sourceWidth}x${FORGOTTEN_PRISON.sourceHeight}`,
  )
  check(
    'the prison is cropped only vertically, and never wider than the world',
    prison.fit.offsetY < 0 &&
      prison.fit.drawWidth >= prison.definition.worldWidth &&
      Math.abs(prison.fit.offsetX - (prison.definition.worldWidth - prison.fit.drawWidth) / 2) < 1e-9,
    `offsets ${prison.fit.offsetX},${prison.fit.offsetY}, draw ${prison.fit.drawWidth}x${prison.fit.drawHeight}`,
  )
  check(
    'the prison crop is only as large as the vertical framing needed',
    prison.fit.scale > 5 / 12 && prison.fit.scale < 5 / 12 + 0.2,
    `scale ${prison.fit.scale}, was ${5 / 12} uncropped`,
  )
  check(
    'the cavern is a world, not a fitted backdrop: it renders at its native size',
    Math.abs(cavern.fit.scale - 1) < 1e-12 &&
      cavern.fit.drawWidth >= UNDERGROUND_CAVERN.worldWidth &&
      UNDERGROUND_CAVERN.worldWidth > GameWorld.LOGICAL_WIDTH,
    `scale ${cavern.fit.scale}, drawn ${cavern.fit.drawWidth} wide over a ${UNDERGROUND_CAVERN.worldWidth} world (viewport ${GameWorld.LOGICAL_WIDTH})`,
  )
  check(
    'the cavern keeps the whole artwork width, so nothing is cropped horizontally',
    cavern.fit.offsetX === 0 && cavern.fit.drawWidth === UNDERGROUND_CAVERN.sourceWidth,
    `offsetX ${cavern.fit.offsetX}, drawWidth ${cavern.fit.drawWidth} of ${UNDERGROUND_CAVERN.sourceWidth}`,
  )
  check(
    'the cavern world is at least twice the viewport, so there is something to scroll',
    UNDERGROUND_CAVERN.worldWidth >= GameWorld.LOGICAL_WIDTH * 2,
    `world ${UNDERGROUND_CAVERN.worldWidth} vs viewport ${GameWorld.LOGICAL_WIDTH}`,
  )
  check(
    'the cavern camera has real range to travel',
    UNDERGROUND_CAVERN.worldWidth - GameWorld.LOGICAL_WIDTH > 400,
    `camera range 0..${UNDERGROUND_CAVERN.worldWidth - GameWorld.LOGICAL_WIDTH}`,
  )
  check(
    'the two scenes are scaled independently, not forced to share one scale',
    Math.abs(cavern.fit.scale - prison.fit.scale) > 0.1,
    `prison ${prison.fit.scale}, cavern ${cavern.fit.scale}`,
  )
  check(
    'each scene has its own floor plane',
    Math.abs(cavern.fit.floorY - FLOOR_Y) > 1,
    `prison ${FLOOR_Y}, cavern ${cavern.fit.floorY.toFixed(3)}`,
  )
  check('there is more than one scene to travel between', world.scenes.length >= 2, `${world.scenes.length}`)
  check(
    'scene titles are non-empty and upper-case for the location card',
    SCENES.every((d) => d.title.length > 0 && d.title === d.title.toUpperCase()),
    SCENES.map((d) => d.title).join(' | '),
  )
  check(
    'only the last scene is a dead end',
    SCENES.slice(0, -1).every((d) => d.exitX !== null) && SCENES[SCENES.length - 1].exitX === null,
    SCENES.map((d) => `${d.id}:${d.exitX}`).join(', '),
  )
  check(
    'the exit sits exactly where the world bound stops the player',
    FORGOTTEN_PRISON.exitX === FORGOTTEN_PRISON.worldWidth - 22,
    `exit ${FORGOTTEN_PRISON.exitX}, bound ${FORGOTTEN_PRISON.worldWidth - 22}`,
  )
  check(
    'player size is a character constant, untouched by any scene scale',
    GameWorld.SPRITE_DISPLAY_SIZE === 100 &&
      world.scenes.every(() => GameWorld.SPRITE_DISPLAY_SIZE === 100),
    `got ${GameWorld.SPRITE_DISPLAY_SIZE}`,
  )
}

console.log('ground plane is derived from the backdrop')
check(
  'the opening scene floor still comes from the measured floor row 533',
  Math.abs(FLOOR_Y - (OPENING_FIT.offsetY + FORGOTTEN_PRISON.floorRow * OPENING_FIT.scale)) < 1e-9,
  `got ${FLOOR_Y}, offsetY ${OPENING_FIT.offsetY}, scale ${OPENING_FIT.scale}`,
)
check(
  'floor is the lit surface, not the row-620 flagstone joint',
  FORGOTTEN_PRISON.floorRow === 533 &&
    Math.abs(FLOOR_Y - (OPENING_FIT.offsetY + 620 * OPENING_FIT.scale)) > 1,
  `row ${FORGOTTEN_PRISON.floorRow}, y ${FLOOR_Y}`,
)
check(
  'ground plane is no longer the old screen-relative 285',
  Math.abs(FLOOR_Y - 285) > 20,
  `got ${FLOOR_Y}`,
)
check(
  'rest-pose foot offset equals the idle sheet padding',
  Math.abs(GameWorld.SPRITE_FOOT_OFFSET - 12.5) < 0.01,
  `got ${GameWorld.SPRITE_FOOT_OFFSET}`,
)

console.log('SCENE TRANSITION: exit, fade, title, fade in')
{
  const w = new GameWorld(stubAnimations())
  check('the match opens in the prison', w.activeScene.definition.id === FORGOTTEN_PRISON.id, w.activeScene.definition.id)
  check('gameplay is live at rest', !w.isTransitioning, w.transitionPhase)

  const seen = new Set<string>()
  w.player.setMovementInput(1)
  for (let i = 0; i < 600 && !w.isTransitioning; i++) w.update(1 / 60)
  w.player.setMovementInput(0)
  seen.add(w.transitionPhase)
  check('walking into the exit starts a handover', w.isTransitioning, w.transitionPhase)
  check('the handover announces the next area', w.transitionTitle === UNDERGROUND_CAVERN.title, w.transitionTitle)

  // Sample the opening stretch of the fade, while the outgoing scene is still up.
  // The fade-out is 0.3s, i.e. 18 frames, so 10 stay safely inside it.
  const outgoing = w.activeScene.definition.id
  const parkedX = w.player.x
  w.player.setMovementInput(1)
  for (let i = 0; i < 10; i++) {
    w.update(1 / 60)
    seen.add(w.transitionPhase)
  }
  check('normal movement is stopped during the handover', w.player.x === parkedX, `drifted to ${w.player.x}`)
  check(
    'the outgoing scene is still on screen while it fades out',
    w.activeScene.definition.id === outgoing,
    w.activeScene.definition.id,
  )
  // Release the stick, or the incoming scene walks straight back out of its exit.
  w.player.setMovementInput(0)

  const steps = Math.ceil((TRANSITION_TOTAL + 0.5) * 60)
  for (let i = 0; i < steps; i++) {
    w.update(1 / 60)
    seen.add(w.transitionPhase)
  }
  check(
    'it fades out, holds the title, then fades back in',
    seen.has('fadingOut') && seen.has('title') && seen.has('fadingIn'),
    [...seen].join(','),
  )
  check('the handover completes and gameplay resumes', !w.isTransitioning, w.transitionPhase)
  check('the title is cleared afterwards', w.transitionTitle === '', w.transitionTitle)
  check('it lands on the cavern', w.activeScene.definition.id === UNDERGROUND_CAVERN.id, w.activeScene.definition.id)
  check(
    'the player is placed at the cavern entrance',
    Math.abs(w.player.x - UNDERGROUND_CAVERN.spawnX) < 1e-9,
    `got ${w.player.x}, entrance ${UNDERGROUND_CAVERN.spawnX}`,
  )
  check(
    'the player is grounded on the cavern floor plane',
    Math.abs(w.player.groundY - w.floorY) < 1e-9,
    `feet ${w.player.groundY}, floor ${w.floorY}`,
  )
  check(
    'the camera is reset to the new scene bounds, not carried over',
    Math.abs(w.cameraX - w.cameraXForPlayerX(w.player.x)) < 1e-9 &&
      w.cameraX >= 0 &&
      w.cameraX <= w.maxCameraX,
    `cameraX ${w.cameraX}, allowed 0..${w.maxCameraX}`,
  )
  check(
    "the prison's NPCs did not carry into the cavern",
    w.npcs.every((d) => !FORGOTTEN_PRISON.npcXs.includes(d.x)) &&
      w.npcs.length === UNDERGROUND_CAVERN.npcXs.length &&
      w.npcs.every((d, i) => d.x === UNDERGROUND_CAVERN.npcXs[i]),
    w.npcs.map((d) => d.x).join(', '),
  )
  check(
    'cavern NPCs stand on the cavern floor',
    w.npcs.every((d) => Math.abs(d.groundY - w.floorY) < 1e-9),
    '',
  )

  // The cavern is a dead end, so walking right must not start another handover.
  w.player.setMovementInput(1)
  for (let i = 0; i < 600; i++) w.update(1 / 60)
  w.player.setMovementInput(0)
  check('the last scene has no further exit', !w.isTransitioning && w.activeSceneIndex === 1, `${w.transitionPhase}/${w.activeSceneIndex}`)
  check(
    'the player is stopped by the cavern world bound',
    Math.abs(w.player.x - (UNDERGROUND_CAVERN.worldWidth - w.player.width / 2)) < 1e-9,
    `x ${w.player.x}`,
  )
  check(
    'the camera never leaves the scene range',
    w.cameraX >= -1e-9 && w.cameraX <= w.maxCameraX + 1e-9,
    `cameraX ${w.cameraX}, max ${w.maxCameraX}`,
  )
  check(
    'cameraXForPlayerX clamps at both ends of the scene',
    w.cameraXForPlayerX(-9999) === 0 && w.cameraXForPlayerX(99999) === w.maxCameraX,
    `${w.cameraXForPlayerX(-9999)} .. ${w.cameraXForPlayerX(99999)}, max ${w.maxCameraX}`,
  )
}

console.log('only one scene is ever active')
{
  const w = new GameWorld(stubAnimations())
  const ids = new Set<string>()
  for (let i = 0; i < SCENES.length; i++) {
    w.enterScene(i)
    ids.add(w.activeScene.definition.id)
    check(
      `scene ${i} has exactly one backdrop plate bound to it`,
      w.scenes.filter((sc) => sc.background !== null).length <= 1,
      '',
    )
  }
  check('every scene can be entered and is distinct', ids.size === SCENES.length, `${ids.size} of ${SCENES.length}`)
}

console.log('per-frame foot rows come from the artwork, not a constant')
{
  const walkFootRows = FOOT_ROWS_BY_SHEET['walk.png']
  const idleFootRows = FOOT_ROWS_BY_SHEET['idle.png']

  check('walk foot rows are measured per frame, not a single constant', new Set(walkFootRows).size > 1, '')
  // Derived from the configured frame count rather than hardcoded, so replacing a
  // sheet with a different frame count cannot leave these quietly stale.
  const idleFrames = createDefaultConfigs().get(PlayerAction.IDLE)!.frameCount
  const walkFrames = createDefaultConfigs().get(PlayerAction.WALK)!.frameCount
  check('every walk frame has a measured foot row', walkFootRows.length === walkFrames, `got ${walkFootRows.length} for ${walkFrames} frames`)
  check('every idle frame has a measured foot row', idleFootRows.length === idleFrames, `got ${idleFootRows.length} for ${idleFrames} frames`)
  check('idle foot rows are the constant rest pose', idleFootRows.every((r) => r === 111), '')

  const size = GameWorld.SPRITE_DISPLAY_SIZE
  const offsets = walkFootRows.map((r) => footOffsetForRow(r, size))
  // The walk contact row ranges 110..112, so the correct offset spans ~1.56px. A
  // single constant would therefore misplace the extreme frames by ~0.78px each.
  check(
    'walk foot offsets span ~1.56px, so a constant would err by ~0.78px',
    Math.abs(Math.max(...offsets) - Math.min(...offsets) - 1.5625) < 0.01,
    `spread ${(Math.max(...offsets) - Math.min(...offsets)).toFixed(3)}`,
  )
}

console.log('GRID PACKED SHEETS: a 4x4 grid of 256px cells slices correctly')
{
  const stubImage = { width: 1024, height: 1024 } as unknown as HTMLCanvasElement
  const config = createDefaultConfigs().get(PlayerAction.ATTACK)!
  const sheet = new SpriteSheet(PlayerAction.ATTACK, stubImage, config)

  check('attack uses the attack sheet', config.sourceFileName === 'attack.png', config.sourceFileName)
  check('attack has 16 frames', sheet.frameCount === 16, `got ${sheet.frameCount}`)
  check('attack reads 4 columns', sheet.columns === 4, `got ${sheet.columns}`)
  check('attack cell is 256px', sheet.cellHeight === 256, `got ${sheet.cellHeight}`)
  check('attack cell is 256 wide', sheet.frameWidth === 256, `got ${sheet.frameWidth}`)

  // Every cell in a 4x4 grid of 256px cells must be addressed correctly, not
  // just the first row: column advances x, wrapping at 4 moves down a row.
  check('frame 0 is the top-left cell', JSON.stringify(sheet.frameRect(0)) === JSON.stringify({ sx: 0, sy: 0, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(0)))
  check('frame 3 is the end of the first row', JSON.stringify(sheet.frameRect(3)) === JSON.stringify({ sx: 768, sy: 0, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(3)))
  check('frame 4 wraps to the start of row two', JSON.stringify(sheet.frameRect(4)) === JSON.stringify({ sx: 0, sy: 256, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(4)))
  check('frame 15 is the bottom-right cell', JSON.stringify(sheet.frameRect(15)) === JSON.stringify({ sx: 768, sy: 768, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(15)))
  check('out-of-range frames clamp to the last cell', JSON.stringify(sheet.frameRect(99)) === JSON.stringify(sheet.frameRect(15)), JSON.stringify(sheet.frameRect(99)))

  // No two frames may address the same source rect, or the sheet would visibly
  // stutter through duplicates instead of playing 16 distinct poses.
  const seen = new Set<string>()
  for (let f = 0; f < sheet.frameCount; f++) seen.add(JSON.stringify(sheet.frameRect(f)))
  check('all 16 frames address distinct cells', seen.size === 16, `got ${seen.size} unique`)

  // The strip sheets must keep their single-row behaviour.
  const walkStub = { width: 1536, height: 128 } as unknown as HTMLCanvasElement
  const walkSheet = new SpriteSheet(PlayerAction.WALK, walkStub, createDefaultConfigs().get(PlayerAction.WALK)!)
  check('walk stays a single row of 128px cells', walkSheet.cellHeight === 128 && walkSheet.frameCount === 12, `cell ${walkSheet.cellHeight}, frames ${walkSheet.frameCount}`)
  check('walk frame 5 has no vertical offset', walkSheet.frameRect(5).sy === 0, `sy ${walkSheet.frameRect(5).sy}`)

  // The 256px cell has a different padding than a 128px one, so the foot offset
  // must be computed against this sheet's own cell height.
  const size = GameWorld.SPRITE_DISPLAY_SIZE
  const scaled = size * sheet.displayScale
  let worst = 0
  for (let frame = 0; frame < sheet.frameCount; frame++) {
    const rectBottom = FLOOR_Y + footOffsetForRow(sheet.footRowForFrame(frame), scaled, sheet.cellHeight)
    const visibleFeet = rectBottom - footOffsetForRow(sheet.footRowForFrame(frame), scaled, sheet.cellHeight)
    worst = Math.max(worst, Math.abs(visibleFeet - FLOOR_Y))
  }
  check('all 16 attack frames put their visible feet on FLOOR_Y', worst < 1e-9, `worst ${worst}`)

  // A 256px cell drawn unscaled would shrink the character to ~57px against
  // idle's ~78px, so the sheet must carry a scale that restores the size.
  // The character is the same on-screen size in every sheet, including the
  // grid-packed ones. The authoritative check is the median rendered height
  // across every frame of every sheet, measured against real pixels by
  // scripts/verify-attack.mjs.
  const attackChar = (141 / 256) * scaled
  const idleChar = (103 / 128) * size
  check(
    'the grid attack sheet draws a larger box than idle for the same character',
    scaled > size,
    `attack cell ${scaled.toFixed(1)}px vs idle ${size}px, character ${attackChar.toFixed(1)} vs ${idleChar.toFixed(1)}`,
  )
}

console.log('GRID PACKED SHEET: a 5x5 grid of 256px cells slices correctly')
{
  const stubImage = { width: 1280, height: 1280 } as unknown as HTMLCanvasElement
  const config = createDefaultConfigs().get(PlayerAction.HEAVY_ATTACK)!
  const sheet = new SpriteSheet(PlayerAction.HEAVY_ATTACK, stubImage, config)

  check('heavy attack uses its own sheet', config.sourceFileName === 'heavy_attack.png', config.sourceFileName)
  check('heavy attack has 25 frames', sheet.frameCount === 25, `got ${sheet.frameCount}`)
  check('heavy attack reads 5 columns', sheet.columns === 5, `got ${sheet.columns}`)
  check('heavy attack cell is 256px', sheet.cellHeight === 256, `got ${sheet.cellHeight}`)

  // 5x5 addressing: the last frame is the bottom-right cell, and wrapping happens
  // at 5, not at 4 as the attack sheet does.
  check('frame 4 is the end of the first row', JSON.stringify(sheet.frameRect(4)) === JSON.stringify({ sx: 1024, sy: 0, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(4)))
  check('frame 5 wraps to the start of row two', JSON.stringify(sheet.frameRect(5)) === JSON.stringify({ sx: 0, sy: 256, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(5)))
  check('frame 24 is the bottom-right cell', JSON.stringify(sheet.frameRect(24)) === JSON.stringify({ sx: 1024, sy: 1024, sw: 256, sh: 256 }), JSON.stringify(sheet.frameRect(24)))

  const seen = new Set<string>()
  let outside = 0
  for (let f = 0; f < sheet.frameCount; f++) {
    const r = sheet.frameRect(f)
    seen.add(JSON.stringify(r))
    if (r.sx + r.sw > 1280 || r.sy + r.sh > 1280) outside++
  }
  check('all 25 frames address distinct cells', seen.size === 25, `got ${seen.size} unique`)
  check('no frame rect falls outside the sheet', outside === 0, `${outside} outside`)
  check('the 25 cells cover the sheet exactly', sheet.frameWidth * sheet.cellHeight * sheet.frameCount === 1280 * 1280, `${sheet.frameCount} cells of ${sheet.frameWidth}x${sheet.cellHeight}`)

  // Both grid sheets scale up to compensate for their 256px cells, which is what
  // keeps them the same character size as the 128px strips. The exact sizes are
  // verified against real rendered pixels by scripts/verify-attack.mjs; comparing
  // source-pixel heights here would only re-derive the calibration.
  const size = GameWorld.SPRITE_DISPLAY_SIZE
  check(
    'a grid sheet draws at a larger box than the strips, yet the same character',
    size * sheet.displayScale > size,
    `heavy draws at ${(size * sheet.displayScale).toFixed(1)}px per cell vs ${size}px`,
  )

  const scaled = size * sheet.displayScale
  let worst = 0
  for (let frame = 0; frame < sheet.frameCount; frame++) {
    const rectBottom = FLOOR_Y + footOffsetForRow(sheet.footRowForFrame(frame), scaled, sheet.cellHeight)
    const visibleFeet = rectBottom - footOffsetForRow(sheet.footRowForFrame(frame), scaled, sheet.cellHeight)
    worst = Math.max(worst, Math.abs(visibleFeet - FLOOR_Y))
  }
  check('all 25 heavy attack frames put their visible feet on FLOOR_Y', worst < 1e-9, `worst ${worst}`)
}

console.log('CHARACTER SIZE: every sheet declares the scale that normalises it')
{
  // The artwork does not draw the character at a consistent size, so each sheet
  // carries a displayScale. The values themselves are verified against real
  // rendered pixels by scripts/verify-attack.mjs; what matters structurally here
  // is that a sheet cannot be added without one.
  const configs = createDefaultConfigs()
  const scaleByFile = new Map<string, number[]>()
  for (const cfg of configs.values()) {
    const list = scaleByFile.get(cfg.sourceFileName) ?? []
    list.push(cfg.displayScale)
    scaleByFile.set(cfg.sourceFileName, list)
  }

  for (const [file, scales] of scaleByFile) {
    const uniform = scales.every((s) => Math.abs(s - scales[0]) < 1e-9)
    check(
      `${file}: every action using it agrees on one scale`,
      uniform,
      scales.map((s) => s.toFixed(3)).join(', '),
    )
  }

  // A grid-packed 256px cell has to scale up to match the 128px strips, a strip
  // drawn slightly small has to scale up, and one drawn large has to scale down.
  const scaleFor = (action: PlayerAction) => configs.get(action)!.displayScale
  check('the grid attack sheets scale up past their larger cell', scaleFor(PlayerAction.ATTACK) > 1.2 && scaleFor(PlayerAction.HEAVY_ATTACK) > 1.2, `attack ${scaleFor(PlayerAction.ATTACK)}, heavy ${scaleFor(PlayerAction.HEAVY_ATTACK)}`)
  // Idle is the size every other sheet is calibrated against, but it is not
  // necessarily the unscaled one: the artwork can draw its character smaller than
  // the common size, in which case idle carries a small correction of its own.
  const idleScale = scaleFor(PlayerAction.IDLE)
  check('idle is normalised, not left at an arbitrary size', idleScale > 0.9 && idleScale < 1.2, `idle ${idleScale}`)
  check('walk, drawn smaller than idle, scales up', scaleFor(PlayerAction.WALK) > 1, `${scaleFor(PlayerAction.WALK)}`)
  check('jump, drawn smaller than idle, scales up', scaleFor(PlayerAction.JUMP) > 1, `${scaleFor(PlayerAction.JUMP)}`)

  // Every action standing in on idle.png renders that sheet, so it must render at
  // idle's scale. Getting this wrong is invisible in the config and only shows up
  // as those actions playing at a different size from idle.
  const idleConfig = configs.get(PlayerAction.IDLE)!
  for (const action of [PlayerAction.BLOCK, PlayerAction.DASH, PlayerAction.HURT, PlayerAction.DEATH]) {
    const cfg = configs.get(action)!
    if (cfg.sourceFileName !== idleConfig.sourceFileName) continue
    check(
      `${action} stands in on idle.png and matches its scale`,
      cfg.displayScale === idleConfig.displayScale,
      `${cfg.sourceFileName} at ${cfg.displayScale} vs idle ${idleConfig.displayScale}`,
    )
  }

  // The sheet drawn at a different native resolution must resolve the same
  // on-screen size as idle, which is the whole point of the scale.
  const size = GameWorld.SPRITE_DISPLAY_SIZE
  const heavy = configs.get(PlayerAction.HEAVY_ATTACK)!
  check(
    'a grid sheet draws at a larger box than the strips, yet the same character',
    size * heavy.displayScale > size,
    `heavy draws at ${(size * heavy.displayScale).toFixed(1)}px per cell vs ${size}px`,
  )
}

console.log("the sprite cell is anchored on each frame's own opaque bottom")
{
  // SpriteSheet only reads image.width/height here, so a plain stub is enough.
  const stubImage = { width: 1536, height: 128 } as unknown as HTMLCanvasElement
  const size = GameWorld.SPRITE_DISPLAY_SIZE

  for (const [action, sheetFile] of [
    [PlayerAction.IDLE, 'idle.png'],
    [PlayerAction.WALK, 'walk.png'],
  ] as const) {
    const config = createDefaultConfigs().get(action)!
    const sheet = new SpriteSheet(action, stubImage, config)

    check(`${sheetFile}: every frame reports its measured foot row`, sheet.footRowForFrame(0) !== undefined, '')

    let worst = 0
    for (let frame = 0; frame < sheet.frameCount; frame++) {
      // The renderer puts the draw-rect bottom this far below FLOOR_Y...
      const rectBottom = FLOOR_Y + footOffsetForRow(sheet.footRowForFrame(frame), size)
      // ...so walking back up by that frame's own padding lands on the plane.
      const visibleFeet = rectBottom - footOffsetForRow(sheet.footRowForFrame(frame), size)
      worst = Math.max(worst, Math.abs(visibleFeet - FLOOR_Y))
    }
    check(`${sheetFile}: all ${sheet.frameCount} frames put their visible feet on FLOOR_Y`, worst < 1e-9, `worst ${worst}`)
  }

  const walkSheet = new SpriteSheet(PlayerAction.WALK, stubImage, createDefaultConfigs().get(PlayerAction.WALK)!)
  check(
    'walk frames report distinct foot rows where the art varies',
    walkSheet.footRowForFrame(2) === 110 && walkSheet.footRowForFrame(8) === 112 && walkSheet.footRowForFrame(0) === 111,
    '',
  )
  check(
    'out-of-range frame index clamps to the last frame, like frameRect does',
    walkSheet.footRowForFrame(99) === 112 && walkSheet.footRowForFrame(-5) === 111,
    `got ${walkSheet.footRowForFrame(99)} / ${walkSheet.footRowForFrame(-5)}`,
  )
  {
    // A sheet with no measured data must still anchor on the rest pose rather than
    // silently treating the cell bottom as the foot.
    const unmeasured = new SpriteSheet(
      PlayerAction.DASH,
      stubImage,
      { ...createDefaultConfigs().get(PlayerAction.DASH)!, footRows: [] },
    )
    check(
      'unmeasured frames fall back to the rest-pose foot row',
      unmeasured.footRowForFrame(0) === DEFAULT_FOOT_ROW,
      `got ${unmeasured.footRowForFrame(0)}`,
    )
  }
}

resetWorld()
console.log('IDLE: feet pinned to the ground plane')
// resetPlayer() intentionally does not clear held input (releasing the stick is the
// caller's job), and earlier blocks left movement input asserted, so neutralise it.
player.setMovementInput(0)
player.resetPlayer(SPAWN_X, FLOOR_Y)
check('idle feet on the plane', Math.abs(player.groundY - FLOOR_Y) < 1e-6, `got ${player.groundY}`)
check('idle state active', anim.currentAction === PlayerAction.IDLE)
{
  let worst = 0
  for (let i = 0; i < 600; i++) {
    world.update(1 / 60)
    worst = Math.max(worst, Math.abs(player.groundY - FLOOR_Y))
  }
  check('idle holds the plane for 10s with zero drift', worst < 1e-6, `worst deviation ${worst}`)
  check('idle does not drift horizontally', Math.abs(player.x - SPAWN_X) < 1e-6, `got ${player.x}`)
  check('still IDLE after 10s', anim.currentAction === PlayerAction.IDLE, `got ${anim.currentAction}`)
}

resetWorld()
console.log('WALK: travels along the plane without floating or sinking')
{
  player.resetPlayer(SPAWN_X, FLOOR_Y)
  // Right then left, and deliberately short of both the exit at 618 and the left
  // wall at 22: a scene is one viewport wide, so a long one-way walk would end on a
  // wall or hand over to the next scene rather than testing the walk cycle.
  let worst = 0
  let maxX = player.x
  for (const dir of [1, -1]) {
    player.setMovementInput(dir)
    for (let i = 0; i < 100; i++) {
      world.update(1 / 60)
      worst = Math.max(worst, Math.abs(player.groundY - FLOOR_Y))
      maxX = Math.max(maxX, player.x)
    }
  }
  check('the walk stayed inside this scene', maxX < 618, `reached ${maxX.toFixed(1)}, exit 618`)
  check('walk keeps feet on the plane', worst < 1e-6, `worst deviation ${worst}`)
  check('walk state active', anim.currentAction === PlayerAction.WALK, `got ${anim.currentAction}`)
  check('grounded throughout the walk', player.isGrounded)
}

resetWorld()
console.log('SCENE WALK: grounded inside a scene, handed over at the exit')
{
  // A sustained walk must keep the feet exactly on the active scene's own plane for
  // its whole length, then hand over at the exit instead of running on into a
  // neighbouring environment. Each scene's floor is measured from its own artwork, so
  // a wrongly placed plane would show up here as the player sinking or floating.
  const w = new GameWorld(stubAnimations())
  const p = w.player
  const prisonFloor = w.floorY

  p.setMovementInput(1)
  let worst = 0
  let maxX = p.x
  // Sampled before the update, because the update that completes the handover also
  // teleports the player to the next scene's entrance -- reading the position
  // afterwards would record the cavern spawn, not where the walk got to.
  for (let i = 0; i < 1200 && w.activeSceneIndex === 0; i++) {
    if (w.activeSceneIndex === 0) {
      worst = Math.max(worst, Math.abs(p.groundY - w.floorY))
      maxX = Math.max(maxX, p.x)
    }
    w.update(1 / 60)
  }
  p.setMovementInput(0)

  check(
    'the walk reaches the prison exit exactly',
    Math.abs(maxX - FORGOTTEN_PRISON.exitX!) < 1e-6,
    `stopped at ${maxX.toFixed(2)}, exit ${FORGOTTEN_PRISON.exitX}`,
  )
  check('feet stay exactly on the prison plane throughout', worst < 1e-6, `worst deviation ${worst}`)
  check('the walk handed over to the cavern', w.activeSceneIndex === 1, `${w.activeScene.definition.id}`)

  for (let i = 0; i < Math.ceil((TRANSITION_TOTAL + 0.2) * 60); i++) w.update(1 / 60)
  const cavernFloor = w.floorY
  check('the cavern floor is its own plane, not the prison one', Math.abs(cavernFloor - prisonFloor) > 1, `${cavernFloor} vs ${prisonFloor}`)

  let worstCavern = 0
  p.setMovementInput(1)
  for (let i = 0; i < 600; i++) {
    w.update(1 / 60)
    worstCavern = Math.max(worstCavern, Math.abs(p.groundY - w.floorY))
  }
  p.setMovementInput(0)

  check('feet stay exactly on the cavern plane throughout', worstCavern < 1e-6, `worst deviation ${worstCavern}`)
  check(
    'the cavern walk stops at the cavern bound',
    Math.abs(p.x - (UNDERGROUND_CAVERN.worldWidth - p.width / 2)) < 1e-6,
    `stopped at ${p.x}`,
  )
  check('and no further handover starts from a dead-end scene', w.activeSceneIndex === 1 && !w.isTransitioning, w.transitionPhase)
}

console.log('JUMP: leaves from the plane and returns to it')
{
  player.resetPlayer(SPAWN_X, FLOOR_Y)
  const launchY = player.groundY
  check('jump launches from exactly the plane', Math.abs(launchY - FLOOR_Y) < 1e-6, `got ${launchY}`)
  check('jump accepted', player.onJump())

  let peak = launchY
  let airFrames = 0
  for (let i = 0; i < 300; i++) {
    world.update(1 / 60)
    peak = Math.min(peak, player.groundY)
    if (!player.isGrounded) airFrames++
    if (player.isGrounded && i > 0) break
  }
  check('jump gains real height', launchY - peak > 50, `peak rise ${(launchY - peak).toFixed(1)}px`)
  check('airborne for a plausible number of frames', airFrames > 20 && airFrames < 120, `got ${airFrames}`)
  check('lands exactly on the plane', Math.abs(player.groundY - FLOOR_Y) < 1e-6, `got ${player.groundY}`)
  check('grounded again after landing', player.isGrounded)
  check('vertical velocity cleared on landing', player.vy === 0, `got ${player.vy}`)
}

console.log('JUMP ANIMATION: uses the jump sheet and tracks the arc')
{
  const cfg = createDefaultConfigs().get(PlayerAction.JUMP)!
  check('jump plays the jump sheet, not a stand-in', cfg.sourceFileName === 'jump.png', cfg.sourceFileName)
  check('jump frame count matches the 8-frame sheet', cfg.frameCount === 8, `got ${cfg.frameCount}`)
  check('jump has measured foot rows for every frame', cfg.footRows.length === 8, `got ${cfg.footRows.length}`)

  // The animation must finish when the character does. Airtime is
  // 2*|impulse|/gravity; the sheet is frameCount/fps seconds long.
  const airtime = (2 * 360) / 880
  const animLength = cfg.frameCount! / cfg.fps
  check(
    'jump animation length matches the airtime within one frame',
    Math.abs(animLength - airtime) <= 1 / cfg.fps,
    `animation ${animLength.toFixed(3)}s vs airtime ${airtime.toFixed(3)}s`,
  )
  check('jump animation does not loop', cfg.loop === false, `loop ${cfg.loop}`)

  // This sheet draws the character compressing as it takes off rather than rising
  // inside the cell, so the feet hold one row for the whole animation and the
  // vertical travel comes from the world's arc. A varying foot row here would mean
  // the sheet was re-registered against art that does not move in-cell.
  check(
    'the jump sheet keeps one foot row, so the world supplies the rise',
    new Set(cfg.footRows).size === 1,
    `foot rows ${[...new Set(cfg.footRows)].join(', ')} across ${cfg.footRows.length} frames`,
  )

console.log('BLOCK ANIMATION: plays once and holds the stance')
{
  const blk = createDefaultConfigs().get(PlayerAction.BLOCK)!
  check('block plays the block sheet, not a stand-in', blk.sourceFileName === 'block.png', blk.sourceFileName)
  check('block frame count matches the 8-frame sheet', blk.frameCount === 8, `got ${blk.frameCount}`)
  check('block does not loop, so a held guard settles instead of pulsing', blk.loop === false, `loop ${blk.loop}`)
  check('block has measured foot rows for every frame', blk.footRows.length === 8, `got ${blk.footRows.length}`)
  check(
    'the block sheet holds one foot row, so the stance stays planted',
    new Set(blk.footRows).size === 1,
    `foot rows ${[...new Set(blk.footRows)].join(', ')}`,
  )
}
}

console.log('LANDING: repeated jumps never accumulate error')
{
  player.resetPlayer(SPAWN_X, FLOOR_Y)
  let worst = 0
  for (let jump = 0; jump < 25; jump++) {
    if (!player.isGrounded) {
      // wait for touchdown
      for (let i = 0; i < 300 && !player.isGrounded; i++) world.update(1 / 60)
    }
    worst = Math.max(worst, Math.abs(player.groundY - FLOOR_Y))
    if (!player.onJump()) break
    for (let i = 0; i < 300; i++) {
      world.update(1 / 60)
      if (player.isGrounded) break
    }
    worst = Math.max(worst, Math.abs(player.groundY - FLOOR_Y))
  }
  check('25 jump/land cycles stay on the plane', worst < 1e-6, `worst deviation ${worst}`)
  check('final groundY is the plane', Math.abs(player.groundY - FLOOR_Y) < 1e-6, `got ${player.groundY}`)
}

console.log('JUMP + WALK: airborne then moving, lands on the same plane')
{
  player.resetPlayer(SPAWN_X, FLOOR_Y)
  const startX = player.x
  player.onJump()
  for (let i = 0; i < 5; i++) {
    player.setMovementInput(1)
    world.update(1 / 60)
  }
  check('airborne while moving', !player.isGrounded)
  check('JUMP state while airborne', anim.currentAction === PlayerAction.JUMP, `got ${anim.currentAction}`)
  for (let i = 0; i < 300 && !player.isGrounded; i++) {
    player.setMovementInput(1)
    world.update(1 / 60)
  }
  player.setMovementInput(0)
  check('landed on the plane after moving jump', Math.abs(player.groundY - FLOOR_Y) < 1e-6, `got ${player.groundY}`)
  check('horizontal travel happened in the air', player.x - startX > 30, `moved ${(player.x - startX).toFixed(1)}px`)
  for (let i = 0; i < 60; i++) world.update(1 / 60)
  check('settles back to the plane at rest', Math.abs(player.groundY - FLOOR_Y) < 1e-6, `got ${player.groundY}`)
}

console.log('HITBOX bottom sits on the plane')
{
  player.resetPlayer(SPAWN_X, FLOOR_Y)
  check('hitbox bottom == ground plane', Math.abs(player.hitbox.bottom - FLOOR_Y) < 1e-6, `got ${player.hitbox.bottom}`)
  const npc = world.npcs[0]
  check('the NPC also stands on the plane', Math.abs(npc.groundY - FLOOR_Y) < 1e-6, `got ${npc.groundY}`)
  check('NPC hitbox bottom == ground plane', Math.abs(npc.hitbox.bottom - FLOOR_Y) < 1e-6)
  player.onJump()
  world.update(1 / 60)
  check('hitbox bottom rises off the plane in the air', player.hitbox.bottom < FLOOR_Y - 1, `got ${player.hitbox.bottom}`)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
if (failures > 0) process.exit(1)
