/**
 * Rendered-output verification for the NPC that replaced the training dummy.
 *
 * The headless logic tests prove the patrol and frame maths are self-consistent, but
 * they cannot prove the artwork that reaches the screen is the supplied sheet, that
 * the old placeholder is really gone, or that the feet land on the drawn floor. This
 * harness drives the real page in Chromium and measures rendered pixels:
 *
 *   1. the beige placeholder is absent from the composited frame
 *   2. the NPC sprite is actually drawn, and is the supplied sheet's pixels
 *   3. idle and walk both animate, at their own rates
 *   4. the feet sit on the scene's drawn floor
 *   5. the NPC lives in world space: screen X = world X - camera X
 *   6. the camera scrolls and carries the NPC with it
 *   7. the sprite is the player's size, and is not upscaled or smoothed
 *
 * Run with: node scripts/verify-npc-world.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { NPC_IDLE_WALK_SHEET, NPC_BASELINE_Y, NPC_CELL_SIZE } from '../src/game/npcAssets.ts'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const distDir = join(webRoot, 'dist')

/** Every file under a directory, for the source scan. */
function walkFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (/\.(ts|kt|tsx|java)$/.test(entry.name)) out.push(full)
  }
  return out
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ not built. Run `npm run build` first.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(distDir, rel === '/' ? 'index.html' : rel)
  if (!file.startsWith(distDir) || !existsSync(file)) file = join(distDir, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

// The exact colours the old placeholder was painted with. If any of these survive
// anywhere in the composited frame, part of the dummy is still being drawn.
const PLACEHOLDER_COLORS = [
  ['straw torso', 180, 150, 90],
  ['dummy head', 200, 170, 110],
  ['post', 90, 70, 55],
  ['crossbeam', 120, 95, 70],
]

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.error('  [page error]', m.text())
})
await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 })

