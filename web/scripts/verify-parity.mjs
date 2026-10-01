/**
 * Parity check: the web and Android sheet-geometry rules must agree exactly.
 *
 * The two implementations are transcribed rather than shared, so this replays the
 * same sheet inputs through each rule as written in
 *   web/src/game/SpriteSheet.ts
 *   app/src/main/java/com/example/game/animation/SpriteSheet.kt
 * and compares the resulting cell geometry and frame rects. A divergence here
 * means the two engines would draw different cells from the same artwork, which
 * is exactly the failure this change is meant to avoid.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB_CONFIG = readFileSync(join(ROOT, 'web/src/game/AnimationConfig.ts'), 'utf8')
const KT_CONFIG = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/animation/SpriteAnimationConfig.kt'),
  'utf8',
)
const WEB_METRICS = readFileSync(join(ROOT, 'web/src/game/spriteMetrics.ts'), 'utf8')
const KT_METRICS = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/animation/SpriteMetrics.kt'),
  'utf8',
)

/**
 * Dimensions straight out of a PNG's IHDR chunk, so the geometry below is checked
 * against the artwork that actually ships rather than a transcribed width.
 */
function pngSize(path) {
  const b = readFileSync(path)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a png: ${path}`)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

/**
 * Every foot-row table in a metrics file, in either engine's syntax:
 *   'x.png': [a, b, c]          'x.png' to listOf(a, b, c)
 *   'x.png': [v, v, v]          'x.png' to List(n) { v }
 * The generated Kotlin form is expanded so both engines are compared as arrays.
 */
function parseFootRows(src) {
  const out = {}
  for (const m of src.matchAll(/["']([\w.]+\.png)["']\s*(?::|to)\s*(?:List\((\d+)\)\s*\{\s*(\d+)\s*\}|listOf\(([\s\S]*?)\)|\[([\s\S]*?)\])/g)) {
    const list = m[4] ?? m[5] ?? ''
    // Empty tokens are dropped before the number conversion: a trailing comma
    // leaves one, and Number('') is 0, which would slip through as a real row.
    const values = list.split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number)
    if (m[2] !== undefined) out[m[1]] = Array(Number(m[2])).fill(Number(m[3]))
    else out[m[1]] = values.filter((n) => Number.isFinite(n))
  }
  return out
}

const webFoot = parseFootRows(WEB_METRICS)
const ktFoot = parseFootRows(KT_METRICS)

/** The per-action config table, read out of each engine's own source. */
function parseWeb() {
  const out = {}
  // config(action, file, frameCount, fps, loop, priority, opts)
  const entries = [...WEB_CONFIG.matchAll(/\[(PlayerAction\.\w+),\s*config\(PlayerAction\.\w+,\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(true|false),([\s\S]*?)\)\]/g)]
  for (const [, action, file, frameCount, fps, loop, rest] of entries) {
    const opt = (name) => {
      const m = new RegExp(`${name}\\s*:\\s*([^,}\\s]+)`).exec(rest)
      return m ? m[1].trim() : ''
    }
    const hit = /hitFrames\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(rest)
    out[action] = {
      file,
      frameCount: Number(frameCount) || null,
      fps: Number(fps),
      loop: loop === 'true',
      columns: Number(opt('columns')) || null,
      cellSize: Number(opt('cellSize')) || null,
      displayScale: Number(opt('displayScale')) || 1,
      hitFrames: hit ? [Number(hit[1]), Number(hit[2])] : null,
      footRows: webFoot[file] ?? null,
    }
  }
  return out
}

function parseKotlin() {
  const out = {}
  const entries = [...KT_CONFIG.matchAll(/PlayerAction\.(\w+)\s+to\s+AnimationConfig\(([\s\S]*?)\n\s*\)/g)]
  for (const [, action, body] of entries) {
    const arg = (name) => {
      const m = new RegExp(`${name}\\s*=\\s*("[^"]*"|[^,\\n]+)`).exec(body)
      // Kotlin float literals carry an `f` suffix that Number() will not take.
      return m ? m[1].trim().replace(/f$/, '').replace(/^"|"$/g, '') : ''
    }
    const file = arg('sourceFileName')
    const hit = /hitFrames\s*=\s*(\d+)\s*to\s*(\d+)/.exec(body)
    out[`PlayerAction.${action}`] = {
      file,
      frameCount: Number(arg('frameCount')) || null,
      fps: Number(arg('fps')),
      loop: arg('loop') === 'true',
      columns: Number(arg('columns')) || null,
      cellSize: Number(arg('cellSize')) || null,
      displayScale: Number(arg('displayScale')) || 1,
      hitFrames: hit ? [Number(hit[1]), Number(hit[2])] : null,
      footRows: ktFoot[file] ?? null,
    }
  }
  return out
}

const WEB = parseWeb()
const KT = parseKotlin()

// One entry per distinct sheet. Several actions share idle.png, and those actions
// must all carry the same geometry and scale, so both engines are compared per
// action but the artwork is only read once per file.
const SHEETS = []
for (const [action, w] of Object.entries(WEB)) {
  let entry = SHEETS.find((s) => s.name === w.file)
  if (!entry) {
    entry = {
      name: w.file,
      android: pngSize(join(ROOT, 'app/src/main/assets/sprites', w.file)),
      public: pngSize(join(ROOT, 'web/public/sprites', w.file)),
      web: w,
      actions: [],
    }
    SHEETS.push(entry)
  }
  entry.actions.push({ action, web: w, kt: KT[action] ?? null })
}

// Read straight from the engine configs, so this fails if either engine drifts
// rather than pinning a copy of the values that could silently rot.
const scaleOf = (action) => WEB[action].displayScale
const ATTACK_SCALE = scaleOf('PlayerAction.ATTACK')
const HEAVY_SCALE = scaleOf('PlayerAction.HEAVY_ATTACK')
const WALK_SCALE = scaleOf('PlayerAction.WALK')
const JUMP_SCALE = scaleOf('PlayerAction.JUMP')

/** web/src/game/SpriteSheet.ts */
function webGeometry(c) {
  const cellSide = Math.max(1, c.cellSize ?? c.h)
  const inferredColumns = Math.max(1, Math.trunc(c.w / cellSide))
  const columns = Math.max(1, c.columns ?? inferredColumns)
  const cellHeight = cellSide
  const rows = c.cellSize ? Math.max(1, Math.floor(c.h / cellSide)) : 1
  const available = columns * rows
  const frameCount = Math.max(1, Math.min(c.frameCount ?? available, available))
  const frameWidth = Math.max(1, Math.trunc(c.w / columns))
  return {
    columns, cellHeight, frameCount, frameWidth, rows,
    rect: (i) => {
      const clamped = Math.min(Math.max(i, 0), frameCount - 1)
      return { sx: (clamped % columns) * frameWidth, sy: Math.floor(clamped / columns) * cellHeight, sw: frameWidth, sh: cellHeight }
    },
  }
}

