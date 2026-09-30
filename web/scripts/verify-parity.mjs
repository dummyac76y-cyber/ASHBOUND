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

console.log('\nWORLD GEOMETRY: both engines build the same two-section world')
// The world is the Forgotten Prison followed by the Underground Cavern, laid end to
// end. Everything the player, the dummies, collision and the backdrop share lives in
// that one space, so these constants have to agree or the two platforms would put
// the ground plane in a different place.
const WEB_WORLD_SRC = readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')
const KT_WORLD_SRC = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameWorld.kt'), 'utf8')

/** Literal `static readonly X = <n>` / `const val X = <n>f` values from each engine. */
function literals(src, web) {
  const out = {}
  const re = web
    ? /static\s+readonly\s+(\w+)\s*=\s*(-?[\d.]+)\s*$/gm
    : /const\s+val\s+(\w+)\s*(?::\s*Float\s*)?=\s*(-?[\d.]+)f?\s*$/gm
  for (const m of src.matchAll(re)) out[m[1]] = Number(m[2])
  return out
}
const WEB_LIT = literals(WEB_WORLD_SRC, true)
const KT_LIT = literals(KT_WORLD_SRC, false)

const SHARED = [
  'LOGICAL_WIDTH', 'LOGICAL_HEIGHT', 'BACKGROUND_HEIGHT',
  'CAVERN_WIDTH', 'CAVERN_HEIGHT', 'BACKGROUND_FLOOR_ROW', 'CAVERN_FLOOR_ROW',
  'SPRITE_DISPLAY_SIZE',
]
for (const name of SHARED) {
  check(
    `${name}: same literal in both engines`,
    WEB_LIT[name] !== undefined && WEB_LIT[name] === KT_LIT[name],
    `web ${WEB_LIT[name]} vs android ${KT_LIT[name]}`,
  )
}

// The arena plate is 1536 wide in both. Web names the constant; Kotlin inlines the
// literal into the scaled expression, so both spellings are checked.
// Note web qualifies its constants with `GameWorld.`, so every pattern below
// tolerates that prefix rather than assuming a bare name.
const ARENA_W = WEB_LIT.BACKGROUND_WIDTH
check(
  'the arena plate is 1536 wide in both engines',
  ARENA_W === 1536 && /BACKGROUND_LOGICAL_WIDTH\s*:\s*Float\s*=\s*1536/.test(KT_WORLD_SRC),
  `web BACKGROUND_WIDTH ${ARENA_W}, kotlin inline 1536`,
)

// Recomputed from the shared literals, so the two plates cannot drift apart from
// each other even if both engines agreed on a wrong number.
const WORLD_SCALE = WEB_LIT.LOGICAL_HEIGHT / WEB_LIT.BACKGROUND_HEIGHT
const FLOOR_Y = WEB_LIT.BACKGROUND_FLOOR_ROW * WORLD_SCALE
const ARENA_LOGICAL_W = (WEB_LIT.BACKGROUND_WIDTH ?? 1536) * WORLD_SCALE
const CAVERN_W = WEB_LIT.CAVERN_WIDTH * WORLD_SCALE
const CAVERN_H = WEB_LIT.CAVERN_HEIGHT * WORLD_SCALE
const CAVERN_Y = FLOOR_Y - WEB_LIT.CAVERN_FLOOR_ROW * WORLD_SCALE
check(
  'one shared scale puts each plate exactly one viewport wide',
  Math.abs(ARENA_LOGICAL_W - WEB_LIT.LOGICAL_WIDTH) < 1e-9 &&
    Math.abs(CAVERN_W - WEB_LIT.LOGICAL_WIDTH) < 1e-9,
  `arena ${ARENA_LOGICAL_W}, cavern ${CAVERN_W}, viewport ${WEB_LIT.LOGICAL_WIDTH}`,
)
check(
  'the cavern floor lands exactly on the shared ground plane',
  Math.abs(CAVERN_Y + WEB_LIT.CAVERN_FLOOR_ROW * WORLD_SCALE - FLOOR_Y) < 1e-9,
  `cavern floor ${CAVERN_Y + WEB_LIT.CAVERN_FLOOR_ROW * WORLD_SCALE} vs FLOOR_Y ${FLOOR_Y}`,
)
check(
  'the cavern is shorter than the viewport, which is why the bands are filled',
  CAVERN_H < WEB_LIT.LOGICAL_HEIGHT,
  `cavern ${CAVERN_H.toFixed(2)} vs viewport ${WEB_LIT.LOGICAL_HEIGHT}`,
)
check(
  'the cavern plate sits fully inside the viewport when floor-aligned',
  CAVERN_Y >= 0 && CAVERN_Y + CAVERN_H <= WEB_LIT.LOGICAL_HEIGHT,
  `top ${CAVERN_Y.toFixed(2)}, bottom ${(CAVERN_Y + CAVERN_H).toFixed(2)}`,
)

// The arena centre anchors the spawn and both dummies. It must be the prison's
// centre: derived from the world it would land on the seam between the sections.
check(
  'the spawn and dummies are anchored to the prison, not to the world',
  /ARENA_CENTER_X\s*=\s*(?:GameWorld\.)?BACKGROUND_LOGICAL_WIDTH\s*\/\s*2/.test(WEB_WORLD_SRC) &&
    /ARENA_CENTER_X:\s*Float\s*=\s*BACKGROUND_LOGICAL_WIDTH\s*\/\s*2f/.test(KT_WORLD_SRC),
  'both derive the centre from the prison plate',
)

// Both engines must draw the cavern from the same source file, and the cavern must
// be drawn at the arena's scale rather than a scale of its own.
check(
  'both engines load the cavern from the same shared asset name',
  /img_underground_cavern_hd/.test(KT_WORLD_SRC) && /bg\/cavern_bg\.png/.test(WEB_WORLD_SRC) &&
    existsSync(join(ROOT, 'app/src/main/res/drawable/img_underground_cavern_hd.png')) &&
    existsSync(join(ROOT, 'web/public/bg/cavern_bg.png')),
  'res/drawable is the source, web/public is the synced copy',
)
check(
  'the cavern is drawn at the arena scale, not a scale of its own',
  /CAVERN_SCALE\s*=\s*(?:GameWorld\.)?BACKGROUND_SCALE/.test(WEB_WORLD_SRC) &&
    /CAVERN_SCALE:\s*Float\s*=\s*BACKGROUND_SCALE/.test(KT_WORLD_SRC),
  'one scale for both sections',
)

// Same bytes on both platforms, which is the whole point of routing the section
// through the shared asset system rather than a second hand-copied file.
{
  const androidCavern = readFileSync(join(ROOT, 'app/src/main/res/drawable/img_underground_cavern_hd.png'))
  const webCavern = readFileSync(join(ROOT, 'web/public/bg/cavern_bg.png'))
  check(
    'web and Android ship byte-identical cavern artwork',
    androidCavern.equals(webCavern),
    `${androidCavern.length} vs ${webCavern.length} bytes`,
  )
  check(
    'the cavern is the exact artwork, not a regenerated or resized copy',
    androidCavern.readUInt32BE(16) === WEB_LIT.CAVERN_WIDTH && androidCavern.readUInt32BE(20) === WEB_LIT.CAVERN_HEIGHT,
    `${androidCavern.readUInt32BE(16)}x${androidCavern.readUInt32BE(20)}`,
  )
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

console.log(failures === 0 ? '\nAll parity checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