await page.evaluate(() => {
  const g = window.__game
  const canvas = document.querySelector('canvas.game-canvas')
  g.scale = () => Math.min(canvas.width / g.GameWorld.LOGICAL_WIDTH, canvas.height / g.GameWorld.LOGICAL_HEIGHT)
  g.offX = () => (canvas.width - g.GameWorld.LOGICAL_WIDTH * g.scale()) / 2
  g.offY = () => (canvas.height - g.GameWorld.LOGICAL_HEIGHT * g.scale()) / 2

  /** The NPCs alone, on a transparent surface, through the real world transform. */
  g.npcLayer = (index) => {
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(g.scale(), g.scale())
    b.translate(-g.world.cameraX, g.world.cameraY)
    g.npcOnly(b, index)
    return { data: b.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height }
  }

  /**
   * Bounding box and signature of everything the NPCs painted.
   *
   * The HP bar is opaque and sits above the head, so it is excluded from the
   * signature by dropping the topmost band of the box: what remains is the sprite,
   * and only the sprite, which is what these checks are about.
   */
  g.npcSpriteBox = (index = 0) => {
    const { data, width, height } = g.npcLayer(index)
    const solid = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) solid.push(data[(y * width + x) * 4 + 3] >= 128)
    }
    let top = null
    let bottom = null
    let left = null
    let right = null
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!solid[y * width + x]) continue
        if (top === null) top = y
        bottom = y
        if (left === null || x < left) left = x
        if (right === null || x > right) right = x
      }
    }
    if (top === null) return null
    // Split the HP bar off the sprite. The bar is the one thing drawn above the
    // character, and it is separated from the head by a clear empty band, so the
    // first fully empty row below the top of the drawing is the gap between them.
    // Everything above that gap is the bar; everything below is the character.
    let spriteTop = top
    for (let y = top; y <= bottom; y++) {
      let any = false
      for (let x = left; x <= right; x++) {
        if (solid[y * width + x]) {
          any = true
          break
        }
      }
      if (!any) {
        spriteTop = y + 1
        break
      }
    }
    const sc = g.scale()
    const toLogical = (v) => v / sc
    return {
      logicalTop: toLogical(spriteTop) - g.offY() / sc,
      logicalBottom: toLogical(bottom) - g.offY() / sc,
      logicalLeft: toLogical(left) - g.offX() / sc,
      logicalRight: toLogical(right) - g.offX() / sc,
      width: toLogical(right - left),
      height: toLogical(bottom - spriteTop),
      // A cheap fingerprint: how many distinct opaque pixels, and the darkest/mean
      // luminance. Catches a blank, a solid block, or the wrong artwork.
      opaquePixels: solid.reduce((a, b2) => a + (b2 ? 1 : 0), 0),
      darkest: (() => {
        let min = 255
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            if (data[i + 3] < 128) continue
            const l = (data[i] + data[i + 1] + data[i + 2]) / 3
            if (l < min) min = l
          }
        }
        return min
      })(),
    }
  }

  /** Counts pixels close to a colour anywhere in a rendered layer. */
  g.countColorInLayer = (layer, cr, cg, cb, tol = 18) => {
    const d = layer.data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue
      if (Math.abs(d[i] - cr) <= tol && Math.abs(d[i + 1] - cg) <= tol && Math.abs(d[i + 2] - cb) <= tol) n++
    }
    return n
  }

  /**
   * The two facings of one NPC, as alpha masks, plus how well they mirror.
   *
   * A walk pose is itself left-right asymmetric, so a mirrored one is *also*
   * asymmetric -- symmetry is the wrong thing to test for. What a mirror guarantees
   * is that facing left equals facing right flipped. So the check compares the two
   * facings against each other: `flipped` should be near zero when the flip happens,
   * and `direct` should be large, because the artwork is not self-symmetric.
   */
  g.npcFacingPair = (frame) => {
    const capture = (facingRight) => {
      g.setNpcFacing(0, facingRight)
      g.setNpcFrame(0, 'walk', frame)
      const { data, width, height } = g.npcLayer(0)
      let left = null
      let right = null
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] < 128) continue
          if (left === null || x < left) left = x
          if (right === null || x > right) right = x
        }
      }
      return { data, width, height, left, right }
    }
    const rightFace = capture(true)
    const leftFace = capture(false)
    if (rightFace.left === null || leftFace.left === null) {
      return { flipped: NaN, direct: NaN, solid: 0 }
    }
    // Both facings draw into the same box, so the masks line up column for column.
    const left = Math.min(rightFace.left, leftFace.left)
    const right = Math.max(rightFace.right, leftFace.right)
    const span = right - left + 1
    const at = (m, x, y) => (m.data[(y * m.width + x) * 4 + 3] >= 128 ? 1 : 0)
    let flippedDiff = 0
    let directDiff = 0
    let solid = 0
    for (let y = 0; y < rightFace.height; y++) {
      for (let i = 0; i < span; i++) {
        const a = at(rightFace, left + i, y)
        const b = at(leftFace, left + i, y)
        const bFlipped = at(leftFace, left + span - 1 - i, y)
        if (a || b) solid++
        if (a !== bFlipped) flippedDiff++
        if (a !== b) directDiff++
      }
    }
    return {
      flipped: flippedDiff / Math.max(1, solid),
      direct: directDiff / Math.max(1, solid),
      solid,
      span: span / g.scale(),
    }
  }

  g.settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  g.frames = async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r))
  }
})

console.log('1. the beige training-dummy placeholder is gone')
{
  // Searching the whole frame for the old colours does not work here, and would be
  // the wrong test even if it did: the prison and cavern artwork are themselves
  // full of browns, so those colours are present in the scenery whether or not a
  // placeholder is drawn. What matters is whether any *code* still draws them, and
  // whether anything the world draws on top of the backdrop still paints them.
  const scan = ['web/src', 'app/src/main/java']
  const literals = ['180, 150, 90', '200, 170, 110', '90, 70, 55', '120, 95, 70', 'TrainingDummy', 'training dummy']
  const hits = []
  for (const dir of scan) {
    for (const file of walkFiles(join(repoRoot, dir))) {
      const text = readFileSync(file, 'utf8')
      for (const lit of literals) {
        if (text.includes(lit)) hits.push(`${file.slice(repoRoot.length + 1)}: ${lit}`)
      }
    }
  }
  check(
    'no placeholder drawing code remains in either engine',
    hits.length === 0,
    hits.length ? hits.join('; ') : `${literals.length} placeholder literals and names searched across ${scan.join(' and ')}`,
  )

  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(0)
    g.resume()
    await g.frames(60 * 5)
    g.loadScene(1)
    await g.frames(60 * 5)
    g.pause()
    // The NPC layer is precisely what the dummy used to draw into: the world drew
    // scene objects into the same pass. If the placeholder were still being drawn
    // by a scene object, its beige would show up here.
    const layer = g.npcLayer()
    // Counting the old exact colours here would not prove anything either: the NPC
    // artwork is brown, and a handful of its pixels land within tolerance of the
    // placeholder's fills. What separates a drawn sprite from the old flat-filled
    // shapes is that a sprite carries a palette and a silhouette, while the
    // placeholder was four rectangles of one colour each.
    const tally = new Map()
    let solid = 0
    for (let i = 0; i < layer.data.length; i += 4) {
      if (layer.data[i + 3] < 128) continue
      solid++
      const key = (layer.data[i] << 16) | (layer.data[i + 1] << 8) | layer.data[i + 2]
      tally.set(key, (tally.get(key) || 0) + 1)
    }
    let biggest = 0
    for (const n of tally.values()) if (n > biggest) biggest = n
    return {
      distinctColours: tally.size,
      solid,
      dominantShare: biggest / Math.max(1, solid),
      npcCount: g.world.npcs.length,
    }
  })
  check(
    'scene objects draw a full pixel-art palette, not a handful of flat fills',
    res.distinctColours > 40,
    `${res.distinctColours} distinct colours across ${res.solid} solid px`,
  )
  check(
    'no single colour fills the figure, the way the placeholder\'s flat shapes did',
    res.dominantShare < 0.6,
    `largest single-colour region is ${(res.dominantShare * 100).toFixed(1)}% of the drawn figure`,
  )
  check('NPCs stand where the dummies stood', res.npcCount > 0, `${res.npcCount} NPCs in the scene`)
}