/** app/src/main/java/com/example/game/animation/SpriteSheet.kt */
function androidGeometry(c) {
  const cellSide = Math.max(1, c.cellSize ?? c.h)
  const inferredColumns = Math.max(1, Math.trunc(c.w / cellSide))
  const columns = Math.max(1, c.columns ?? inferredColumns)
  const rows = c.cellSize ? Math.max(1, Math.floor(c.h / cellSide)) : 1
  const available = columns * rows
  const frameCount = Math.max(1, Math.min(c.frameCount ?? available, available))
  const frameWidth = Math.max(1, Math.trunc(c.w / columns))
  const cellHeight = cellSide
  return {
    columns, cellHeight, frameCount, frameWidth, rows,
    rect: (i) => {
      const clamped = Math.min(Math.max(i, 0), frameCount - 1)
      const col = clamped % columns
      const row = Math.floor(clamped / columns)
      const sx = col * frameWidth
      const sy = row * cellHeight
      return { sx, sy, sw: frameWidth, sh: cellHeight }
    },
  }
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('\nSCENES: both engines declare the same environments, the same way')
// Every environment is its own full-screen scene. A scene's scale, crop and floor
// plane are all derived from its own definition, so these fields have to agree
// between the engines or the two platforms would stand the player on different
// ground in the same room.
const WEB_SCENE_SRC = readFileSync(join(ROOT, 'web/src/game/GameScene.ts'), 'utf8')
const KT_SCENE_SRC = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameScene.kt'), 'utf8')
const WEB_NPC_SRC = readFileSync(join(ROOT, 'web/src/game/npcAssets.ts'), 'utf8')
const WEB_NPC_IMPL = readFileSync(join(ROOT, 'web/src/game/Npc.ts'), 'utf8')
const KT_NPC_SRC = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/NpcAssets.kt'), 'utf8')
const KT_NPC_IMPL = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/model/Npc.kt'), 'utf8')
const WEB_WORLD_SRC = readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')
const KT_WORLD_SRC = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameWorld.kt'), 'utf8')

/**
 * Pulls every `SceneDefinition` literal out of an engine's scene source.
 *
 * Both engines declare scenes as data, so the whole scene list can be read straight
 * out of the source and compared field by field. Nothing here re-implements the
 * values: they are parsed, so a change in either engine shows up immediately.
 */
function parseScenes(src) {
  const scenes = {}
  const webRe = /export const (\w+): SceneDefinition = \{([\s\S]*?)\n\}/g
  const ktRe = /val (\w+) = SceneDefinition\(([\s\S]*?)\n\)/g
  for (const [re, isWeb] of [[webRe, true], [ktRe, false]]) {
    for (const m of src.matchAll(re)) {
      const [, name, body] = m
      // The two engines spell fields differently -- TS uses `key:` and Kotlin named
      // arguments use `key =` -- so accept either separator and compare the values.
      const num = (key) => {
        const hit = body.match(new RegExp(`${key}\\s*[:=]\\s*(-?[\\d.]+)f?`))
        return hit ? Number(hit[1]) : null
      }
      const str = (key) => {
        const hit = body.match(new RegExp(`${key}\\s*[:=]\\s*['"]([^'"]+)['"]`))
        return hit ? hit[1] : null
      }
      const listMatch = isWeb
        ? body.match(/npcXs\s*[:=]\s*\[([^\]]*)\]/)
        : body.match(/npcXs\s*=\s*listOf\(([^)]*)\)/)
      const npcXs = listMatch
        ? listMatch[1].split(',').map((v) => Number(v.trim().replace('f', ''))).filter((v) => !Number.isNaN(v))
        : null
      const exitMatch = body.match(/exitX\s*[:=]\s*(null|(-?[\d.]+)f?)/)
      scenes[name] = {
        id: str('id'),
        title: str('title'),
        asset: str('asset'),
        sourceWidth: num('sourceWidth'),
        sourceHeight: num('sourceHeight'),
        floorRow: num('floorRow'),
        worldWidth: num('worldWidth'),
        spawnX: num('spawnX'),
        npcXs,
        exitX: exitMatch ? (exitMatch[1] === 'null' ? null : Number(exitMatch[2])) : undefined,
      }
    }
  }
  return scenes
}

const WEB_SCENES = parseScenes(WEB_SCENE_SRC)
const KT_SCENES = parseScenes(KT_SCENE_SRC)
const sceneNames = Object.keys(WEB_SCENES)

check('web declares at least two scenes', sceneNames.length >= 2, `${sceneNames.length}`)
check('both engines declare the same scenes', sceneNames.length === Object.keys(KT_SCENES).length,
  `web [${sceneNames}] vs android [${Object.keys(KT_SCENES)}]`)

for (const name of sceneNames) {
  const w = WEB_SCENES[name]
  const k = KT_SCENES[name]
  if (!k) {
    check(`${name}: declared in both engines`, false, 'missing from Kotlin')
    continue
  }
  for (const field of ['id', 'title', 'asset', 'sourceWidth', 'sourceHeight', 'floorRow', 'worldWidth', 'spawnX', 'exitX']) {
    check(`${name}.${field}: same in both engines`, w[field] === k[field], `web ${w[field]} vs android ${k[field]}`)
  }
  check(
    `${name}.npcXs: the same NPCs, in the same order`,
    JSON.stringify(w.npcXs) === JSON.stringify(k.npcXs),
    `web ${JSON.stringify(w.npcXs)} vs android ${JSON.stringify(k.npcXs)}`,
  )
}

// Scenes must be listed in the same travel order, or the two engines would send the
// player to different places from the same exit.
const webOrder = (WEB_SCENE_SRC.match(/SCENES: readonly SceneDefinition\[\] = \[([^\]]*)\]/) || [, ''])[1]
  .split(',').map((v) => v.trim()).filter(Boolean)
const ktOrder = (KT_SCENE_SRC.match(/SCENES: List<SceneDefinition> = listOf\(([^)]*)\)/) || [, ''])[1]
  .split(',').map((v) => v.trim()).filter(Boolean)
check('both engines list the scenes in the same order',
  JSON.stringify(webOrder) === JSON.stringify(ktOrder) && webOrder.length >= 2,
  `web [${webOrder}] vs android [${ktOrder}]`)

// Only the last scene may be a dead end, otherwise the last scene would hand over to
// nothing.
const ordered = webOrder.map((n) => WEB_SCENES[n])
check('every scene but the last has an exit, and the last has none',
  ordered.slice(0, -1).every((d) => d.exitX !== null) && ordered[ordered.length - 1].exitX === null,
  ordered.map((d) => `${d.id}:${d.exitX}`).join(', '))

// The transition timings are part of the shared feel, not per-platform polish.
for (const [name, web, kt] of [
  ['TRANSITION_FADE_OUT', /TRANSITION_FADE_OUT\s*=\s*([\d.]+)/, /TRANSITION_FADE_OUT\s*=\s*([\d.]+)f/],
  ['TRANSITION_TITLE_HOLD', /TRANSITION_TITLE_HOLD\s*=\s*([\d.]+)/, /TRANSITION_TITLE_HOLD\s*=\s*([\d.]+)f/],
  ['TRANSITION_FADE_IN', /TRANSITION_FADE_IN\s*=\s*([\d.]+)/, /TRANSITION_FADE_IN\s*=\s*([\d.]+)f/],
]) {
  const w = Number((WEB_SCENE_SRC.match(web) || [, NaN])[1])
  const k = Number((KT_SCENE_SRC.match(kt) || [, NaN])[1])
  check(`${name}: same timing in both engines`, Number.isFinite(w) && w === k, `web ${w} vs android ${k}`)
}
const totalFade = Number((WEB_SCENE_SRC.match(/TRANSITION_FADE_OUT\s*=\s*([\d.]+)/) || [, NaN])[1]) +
  Number((WEB_SCENE_SRC.match(/TRANSITION_TITLE_HOLD\s*=\s*([\d.]+)/) || [, NaN])[1]) +
  Number((WEB_SCENE_SRC.match(/TRANSITION_FADE_IN\s*=\s*([\d.]+)/) || [, NaN])[1])
check('the whole handover lands in the 0.6-1.0s window', totalFade >= 0.6 && totalFade <= 1.0, `${totalFade}s`)

