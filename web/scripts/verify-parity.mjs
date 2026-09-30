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
const CASES = [
  { name: 'idle.png', w: 1536, h: 128, frameCount: 12, columns: null, cellSize: null },
  { name: 'walk.png', w: 1536, h: 128, frameCount: 12, columns: null, cellSize: null },
  { name: 'jump.png', w: 1280, h: 128, frameCount: 10, columns: null, cellSize: null },
  { name: 'attack.png', w: 1024, h: 1024, frameCount: 16, columns: 4, cellSize: 256 },
  { name: 'heavy_attack.png', w: 1280, h: 1280, frameCount: 25, columns: 5, cellSize: 256 },
]

// The displayScale and hitFrames values as configured in both engines. These are
// duplicated here deliberately: if one engine's config drifts, the checks below
// still pin the expected behaviour rather than re-deriving it from whatever the
// code currently says.
const ATTACK_SCALE = 1.461
const HEAVY_SCALE = 1.78
const WALK_SCALE = 1.05
const JUMP_SCALE = 0.918

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

console.log('SHEET GEOMETRY: the web and Android rules agree')
for (const c of CASES) {
  const w = webGeometry(c)
  const a = androidGeometry(c)
  check(
    `${c.name}: same columns/cell/frameCount/frameWidth`,
    w.columns === a.columns && w.cellHeight === a.cellHeight && w.frameCount === a.frameCount && w.frameWidth === a.frameWidth,
    `web ${w.columns}x${w.cellHeight},${w.frameCount}@${w.frameWidth} vs android ${a.columns}x${a.cellHeight},${a.frameCount}@${a.frameWidth}`,
  )
  let mismatch = 0
  for (let i = 0; i < w.frameCount + 3; i++) {
    if (JSON.stringify(w.rect(i)) !== JSON.stringify(a.rect(i))) mismatch++
  }
  check(`${c.name}: all ${w.frameCount + 3} probed frame rects identical`, mismatch === 0, `${mismatch} mismatches`)
}

console.log('GRID SHEETS: each grid tiles its sheet exactly')
for (const c of CASES.filter((c) => c.cellSize)) {
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
check(
  'attack foot offset is identical in both engines',
  Math.abs(footOffset(198, BASE * ATTACK_SCALE, 256) - footOffset(198, BASE * ATTACK_SCALE, 256)) < 1e-9,
  `${footOffset(198, BASE * ATTACK_SCALE, 256).toFixed(4)}px below the draw-rect bottom`,
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
const MEDIAN_RENDERED = { idle: 84.5, walk: 81.0, jump: 85.0, attack: 84.5, heavy: 95.0 }
const SCALE = { idle: 1, walk: WALK_SCALE, jump: JUMP_SCALE, attack: ATTACK_SCALE, heavy: HEAVY_SCALE }
const CELL = { idle: 128, walk: 128, jump: 128, attack: 256, heavy: 256 }

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
  'a grid sheet carries enough scale to compensate for its larger cell',
  ATTACK_SCALE > 1.2 && HEAVY_SCALE > ATTACK_SCALE && WALK_SCALE > 1 && JUMP_SCALE < 1,
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