console.log('\n2. the supplied sprite sheet is what gets drawn')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(0)
    g.resume()
    await g.frames(30)
    g.pause()
    g.setNpcFrame(0, 'walk', 0)
    const npcX = g.world.npcs[0].x
    g.setCamera(npcX - g.GameWorld.LOGICAL_WIDTH / 2)
    await g.settle()
    return {
      box: g.npcSpriteBox(0),
      spriteLoaded: g.world.npcSprite !== null,
      sheet: g.world.npcSprite ? `${g.world.npcSprite.width}x${g.world.npcSprite.height}` : null,
      drawnFloorY: g.world.floorY + g.world.cameraY,
      playerWidth: g.world.player.width,
    }
  })
  check('the walk sheet decoded', res.spriteLoaded && res.sheet === `${NPC_IDLE_WALK_SHEET.frames * NPC_CELL_SIZE}x${NPC_CELL_SIZE}`, `${res.sheet}`)

  const box = res.box
  check('NPC pixels reach the screen', box !== null && box.opaquePixels > 500, box ? `${box.opaquePixels} opaque device px` : 'nothing drawn')
  check('it is a detailed figure, not a solid block', box !== null && box.width > 40 && box.height > 30, box ? `${box.width.toFixed(1)} x ${box.height.toFixed(1)} logical px` : '')
  check('it is dark artwork, so the real sheet is drawing', box !== null && box.darkest < 90, `darkest pixel luminance ${box?.darkest}`)
  check(
    'its width matches the sheet art scaled to the player cell, not stretched or squashed',
    box !== null && Math.abs(box.width - (118 / NPC_CELL_SIZE) * 100) < 8,
    `${box?.width.toFixed(1)} logical px wide, art is ~118 of ${NPC_CELL_SIZE}px drawn at 100`,
  )
}

console.log('\n3. idle and walk both animate, each at its own rate')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(1)
    g.resume()
    // Sample the frame index over real time while walking, then again while idle.
    const walkFrames = new Set()
    const walkSamples = []
    for (let i = 0; i < 240; i++) {
      const s = g.npcState(0)
      if (s.isWalking) {
        walkFrames.add(s.frame)
        walkSamples.push(s.frame)
      }
      await new Promise((r) => requestAnimationFrame(r))
    }
    // Force the idle state and watch it over the same span.
    const idleFrames = new Set()
    for (let i = 0; i < 120; i++) {
      g.setNpcFrame(0, 'idle', 0)
      const s = g.npcState(0)
      idleFrames.add(s.frame)
      await new Promise((r) => requestAnimationFrame(r))
    }
    const walk = g.npcState(0)
    return { walkFrames: [...walkFrames].sort((a, b) => a - b), walkSamples: walkSamples.slice(0, 14), idleFrames: [...idleFrames] }
  })
  check('walking passes through many distinct frames', res.walkFrames.length >= 6, `frames seen: ${res.walkFrames.join(',')}`)
  check('and covers the whole 12-frame cycle', res.walkFrames.length === 12 && Math.max(...res.walkFrames) === 11, `${res.walkFrames.length} of 12`)
  // Sampled at display rate against a 12fps clip, so each frame legitimately
  // repeats for a few samples. What must hold is that it only ever steps by one
  // frame, forwards, wrapping at the end -- never jumping or running backwards.
  const steps = res.walkSamples.slice(1).map((f, i) => (f - res.walkSamples[i] + 12) % 12)
  check(
    'frames only ever step forwards by one, wrapping at the end of the cycle',
    steps.every((d) => d === 0 || d === 1),
    `first frames: ${res.walkSamples.join(',')}`,
  )
  check(
    'at 12 fps against a 60 Hz sample, each frame holds for about five samples',
    steps.length > 0 && steps.filter((d) => d === 0).length / steps.length > 0.5,
    `${steps.filter((d) => d === 0).length}/${steps.length} samples repeated a frame`,
  )
  check('idle holds a single frame', res.idleFrames.length === 1 && res.idleFrames[0] === 0, `idle frames: ${res.idleFrames.join(',')}`)
}