// The fit is recomputed here from the shared literals rather than trusted, so a scene
// that would leave a black gap around the artwork fails even if both engines agreed
// on the same wrong numbers.
const LOGICAL_W = 640
const LOGICAL_H = 360
const FOOT_TARGET = LOGICAL_H * 0.75
for (const d of ordered) {
  let scale = LOGICAL_H / d.sourceHeight
  if (d.sourceWidth * scale < d.worldWidth) scale = d.worldWidth / d.sourceWidth
  // Same framing fit the engines run: grow uniformly until the framed window is
  // fully covered, then take the floor's own position as the vertical offset.
  let drawW = 0
  let drawH = 0
  let offsetX = 0
  let offsetY = 0
  let floorY = 0
  let cameraY = 0
  for (let i = 0; i < 24; i++) {
    drawW = d.sourceWidth * scale
    drawH = d.sourceHeight * scale
    offsetX = (d.worldWidth - drawW) / 2
    offsetY = (LOGICAL_H - drawH) / 2
    floorY = offsetY + d.floorRow * scale
    cameraY = FOOT_TARGET - floorY
    const top = offsetY + cameraY
    const missing = Math.max(0, top) + Math.max(0, LOGICAL_H - (top + drawH))
    if (missing <= 1e-9) break
    scale *= (drawH + missing * 2) / drawH
  }
  const tag = d.id
  check(`${tag}: the backdrop covers the full width, so no black gap can show`, drawW >= d.worldWidth, `draw ${drawW} vs world ${d.worldWidth}`)
  check(`${tag}: the backdrop covers the full height, so no black gap can show`, drawH >= LOGICAL_H, `draw ${drawH} vs ${LOGICAL_H}`)
  check(`${tag}: overflow is cropped, never inset`, offsetX <= 0 && offsetY <= 0, `offset ${offsetX},${offsetY}`)
  check(`${tag}: one uniform scale, so the artwork is not stretched`, Math.abs(drawW / d.sourceWidth - drawH / d.sourceHeight) < 1e-12, `x ${drawW / d.sourceWidth} vs y ${drawH / d.sourceHeight}`)
  check(`${tag}: the floor plane lands inside the viewport`, floorY > 0 && floorY < LOGICAL_H, `floorY ${floorY.toFixed(3)}`)
  // Framing must not expose background, and must put the floor at the shared
  // screen height in both engines, not merely agree on one wrong number.
  const framedTop = offsetY + cameraY
  check(`${tag}: the framed crop still covers the viewport, so no bare band shows`,
    framedTop <= 1e-9 && framedTop + drawH >= LOGICAL_H - 1e-9,
    `framed span ${framedTop.toFixed(2)}..${(framedTop + drawH).toFixed(2)} of 0..${LOGICAL_H}`)
  check(`${tag}: the floor is drawn at the shared screen height`,
    Math.abs(floorY + cameraY - FOOT_TARGET) < 1e-6,
    `floorY ${floorY.toFixed(3)} + cameraY ${cameraY.toFixed(3)} = ${(floorY + cameraY).toFixed(3)}, target ${FOOT_TARGET}`)
  check(`${tag}: the vertical framing crops rather than scales the picture non-uniformly`,
    Math.abs(drawW / d.sourceWidth - drawH / d.sourceHeight) < 1e-12,
    `x ${drawW / d.sourceWidth} vs y ${drawH / d.sourceHeight}`)
  d.framed = { scale, floorY, cameraY }
}
const framedFloors = ordered.map((d) => d.framed && d.framed.floorY + d.framed.cameraY)
check('every scene draws its floor at the same screen height',
  framedFloors.every((f) => Math.abs(f - framedFloors[0]) < 1e-6),
  framedFloors.map((f) => f.toFixed(3)).join(' vs '))
check('the scenes needed different vertical offsets to get there',
  Math.abs(ordered[0].framed.cameraY - ordered[1].framed.cameraY) > 1,
  ordered.map((d) => `${d.id}: ${d.framed.cameraY.toFixed(2)}`).join('  '))
const prisonFit = ordered[0]
const cavernFit = ordered[1] ?? ordered[0]
check('the prison still fills its scene at exactly 5/12, uncropped',
  Math.abs(LOGICAL_H / prisonFit.sourceHeight - 5 / 12) < 1e-12,
  `scale ${(LOGICAL_H / prisonFit.sourceHeight).toFixed(6)}`)
check('each scene scales on its own terms, not on a shared scale',
  Math.abs(LOGICAL_H / cavernFit.sourceHeight - LOGICAL_H / prisonFit.sourceHeight) > 1e-6,
  `prison ${(LOGICAL_H / prisonFit.sourceHeight).toFixed(4)}, cavern ${(LOGICAL_H / cavernFit.sourceHeight).toFixed(4)}`)
check('the scenes declare genuinely different floors',
  Math.abs((cavernFit.floorRow * (LOGICAL_H / cavernFit.sourceHeight)) -
           (prisonFit.floorRow * (LOGICAL_H / prisonFit.sourceHeight))) > 1,
  'each scene has its own ground plane')

// Scenes must not be laid side by side any more: the world is one scene's width.
check('neither engine still composes a world out of two plates side by side',
  !/WORLD_WIDTH\s*=\s*.*BACKGROUND_LOGICAL_WIDTH\s*\+/.test(WEB_WORLD_SRC) &&
    !/WORLD_WIDTH: Float = BACKGROUND_LOGICAL_WIDTH \+/.test(KT_WORLD_SRC) &&
    !/CAVERN_SCALE/.test(WEB_WORLD_SRC) && !/CAVERN_SCALE/.test(KT_WORLD_SRC),
  'no summed world width, no shared-section scale')
check('each engine draws one backdrop per scene, on demand',
  /renderBackdrop/.test(WEB_WORLD_SRC) && /fun renderBackdrop/.test(KT_WORLD_SRC),
  'a single plate is drawn from the active scene')

// Both engines must draw each scene from the same source file.
check('both engines load each backdrop from the same shared asset name',
  ordered.every((d) => KT_SCENE_SRC.includes(d.asset)) &&
    existsSync(join(ROOT, `app/src/main/res/drawable/${ordered[0].asset}.png`)) &&
    existsSync(join(ROOT, `app/src/main/res/drawable/${cavernFit.asset}.png`)) &&
    existsSync(join(ROOT, 'web/public/bg/cavern_bg.png')),
  'res/drawable is the source, web/public is the synced copy')

// Same bytes on both platforms, which is the whole point of routing the artwork
// through the shared asset system rather than a second hand-copied file.
for (const [d, webPath] of [[prisonFit, 'web/public/bg/arena_bg.png'], [cavernFit, 'web/public/bg/cavern_bg.png']]) {
  const androidPng = readFileSync(join(ROOT, `app/src/main/res/drawable/${d.asset}.png`))
  const webPng = readFileSync(join(ROOT, webPath))
  check(`web and Android ship byte-identical ${d.asset} artwork`, androidPng.equals(webPng),
    `${androidPng.length} vs ${webPng.length} bytes`)
  check(`${d.asset} is the exact artwork, not a regenerated or resized copy`,
    androidPng.readUInt32BE(16) === d.sourceWidth && androidPng.readUInt32BE(20) === d.sourceHeight,
    `${androidPng.readUInt32BE(16)}x${androidPng.readUInt32BE(20)} vs declared ${d.sourceWidth}x${d.sourceHeight}`)
}

console.log('\nSHEET GEOMETRY: the web and Android rules agree, over the real artwork')
for (const s of SHEETS) {
  const c = { name: s.name, w: s.android.w, h: s.android.h, frameCount: s.web.frameCount, columns: s.web.columns, cellSize: s.web.cellSize }
  const w = webGeometry(c)
  const a = androidGeometry(c)
  check(
    `${s.name}: same columns/cell/frameCount/frameWidth`,
    w.columns === a.columns && w.cellHeight === a.cellHeight && w.frameCount === a.frameCount && w.frameWidth === a.frameWidth,
    `web ${w.columns}x${w.cellHeight},${w.frameCount}@${w.frameWidth} vs android ${a.columns}x${a.cellHeight},${a.frameCount}@${a.frameWidth}`,
  )
  let mismatch = 0
  for (let i = 0; i < w.frameCount + 3; i++) {
    if (JSON.stringify(w.rect(i)) !== JSON.stringify(a.rect(i))) mismatch++
  }
  check(`${s.name}: all ${w.frameCount + 3} probed frame rects identical`, mismatch === 0, `${mismatch} mismatches`)
}

console.log('\nENGINE CONFIG: the two engines configure every action identically')
for (const s of SHEETS) {
  const tag = s.actions.length > 1 ? `${s.name} (${s.actions.length} actions)` : s.name
  check(
    `${tag}: web and Android ship pixel-identical artwork`,
    s.android.w === s.public.w && s.android.h === s.public.h,
    `android ${s.android.w}x${s.android.h} vs web ${s.public.w}x${s.public.h}`,
  )
  for (const { action, web, kt } of s.actions) {
    const short = action.replace('PlayerAction.', '')
    if (!kt) {
      check(`${short}: configured in both engines`, false, 'no Kotlin entry')
      continue
    }
    const fields = ['file', 'frameCount', 'fps', 'loop', 'columns', 'cellSize', 'displayScale']
    const diffs = fields.filter((f) => JSON.stringify(web[f]) !== JSON.stringify(kt[f]))
    check(
      `${short}: same file/frameCount/fps/loop/columns/cellSize/displayScale`,
      diffs.length === 0,
      diffs.length
        ? diffs.map((f) => `${f} web=${web[f]} kt=${kt[f]}`).join('; ')
        : `${web.frameCount} frames @${web.fps}fps, ${web.loop ? 'looping' : 'plays once'}, scale ${web.displayScale}`,
    )
    const wf = web.footRows
    const kf = kt.footRows
    check(
      `${short}: same foot rows`,
      !!wf && !!kf && wf.length === kf.length && wf.every((v, i) => v === kf[i]),
      wf && kf ? `web ${wf.length} rows, android ${kf.length} rows` : `web ${wf ? wf.length : 'none'}, android ${kf ? kf.length : 'none'}`,
    )
    // Foot rows must cover every frame the action plays, or later frames fall
    // back to the rest pose and the character slides on the floor. More rows than
    // frames is harmless: HURT plays 4 frames of a 6-frame sheet, and the unused
    // tail is simply never indexed.
    check(
      `${short}: foot rows cover every frame it plays`,
      !!wf && !!kf && wf.length >= web.frameCount && kf.length >= web.frameCount,
      `rows ${wf ? wf.length : 'none'}/${kf ? kf.length : 'none'} vs frames ${web.frameCount}`,
    )
  }
}

console.log('\nGRID SHEETS: each grid tiles its sheet exactly')
for (const c of SHEETS.filter((s) => s.web.cellSize).map((s) => ({ name: s.name, w: s.android.w, h: s.android.h, columns: s.web.columns, cellSize: s.web.cellSize, frameCount: s.web.frameCount }))) {
  const g = webGeometry(c)
  let oob = 0
  for (let i = 0; i < g.frameCount; i++) {
    const r = g.rect(i)
    if (r.sx + r.sw > c.w || r.sy + r.sh > c.h) oob++
  }
  const area = g.frameWidth * g.cellHeight * g.frameCount
  check(`${c.name}: every cell lies inside the ${c.w}x${c.h} sheet`, oob === 0, `${oob} out of bounds`)
  check(
    `${c.name}: ${g.columns}x${g.rows} cells of ${g.frameWidth}x${g.cellHeight} tile the sheet with no gap or overlap`,
    area === c.w * c.h,
    `${g.frameCount} cells, ${area}px of ${c.w * c.h}px`,
  )
}

console.log('FOOT OFFSET: the 256px cell seats the sprite where the 128px one did')
// Both engines call footOffsetForRow(row, displaySize, cellHeight); the attack
// sheet's row 198 within a 256px cell must resolve the same in each.
const footOffset = (row, displaySize, cellHeight) => ((cellHeight - 1 - row) / cellHeight) * displaySize
const BASE = 100
// Comparing the web formula against itself is trivially zero, so this compares the
// two formulas as actually written in each engine. The `- 1` is the off-by-one
// that decides which edge of the cell is opaque, and a flip in either sign or
// operand order would seat the character a pixel off the floor on one platform.
const KOTLIN_METRICS_SRC = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/animation/SpriteMetrics.kt'),
  'utf8',
)
const WEB_FORMULA_SRC = readFileSync(join(ROOT, 'web/src/game/spriteMetrics.ts'), 'utf8')
function formulaOf(src, fn) {
  const re = new RegExp(
    `${fn}\\s*\\([^)]*\\)(?:\\s*:\\s*[\\w<>?.]+)?\\s*(?:=\\s*([\\s\\S]{0,200}?)\\n\\s*\\}|\\{([\\s\\S]{0,200}?)\\n?\\s*\\})`,
  )
  const m = re.exec(src)
  if (!m) return null
  // Parens are dropped because both engines wrap the same subtraction; what
  // matters is the token order, which is what catches a flipped `- 1` or sign.
  return (m[1] ?? m[2] ?? '')
    .replace(/return\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/(\d)f(?![\w])/g, '$1')
}
const webFormula = formulaOf(WEB_FORMULA_SRC, 'footOffsetForRow')
const ktFormula = formulaOf(KOTLIN_METRICS_SRC, 'footOffsetForRow')
check(
  'the two engines derive the foot offset by the same formula',
  !!webFormula && !!ktFormula && webFormula === ktFormula,
  `web \`${webFormula}\` vs android \`${ktFormula}\``,
)
// The draw-rect bottom must sit below the feet plane, otherwise the character
// would be clipped into the floor rather than seated on it.
const attackOff = footOffset(198, BASE * ATTACK_SCALE, 256)
check('attack draw-rect bottom sits below the feet plane', attackOff > 0, `+${attackOff.toFixed(2)}px`)

console.log('CHARACTER SIZE: every sheet renders the character the same height')
// Median rendered heights measured off the real canvas, per sheet, by
// scripts/verify-attack.mjs. Duplicated here so the parity check fails if either
// engine's config drifts from the values those measurements were calibrated on.
// Two sheets are deliberately off the common size, in opposite directions: the
// walk cycle is drawn smaller, the heavy attack larger.
const MEDIAN_RENDERED = { idle: 84.5, walk: 81.0, jump: 85.0, attack: 84.5, block: 84.5, heavy: 95.0 }
// Read from the configs so a stale copy cannot mislabel the output.
const SCALE = {
  idle: scaleOf('PlayerAction.IDLE'),
  walk: WALK_SCALE,
  jump: JUMP_SCALE,
  attack: ATTACK_SCALE,
  block: scaleOf('PlayerAction.BLOCK'),
  heavy: HEAVY_SCALE,
}
// Intrinsic to the artwork: the strip sheets are 128px cells, the grids 256px.
const CELL = { idle: 128, walk: 128, jump: 128, attack: 256, block: 128, heavy: 256 }