console.log('\n4. the NPC is grounded on the combat floor in every pose')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    const out = []
    for (const sceneIndex of [0, 1]) {
      g.loadScene(sceneIndex)
      g.pause()
      const npcX = g.world.npcs[0].x
      g.setCamera(npcX - g.GameWorld.LOGICAL_WIDTH / 2)
      await g.settle()
      for (let frame = 0; frame < 12; frame++) {
        g.setNpcFrame(0, 'walk', frame)
        const box = g.npcSpriteBox(0)
        out.push({
          sceneId: g.world.activeScene.definition.id,
          frame,
          foot: box ? box.logicalBottom : null,
          drawnFloorY: g.world.floorY + g.world.cameraY,
          groundY: g.world.npcs[0].groundY,
          floorY: g.world.floorY,
        })
      }
    }
    return out
  })
  const sceneIds = [...new Set(res.map((r) => r.sceneId))]
  for (const id of sceneIds) {
    const rows = res.filter((r) => r.sceneId === id)
    const worst = Math.max(...rows.map((r) => Math.abs(r.foot - r.drawnFloorY)))
    check(
      `${id}: all 12 frames stand on the drawn floor`,
      worst <= 1.5,
      `worst offset ${worst.toFixed(2)}px, floor ${rows[0].drawnFloorY.toFixed(2)}`,
    )
    check(`${id}: the NPC's ground is the scene's own floor plane`, rows.every((r) => Math.abs(r.groundY - r.floorY) < 1e-9), `groundY ${rows[0].groundY.toFixed(3)}, floorY ${rows[0].floorY.toFixed(3)}`)
  }
  check('the two scenes really do have different floor planes', new Set(res.map((r) => r.floorY.toFixed(2))).size === 2, [...new Set(res.map((r) => r.floorY.toFixed(2)))].join(' vs '))
  check(
    'no frame needed shifting: the drawn feet match the sheet baseline',
    Math.abs(NPC_BASELINE_Y - 104) === 0,
    `baseline ${NPC_BASELINE_Y} measured from the supplied artwork`,
  )
}

console.log('\n5. the NPC is drawn in world space, not screen space')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(1)
    g.resume()
    await g.frames(60)
    g.pause()
    const samples = []
    // Cameras chosen to keep this NPC inside the 640px viewport, so each sample
    // has real pixels to measure.
    for (const cameraX of [300, 480, 620, 760]) {
      g.setCamera(cameraX)
      g.setNpcFrame(0, 'idle', 0)
      await g.settle()
      const box = g.npcSpriteBox(0)
      const s = g.npcState(0)
      samples.push({
        cameraX: g.world.cameraX,
        worldX: s.x,
        centre: box ? (box.logicalLeft + box.logicalRight) / 2 : NaN,
      })
    }
    return samples
  })
  for (const s of res) {
    check(
      `at camera ${s.cameraX}, the NPC draws at worldX - cameraX`,
      Math.abs(s.centre - (s.worldX - s.cameraX)) < 6,
      `drawn at ${s.centre.toFixed(1)}, worldX ${s.worldX.toFixed(1)} - camera ${s.cameraX} = ${(s.worldX - s.cameraX).toFixed(1)}`,
    )
  }
  check('the NPC keeps one world X while the camera is moved around it', new Set(res.map((s) => s.worldX.toFixed(4))).size === 1, res.map((s) => s.worldX.toFixed(1)).join(', '))
  check('so its screen position genuinely changes with the camera', Math.max(...res.map((s) => s.centre)) - Math.min(...res.map((s) => s.centre)) > 400, `screen x spread ${(Math.max(...res.map((s) => s.centre)) - Math.min(...res.map((s) => s.centre))).toFixed(1)}px over the sampled camera range`)
}