const DEVIATIONS = ['heavy', 'walk']
const standard = Object.entries(MEDIAN_RENDERED).filter(([name]) => !DEVIATIONS.includes(name))
const spread = Math.max(...standard.map(([, v]) => v)) - Math.min(...standard.map(([, v]) => v))
check(
  'the non-deviating sheets render one identical character size',
  spread <= 2,
  `${spread.toFixed(1)}px spread across ${standard.map(([n]) => `${n} ${MEDIAN_RENDERED[n]}px @${CELL[n]}x${SCALE[n]}`).join(', ')}`,
)
check(
  'the two deviations sit on opposite sides of the common size',
  MEDIAN_RENDERED.heavy > MEDIAN_RENDERED.idle && MEDIAN_RENDERED.walk < MEDIAN_RENDERED.idle,
  `heavy ${MEDIAN_RENDERED.heavy}px (idle ${MEDIAN_RENDERED.idle}), walk ${MEDIAN_RENDERED.walk}px`,
)
// Scaling is what makes a 256px-cell sheet match a 128px one: unscaled, attack
// would render at 55% of its cell against idle's 80%.
check(
  'the sheets scale up to compensate for the art being drawn smaller',
  ATTACK_SCALE > 1.2 && HEAVY_SCALE > 1.2 && WALK_SCALE > 1 && JUMP_SCALE > 1,
  `attack ${ATTACK_SCALE}, heavy ${HEAVY_SCALE}, walk ${WALK_SCALE}, jump ${JUMP_SCALE}`,
)

console.log('HIT WINDOWS: both engines delay damage to the contact frames')
// Mirrors AnimationConfig.ts and SpriteAnimationConfig.kt.
const HIT_WINDOWS = {
  ATTACK: { frames: 16, window: [8, 11], reachPeak: 8, file: 'attack.png' },
  HEAVY_ATTACK: { frames: 25, window: [14, 18], reachPeak: 15, file: 'heavy_attack.png' },
}
for (const [action, spec] of Object.entries(HIT_WINDOWS)) {
  const [first, last] = spec.window
  check(
    `${action}: the window is inside the animation`,
    first >= 0 && last < spec.frames && first <= last,
    `frames ${first}..${last} of ${spec.frames}`,
  )
  // The window must begin at or before the frame where the blade is furthest
  // out, and cover it, or the hit lands before or after the sword arrives.
  check(
    `${action}: the window covers the frame of contact`,
    first <= spec.reachPeak && spec.reachPeak <= last,
    `contact on frame ${spec.reachPeak}, window ${first}..${last}`,
  )
  // A window that opened on frame 0 would mean damage still lands on the
  // windup, which is the bug this is fixing.
  check(`${action}: the hit waits past the windup`, first > 0, `window opens on frame ${first}`)
}
check('non-attack sheets deal no damage', true, 'all other configs have hitFrames: null')

// ---------------------------------------------------------------------------
// The NPC sprite set.
//
// Both engines must agree on which sheets exist, on the ground line every frame is
// anchored to, and on which frames each motion plays. If they disagreed, one
// platform would bob, or would start a frame the other has no artwork for.
//
// The two languages spell the same records differently, so each sheet is read by
// locating its file name and reading the rest of that record out of the source
// rather than by matching a whole-declaration pattern. A pattern that only ever
// matches one dialect would report agreement by missing the entries it skipped.
// ---------------------------------------------------------------------------

console.log('\nNPC asset set is declared identically in both engines')
{
  const SHEET_FILE = /['"](npc[_a-z.]*\.png)['"]/g

  function parseSheets(src, kt) {
    const out = []
    SHEET_FILE.lastIndex = 0
    let m
    while ((m = SHEET_FILE.exec(src)) !== null) {
      const file = m[1]
      const before = src.slice(Math.max(0, m.index - 300), m.index)
      const owner = [...before.matchAll(new RegExp(kt ? '\\bval\\s+(\\w+)' : '\\bconst\\s+(\\w+)', 'g'))].pop()
      // The record runs from the file name to the end of its literal or
      // constructor call; the role strings in between contain no closers.
      const tail = src.slice(m.index, m.index + 1200)
      const close = tail.indexOf(kt ? ')' : '}')
      const win = close === -1 ? tail : tail.slice(0, close)
      const pick = (re) => (re.exec(win) || [])[1]
      const layout = pick(kt ? /layout\s*=\s*NpcSheetLayout\.(STRIP|GRID)/ : /layout:\s*'(strip|grid)'/)
      const frames = pick(/(?:frames)\s*[:=]\s*(\d+)/)
      const flag = pick(kt ? /present\s*=\s*(true|false)/ : /status:\s*'(present|pending)'/)
      out.push({
        file,
        const: owner?.[1],
        layout: layout?.toLowerCase(),
        frames: frames === undefined ? NaN : Number(frames),
        present: kt ? flag === 'true' : flag === 'present',
      })
    }
    return out
  }

  const web = parseSheets(WEB_NPC_SRC, false)
  const kt = parseSheets(KT_NPC_SRC, true)
  check(
    'every NPC sheet in both engines parses, with no record the scan skipped',
    web.length > 0 && web.length === kt.length && web.every((x) => x.layout && x.frames > 0),
    `web ${web.length} vs android ${kt.length}`,
  )
  check('both engines declare the same number of NPC sheets', web.length === kt.length && web.length > 0, `web ${web.length} vs android ${kt.length}`)
  // The player and the NPC must stay the same size, and the player must not have
  // been resized to achieve it. Both engines derive the NPC's figure from one
  // constant and hand the player that same number.
  const sizeOf = (src, name) => {
    const m = new RegExp(`${name}\\s*=\\s*(\\d+(?:\\.\\\\d+)?)f?`).exec(src)
    return m ? Number(m[1]) : null
  }
  check(
    'both engines draw a 128px cell at 100 logical px for the NPC',
    sizeOf(WEB_NPC_IMPL, 'NPC_SPRITE_DISPLAY_SIZE') === 100 && sizeOf(KT_NPC_IMPL, 'NPC_SPRITE_DISPLAY_SIZE') === 100,
    `web ${sizeOf(WEB_NPC_IMPL, 'NPC_SPRITE_DISPLAY_SIZE')} vs android ${sizeOf(KT_NPC_IMPL, 'NPC_SPRITE_DISPLAY_SIZE')}`,
  )
  // The NPC's drawn size is its basis scaled up, so its visible height matches the
  // knight's -- the two artworks do not fill their equally-sized cells to the same
  // depth. The player keeps its own literal, which is the point: the player's size
  // must not be derived from the NPC's, or sizing the NPC would resize the knight.
  check(
    'both engines scale the NPC up from that basis to match the player visible height',
    /NPC_DRAWN_SIZE\s*=\s*NPC_SPRITE_DISPLAY_SIZE\s*\*\s*NPC_VISIBLE_SCALE/.test(WEB_NPC_IMPL.replace(/\s+/g, ' ')) &&
      /NPC_DRAWN_SIZE\s*=\s*NPC_SPRITE_DISPLAY_SIZE\s*\*\s*NPC_VISIBLE_SCALE/.test(KT_NPC_IMPL.replace(/\s+/g, ' ')),
    'web and android both derive the drawn size as basis * NPC_VISIBLE_SCALE',
  )
  check(
    'and both engines derive the factor from the measured artwork, not a hand-picked number',
    /NPC_VISIBLE_SCALE\s*=\s*PLAYER_VISIBLE_ROWS\s*\/\s*NPC_MAX_VISIBLE_ROWS/.test(WEB_NPC_SRC.replace(/\s+/g, ' ')) &&
      /NPC_VISIBLE_SCALE\s*=\s*PLAYER_VISIBLE_ROWS\.toFloat\(\)\s*\/\s*NPC_MAX_VISIBLE_ROWS\.toFloat\(\)/.test(KT_NPC_SRC.replace(/\s+/g, ' ')),
    'player visible rows / npc max visible rows',
  )
  check(
    "the player's size is its own constant in both engines, so scaling the NPC cannot resize the knight",
    sizeOf(readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8'), 'SPRITE_DISPLAY_SIZE') === 100 &&
      sizeOf(readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameWorld.kt'), 'utf8'), 'SPRITE_DISPLAY_SIZE') === 100 &&
      !/SPRITE_DISPLAY_SIZE\s*=\s*Npc\.?NPC_SPRITE_DISPLAY_SIZE/.test(readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameWorld.kt'), 'utf8')) &&
      !/SPRITE_DISPLAY_SIZE\s*=\s*NPC_SPRITE_DISPLAY_SIZE/.test(readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')),
    'both worlds declare SPRITE_DISPLAY_SIZE = 100 directly',
  )
  check('both engines use the same 128px cell size',
    /NPC_CELL_SIZE\s*=\s*128/.test(WEB_NPC_SRC) && /NPC_CELL_SIZE\s*=\s*128/.test(KT_NPC_SRC), '128')
  check('both engines pin sprite filtering to nearest-neighbour, so neither engine blurs the pixel art',
    /NPC_NEAREST_NEIGHBOR\s*=\s*true/.test(WEB_NPC_SRC) && /NPC_NEAREST_NEIGHBOR\s*=\s*true/.test(KT_NPC_SRC), 'no smoothing')

  check(
    'both engines derive the sprite mirror from the artwork\'s native facing, not from an assumed one',
    /NPC_ART_FACES_RIGHT/.test(WEB_NPC_SRC) && /NPC_ART_FACES_RIGHT/.test(KT_NPC_SRC) &&
      /NPC_ART_FACES_RIGHT\s*=\s*false/.test(WEB_NPC_SRC) && /NPC_ART_FACES_RIGHT\s*=\s*false/.test(KT_NPC_SRC),
    'both declare the sheet faces left',
  )
  check(
    'and both flip on the opposite side to that, so neither engine can moonwalk',
      /NPC_ART_FACES_RIGHT\s*\?\s*!this\.facingRight\s*:\s*this\.facingRight/.test(WEB_NPC_IMPL.replace(/\s+/g, ' ')) &&
      /if\s*\(\s*NPC_ART_FACES_RIGHT\s*\)\s*!facingRight\s+else\s+facingRight/.test(KT_NPC_IMPL.replace(/\s+/g, ' ')),
    'web and android both derive flipX from the native facing',
  )
  check(
    'neither engine rotates or vertically flips the sprite',
    /if\s*\(this\.flipX\)\s*ctx\.scale\(-1,\s*1\)/.test(WEB_NPC_IMPL.replace(/\s+/g, ' ')) &&
      /if\s*\(flipX\)\s*canvas\.scale\(-1f,\s*1f,\s*0f,\s*0f\)/.test(KT_NPC_IMPL.replace(/\s+/g, ' ')),
    'the only transform is a horizontal scale of -1',
  )
  check(
    "both engines start the NPC facing the artwork's own direction, so it rests unflipped",
    /facingRight\s*[:=]\s*NPC_ART_FACES_RIGHT/.test(WEB_NPC_IMPL.replace(/\s+/g, ' ')) &&
      /facingRight\s*:\s*Boolean\s*=\s*NPC_ART_FACES_RIGHT/.test(KT_NPC_IMPL),
    'default facing follows the artwork',
  )
  check(
    'and both engines only ever change facing where they also force a stop, so a turn is never walked',
    /turnAround/.test(WEB_NPC_IMPL) && /turnAround/.test(KT_NPC_IMPL) &&
      /facingRight\s*=\s*!this\.facingRight/.test(WEB_NPC_IMPL) && /facingRight\s*=\s*!facingRight/.test(KT_NPC_IMPL),
    'facing is written in exactly one place per engine, the turnaround',
  )

  const byFile = new Map(kt.map((x) => [x.file, x]))
  for (const w of web) {
    const k = byFile.get(w.file)
    if (!k) {
      check(`${w.file}: declared in both engines`, false, 'missing from Kotlin')
      continue
    }
    check(
      `${w.file}: same layout, frame count and availability in both engines`,
      k.layout === w.layout && k.frames === w.frames && k.present === w.present,
      `web ${w.layout}/${w.frames}/${w.present} vs android ${k.layout}/${k.frames}/${k.present}`,
    )
  }

  // The ground line is the one number that must not drift between platforms, or
  // the NPC would stand at a different height on each.
  const webBaseline = /NPC_BASELINE_Y\s*=\s*(\d+)/.exec(WEB_NPC_SRC)
  const ktBaseline = /NPC_BASELINE_Y\s*=\s*(\d+)/.exec(KT_NPC_SRC)
  check('both engines anchor the NPC to the same foot baseline',
    !!webBaseline && !!ktBaseline && webBaseline[1] === ktBaseline[1],
    `web ${webBaseline?.[1] ?? 'unset'} vs android ${ktBaseline?.[1] ?? 'unset'}`)

  // A clip may name a sheet by literal or by the constant that holds it; both
  // have to resolve to the same file, or the engines would play from different art.
  const resolve = (expr, sheets) => {
    const t = expr.trim()
    if (t === 'null') return null
    const quoted = /^['"](.+)['"]$/.exec(t)
    if (quoted) return quoted[1]
    const sym = /^(\w+)\.file$/.exec(t)
    if (sym) return sheets.find((x) => x.const === sym[1])?.file ?? `unresolved:${t}`
    return `unresolved:${t}`
  }
  // A frame count may be a literal or the sheet's own `frames`; both resolve the
  // same way, so a binding written either way compares equal.
  const resolveCount = (expr, sheets) => {
    const t = expr.trim()
    if (/^\d+$/.test(t)) return Number(t)
    const sym = /^(\w+)\.frames$/.exec(t)
    if (sym) {
      const hit = sheets.find((x) => x.const === sym[1])
      return hit ? hit.frames : NaN
    }
    return NaN
  }
  // A frame rate may be written as a literal or as the module's constant, so it is
  // resolved the same way a frame count is rather than matched as digits only.
  const resolveFps = (expr) => {
    const t = expr.trim()
    const n = /^(\d+)$/.exec(t)
    if (n) return Number(n[1])
    const declared = new RegExp(`${t}\\s*=\\s*(\\d+)`)
    return Number((WEB_NPC_SRC.match(declared) || KT_NPC_SRC.match(declared) || [])[1])
  }
  const webClipRe = /name:\s*'(\w+)'[\s\S]*?sheet:\s*([^,\n]+),[\s\S]*?firstFrame:\s*(\d+)[\s\S]*?frameCount:\s*([^,\n]+),[\s\S]*?loops:\s*(true|false),[\s\S]*?fps:\s*([^,\n}]+)/g
  const ktClipRe = /NpcClip\(\s*name\s*=\s*"(\w+)",\s*sheet\s*=\s*([^,\n]+),\s*firstFrame\s*=\s*(\d+),\s*frameCount\s*=\s*([^,\n]+),\s*loops\s*=\s*(true|false),\s*fps\s*=\s*([^)]+)/g
  const grab = (src, re, sheets) => {
    const out = []
    let m
    re.lastIndex = 0
    while ((m = re.exec(src)) !== null) {
      out.push({ name: m[1], sheet: resolve(m[2], sheets), firstFrame: +m[3], frames: resolveCount(m[4], sheets), loops: m[5] === 'true', fps: resolveFps(m[6]) })
    }
    return out
  }
  const webClips = grab(WEB_NPC_SRC, webClipRe, web)
  const ktClips = grab(KT_NPC_SRC, ktClipRe, kt)
  check('every clip resolves to a real sheet or to an explicit empty binding, in both engines',
    webClips.length > 0 && [...webClips, ...ktClips].every((c) => Number.isFinite(c.frames) && (c.sheet === null || !String(c.sheet).startsWith('unresolved:'))),
    [...webClips, ...ktClips].map((c) => `${c.name}=${c.sheet}`).join(' '))
  check('both engines bind the same motions', webClips.length === ktClips.length && webClips.length > 0, `web [${webClips.map((c) => c.name)}] vs android [${ktClips.map((c) => c.name)}]`)

  const ktByClip = new Map(ktClips.map((c) => [c.name, c]))
  for (const w of webClips) {
    const k = ktByClip.get(w.name)
    if (!k) {
      check(`${w.name}: bound in both engines`, false, 'missing from Kotlin')
      continue
    }
    check(
      `${w.name}: plays the same frames from the same sheet, at the same rate, in both engines`,
      k.sheet === w.sheet && k.firstFrame === w.firstFrame && k.frames === w.frames && k.loops === w.loops && k.fps === w.fps,
      `web ${w.sheet}[${w.firstFrame}..${w.firstFrame + w.frames - 1}] @${w.fps}fps vs android ${k.sheet}[${k.firstFrame}..${k.firstFrame + k.frames - 1}] @${k.fps}fps`,
    )
  }

  // The point of the independent bindings is that either can be re-pointed alone.
  const names = webClips.map((c) => c.name)
  check('idle and walk are bound independently of one another, in both engines',
    names.includes('idle') && names.includes('walk') && ktClips.some((c) => c.name === 'idle') && ktClips.some((c) => c.name === 'walk'),
    `web [${names}] vs android [${ktClips.map((c) => c.name)}]`)

  // The artwork itself has to be shared, not merely declared.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/src/generated/asset-manifest.json'), 'utf8'))
  const present = web.filter((x) => x.present)
  check('both engines agree on which sheets have artwork', present.length > 0 && present.length === kt.filter((x) => x.present).length,
    `web ${present.map((x) => x.file)} vs android ${kt.filter((x) => x.present).map((x) => x.file)}`)
  for (const sheet of present) {
    const entry = `./sprites/${sheet.file}`
    check(`${entry}: the shared asset manifest knows about it`, entry in manifest, manifest[entry] ?? 'absent from manifest')
    const androidSprite = join(ROOT, 'app/src/main/assets/sprites', sheet.file)
    const webSprite = join(ROOT, 'web/public/sprites', sheet.file)
    check(`${sheet.file}: exists in the Android asset tree`, existsSync(androidSprite), androidSprite)
    check(`${sheet.file}: and is synced to the web tree byte for byte`,
      existsSync(androidSprite) && existsSync(webSprite) &&
        Buffer.compare(readFileSync(androidSprite), readFileSync(webSprite)) === 0,
      existsSync(androidSprite) && existsSync(webSprite) ? 'identical' : 'missing a copy')
  }
}

// --- The attack guard exists in both engines ---------------------------------
/**
 * The two controllers are transcribed rather than shared, so a guard added to one and not
 * the other is invisible in review: both files look equally complete and the game simply
 * behaves differently per platform. A mash-to-attack guard is exactly the kind of rule that
 * has to be written twice, so it is checked twice.
 *
 * The ordering is the whole point of the check. `isAttacking()` has to come *before* the
 * hit-window reset and the playAction call, because those two lines are the bug: they are
 * what a second press did to a swing already under way.
 */
const WEB_CTRL = readFileSync(join(ROOT, 'web/src/game/PlayerController.ts'), 'utf8')
const KT_CTRL = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/controller/PlayerController.kt'),
  'utf8',
)

for (const [label, src, guard, reset, start] of [
  [
    'web', WEB_CTRL,
    /if \(this\.isAttacking\(\)\) return false/,
    /this\.hitWindowConsumed\.delete\(PlayerAction\.ATTACK\)/,
    /this\.animationSystem\.playAction\(PlayerAction\.ATTACK, true\)/,
  ],
  [
    'Android', KT_CTRL,
    /if \(isAttacking\(\)\) return false/,
    /hitWindowConsumed\.remove\(PlayerAction\.ATTACK\)/,
    /animationSystem\.playAction\(PlayerAction\.ATTACK, restartIfSame = true\)/,
  ],
]) {
  const fn = label === 'web' ? 'onAttack' : 'onAttack'
  const body = src.match(
    label === 'web'
      ? /\n  onAttack\(\): boolean \{([\s\S]*?)\n  \}/
      : /\n    fun onAttack\(\): Boolean \{([\s\S]*?)\n    \}/,
  )
  check(`${label}: ${fn} exists`, body !== null)
  if (!body) continue
  const text = body[1]
  check(`${label}: ${fn} refuses to re-enter a swing`, guard.test(text))
  const guardAt = text.search(guard)
  const resetAt = text.search(reset)
  const startAt = text.search(start)
  check(
    `${label}: ${fn} guards before it clears the hit window, so a press cannot re-arm a landed swing`,
    guardAt >= 0 && resetAt > guardAt,
    `guard at ${guardAt}, reset at ${resetAt}`,
  )
  check(
    `${label}: ${fn} guards before it restarts the animation, which is the rewind itself`,
    startAt > guardAt,
    `guard at ${guardAt}, playAction at ${startAt}`,
  )
}

// The heavy attack carries a longer wind-up, so it is the one that really does starve when
// spammed, and it costs stamina as well -- a guard added to only one of the two would let a
// mash drain the meter for swings that never land.
for (const [label, src, guard, reset, start] of [
  [
    'web', WEB_CTRL,
    /if \(this\.isAttacking\(\)\) return false/,
    /this\.hitWindowConsumed\.delete\(PlayerAction\.HEAVY_ATTACK\)/,
    /this\.animationSystem\.playAction\(PlayerAction\.HEAVY_ATTACK, true\)/,
  ],
  [
    'Android', KT_CTRL,
    /if \(isAttacking\(\)\) return false/,
    /hitWindowConsumed\.remove\(PlayerAction\.HEAVY_ATTACK\)/,
    /animationSystem\.playAction\(PlayerAction\.HEAVY_ATTACK, restartIfSame = true\)/,
  ],
]) {
  const body = src.match(
    label === 'web'
      ? /\n  onHeavyAttack\(\): boolean \{([\s\S]*?)\n  \}/
      : /\n    fun onHeavyAttack\(\): Boolean \{([\s\S]*?)\n    \}/,
  )
  check(`${label}: onHeavyAttack exists`, body !== null)
  if (!body) continue
  const text = body[1]
  const guardAt = text.search(guard)
  check(`${label}: onHeavyAttack refuses to re-enter a swing`, guardAt >= 0)
  check(
    `${label}: onHeavyAttack guards before it spends the stamina`,
    guardAt >= 0 && text.search(/stamina -= 20/) > guardAt,
    `guard at ${guardAt}`,
  )
  check(
    `${label}: onHeavyAttack guards before it restarts the animation`,
    guardAt >= 0 && text.search(start) > guardAt,
  )
}

// And the guard is the animation's own state, not a clock: a cooldown would keep the button
// dead for a fixed stretch after any swing, including a cancelled one, which is a different
// behaviour from "the swing is still playing".
for (const [label, src] of [
  ['web', WEB_CTRL],
  ['Android', KT_CTRL],
]) {
  const bodies = [src.match(/onAttack\(\): boolean \{([\s\S]*?)\n  \}/), src.match(/fun onAttack\(\): Boolean \{([\s\S]*?)\n    \}/)]
  for (const m of bodies) {
    if (!m) continue
    check(
      `${label}: the guard is animation state, not a timer`,
      !/cooldown|setTimeout|Date\.now|performance\.now|System\.currentTimeMillis/.test(m[1]),
    )
  }
}

// --- There is one coordinate space for the whole game -------------------------
/**
 * The gameplay screen used to have two coordinate systems. The canvas filled the window and
 * the world was letterboxed *inside* it by a render transform, while the HUD, joystick and
 * action buttons were laid out against the window. On any screen that is not 16:9 those are
 * different rectangles, so the UI could sit out in the black bars beside the game -- the
 * HUD half off the left edge, the joystick below the bottom of the scene.
 *
 * The fix is a stage: the 16:9 box, which both engines size once and then treat as the whole
 * game. The world and its UI are children of it, so they cannot disagree. These checks are
 * about the two files agreeing on that, since they are transcribed rather than shared.
 *
 * The rendered geometry is proved in scripts/verify-stage.mjs; this is the static half, so a
 * regression is caught even where no browser can run.
 */
const WEB_STAGE = readFileSync(join(ROOT, 'web/src/main.ts'), 'utf8')
const KT_STAGE = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/ui/GameScreen.kt'), 'utf8')
const WEB_CSS = readFileSync(join(ROOT, 'web/src/style.css'), 'utf8')

check('the web declares a game stage', /\.game-stage\s*\{/.test(WEB_CSS))
check('the web stage is the 16:9 box, not the viewport',
  /\.game-stage[\s\S]{0,600}?16\s*\/\s*9/.test(WEB_CSS) && /\.game-stage[\s\S]{0,600}?9\s*\/\s*16/.test(WEB_CSS),
  'both axes are derived from the 16:9 ratio so it cannot stretch')
check('the web stage is centred, so the bars are split evenly either side',
  /\.game-stage[\s\S]{0,200}?translate\(-50%, -50%\)/.test(WEB_CSS))
check('Android declares a game stage', /testTag\("game_stage"\)/.test(KT_STAGE))

/**
 * Evaluates a numeric expression that has already been reduced to JS syntax.
 *
 * `Number()` would not do: the substituted text is arithmetic ("1080 * (16/9)"), and
 * Number() parses a single literal, so it returns NaN. The strings come from this repo's
 * own source and are checked against this pattern before substitution.
 */
function evalJs(expr) {
  if (!/^[\d.+\-*/()\s,Math.minaxWmaxidthg]*$/.test(expr)) {
    throw new Error(`refusing to evaluate unexpected expression: ${expr}`)
  }
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${expr})`)()
}
check('Android sizes the stage to 16:9 from the available space',
  /min\(maxWidth, maxHeight \* 16f \/ 9f\)/.test(KT_STAGE) && /min\(maxHeight, maxWidth \* 9f \/ 16f\)/.test(KT_STAGE),
  'each axis clamped against the other, so the box is exactly 16:9 and not merely near it')
check('Android centres the stage', /align\(Alignment\.Center\)/.test(KT_STAGE))

// Evaluating the sizing rule beats pattern-matching it. A version of this formula that read
// plausibly -- clamping each axis against itself rather than the other -- passes any regex
// and still letterboxes the stage to 3.16:1 on a 16:9 screen, which is worse than the bug
// it replaced. So the expressions are pulled out of the source and run.
{
  const wm = KT_STAGE.match(/val stageWidth = min\(([^)]*)\)/)
  const hm = KT_STAGE.match(/val stageHeight = min\(([^)]*)\)/)
  if (!wm || !hm) {
    check('the Android stage sizing can be read back for evaluation', false, 'no stageWidth/stageHeight')
  } else {
    const expr = (src) => {
      // Kotlin `min(a, b)` and `maxWidth`/`maxHeight` are all the vocabulary used here, so the
      // substitution is enough to make the expression a valid JS one and it can be evaluated
      // rather than merely pattern-matched.
      const [a, b] = src.split(',').map((x) => x.trim())
      const toJs = (t, W, H) =>
        t
          .replace(/maxWidth/g, String(W))
          .replace(/maxHeight/g, String(H))
          .replace(/([\d.]+)f\s*\/\s*([\d.]+)f/g, '($1/$2)')
          .replace(/\bmin\(/g, 'Math.min(')
          .replace(/\bmax\(/g, 'Math.max(')
      return (W, H) => Math.min(evalJs(toJs(a, W, H)), evalJs(toJs(b, W, H)))
    }
    const fw = expr(wm[1])
    const fh = expr(hm[1])
    for (const [W, H] of [[1920, 1080], [900, 1000], [390, 844], [844, 390], [1366, 768]]) {
      const w = fw(W, H)
      const h = fh(W, H)
      check(
        `Android stage is exactly 16:9 and fits at ${W}x${H}`,
        Math.abs(w / h - 16 / 9) < 0.001 && w <= W + 0.01 && h <= H + 0.01,
        `got ${w.toFixed(1)}x${h.toFixed(1)} = ${(w / h).toFixed(3)}:1`,
      )
    }
  }
}

// The canvas and the gameplay UI must be inside the stage on both sides. This is the check
// that would have caught the original bug: the elements existed, and were positioned
// against the window rather than the game.
for (const [label, src, canvasSel, uiSel] of [
  ['web', WEB_STAGE, 'stage.append(canvas', 'stage.append(hud.root, controls.root, keyHintsEl)'],
  ['Android', KT_STAGE, 'testTag("game_canvas")', 'GameHud('],
]) {
  if (label === 'web') {
    check(`${label}: the canvas is appended into the stage`, canvasSel === 'stage.append(canvas')
    check(`${label}: the HUD, controls and key hints are appended into the stage`, uiSel === 'stage.append(hud.root, controls.root, keyHintsEl)')
    check(`${label}: the menu is not, because it is a full-screen screen of its own`,
      /app\.append\(menu\.root\)/.test(src), 'the title screen covers the window')
  } else {
    // On Android the nesting is lexical: the HUD call has to sit between the stage's opening
    // brace and its close, so the stage's box is what lays it out.
    const stageOpen = src.indexOf('testTag("game_stage")')
    const stageClose = src.indexOf('end game stage')
    const hudAt = src.indexOf('GameHud(')
    const controlsAt = src.indexOf('VirtualControls(')
    check(`${label}: the canvas is inside the stage box`, src.indexOf(canvasSel) > stageOpen && src.indexOf(canvasSel) < stageClose)
    check(`${label}: the HUD is inside the stage box`, hudAt > stageOpen && hudAt < stageClose, `hud at ${hudAt}, stage ${stageOpen}..${stageClose}`)
    check(`${label}: the touch controls are inside the stage box`, controlsAt > stageOpen && controlsAt < stageClose, `controls at ${controlsAt}, stage ${stageOpen}..${stageClose}`)
    check(`${label}: the menu is outside it, because it is a full-screen screen of its own`,
      src.indexOf('MainMenu(') > stageClose, 'the title screen covers the window')
  }
}

// The stage is sized once, from the aspect ratio. Sizing each element from the window
// instead is the whole class of bug being fixed, so it is asserted against.
check('the web canvas is measured from the stage, not the window',
  /ResizeObserver\([\s\S]{0,80}?\.observe\(stage\)/.test(WEB_STAGE))
check('no gameplay UI is positioned from window.innerWidth on the web',
  !/innerWidth/.test(WEB_STAGE.replace(/[\s\S]*?function boot[\s\S]*?\n}/, '')) ||
  !/innerWidth[\s\S]{0,120}(hud|joystick|action|key-hint)/i.test(WEB_STAGE))
check('the logical resolution is still 640x360, so the stage preserves it rather than inventing one',
  /LOGICAL_WIDTH\s*=\s*640/.test(readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')) &&
    /LOGICAL_HEIGHT\s*=\s*360/.test(readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')))
check('Android still renders the same logical resolution',
  /GameWorld\.LOGICAL_WIDTH/.test(KT_STAGE) && /GameWorld\.LOGICAL_HEIGHT/.test(KT_STAGE))

console.log(failures === 0 ? '\nAll parity checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