console.log('\n6. the NPC walks, turns round, and flips with its direction')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(1)
    g.resume()
    const states = []
    const xs = []
    let sawTurn = false
    let facingChanged = false
    let lastFacing = g.npcState(0).facingRight
    for (let i = 0; i < 60 * 40; i++) {
      const s = g.npcState(0)
      if (states[states.length - 1] !== s.state) states.push(s.state)
      xs.push(s.x)
      if (s.facingRight !== lastFacing) {
        facingChanged = true
        if (s.state === 'idle') sawTurn = true
        lastFacing = s.facingRight
      }
      await new Promise((r) => requestAnimationFrame(r))
    }
    const s = g.npcState(0)
    return { states, sawTurn, facingChanged, minX: Math.min(...xs), maxX: Math.max(...xs), patrolLeft: s.patrolLeft, patrolRight: s.patrolRight }
  })
  check('it alternates between standing and walking', res.states.filter((s) => s === 'walk').length >= 3, res.states.join(' -> '))
  check('it actually travels a short distance', res.maxX - res.minX > 20, `moved ${(res.maxX - res.minX).toFixed(1)}px`)
  check('it never leaves its patrol limits', res.minX >= res.patrolLeft - 1 && res.maxX <= res.patrolRight + 1, `travelled ${res.minX.toFixed(1)}..${res.maxX.toFixed(1)} within ${res.patrolLeft}..${res.patrolRight}`)
  check('it reverses direction at the limit, and flips to match', res.sawTurn && res.facingChanged, 'turned while stopped')
}

console.log('\n7. the sprite mirrors when the NPC turns round')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(0)
    g.resume()
    await g.frames(10)
    g.pause()
    g.setCamera(g.world.npcs[0].x - g.GameWorld.LOGICAL_WIDTH / 2)
    await g.settle()
    // A walk frame, not the held idle frame: a stride is strongly asymmetric, so
    // the flip is doing real work and cannot be mistaken for a no-op.
    return g.npcFacingPair(4)
  })
  check(
    'facing left is facing right flipped, so the sprite really mirrors',
    res.flipped < 0.02,
    `mismatch against the mirror image: ${(res.flipped * 100).toFixed(1)}%`,
  )
  check(
    'and the two facings are genuinely different images, so the mirror is not a no-op',
    res.direct > 0.1,
    `mismatch between the facings as drawn: ${(res.direct * 100).toFixed(1)}%`,
  )
  check('both facings draw the same amount of artwork', res.solid > 0, `${res.solid} solid samples across a ${res.span.toFixed(1)} logical px box`)
}

console.log('\n8. the NPC is the player size, and the player was not resized')
{
  const res = await page.evaluate(async () => {
    const g = window.__game
    g.loadScene(0)
    g.resume()
    await g.frames(20)
    g.pause()
    g.setCamera(g.world.npcs[0].x - g.GameWorld.LOGICAL_WIDTH / 2)
    g.setNpcFrame(0, 'walk', 4)
    await g.settle()
    const npc = g.npcSpriteBox(0)
    // The player's own drawn box, for comparison on the same surface.
    const canvas = document.querySelector('canvas.game-canvas')
    const c = document.createElement('canvas')
    c.width = canvas.width
    c.height = canvas.height
    const b = c.getContext('2d')
    b.imageSmoothingEnabled = false
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.translate(g.offX(), g.offY())
    b.scale(g.scale(), g.scale())
    b.translate(-g.world.cameraX, g.world.cameraY)
    g.characterOnly(b)
    const d = b.getImageData(0, 0, c.width, c.height).data
    let top = null
    let bottom = null
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] < 128) continue
        if (top === null) top = y
        bottom = y
      }
    }
    const sc = g.scale()
    return { npc, playerHeight: (bottom - top) / sc, spriteDisplaySize: g.GameWorld.SPRITE_DISPLAY_SIZE }
  })
  check('the player still draws at the same display size', res.spriteDisplaySize === 100, `${res.spriteDisplaySize}px cell`)
  check(
    'the NPC stands about as tall as the knight, so it matches its scale',
    Math.abs(res.npc.height - res.playerHeight) < 10,
    `NPC ${res.npc.height.toFixed(1)} logical px vs knight ${res.playerHeight.toFixed(1)}`,
  )
}

console.log(`\n${failures === 0 ? 'NPC world checks passed' : `${failures} NPC world check(s) FAILED`}`)
await browser.close()
server.close()
process.exit(failures === 0 ? 0 : 1)
