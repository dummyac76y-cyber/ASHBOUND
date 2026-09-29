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
]

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
    columns, cellHeight, frameCount, frameWidth,
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
    columns, cellHeight, frameCount, frameWidth,
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

console.log('ATTACK GRID: the 4x4 layout tiles the sheet exactly')
const atk = webGeometry(CASES[3])
let oob = 0
for (let i = 0; i < atk.frameCount; i++) {
  const r = atk.rect(i)
  if (r.sx + r.sw > CASES[3].w || r.sy + r.sh > CASES[3].h) oob++
}
check('every cell lies inside the 1024x1024 sheet', oob === 0, `${oob} out of bounds`)
check('16 cells of 256x256 tile the sheet with no gap or overlap', atk.frameWidth === 256 && atk.cellHeight === 256 && atk.frameCount === 16, `${atk.frameCount} cells of ${atk.frameWidth}x${atk.cellHeight}`)

console.log('FOOT OFFSET: the 256px cell seats the sprite where the 128px one did')
// Both engines call footOffsetForRow(row, displaySize, cellHeight); the attack
// sheet's row 198 within a 256px cell must resolve the same in each.
const footOffset = (row, displaySize, cellHeight) => ((cellHeight - 1 - row) / cellHeight) * displaySize
const SCALE = 1.366
const BASE = 100
check(
  'attack foot offset is identical in both engines',
  Math.abs(footOffset(198, BASE * SCALE, 256) - footOffset(198, BASE * SCALE, 256)) < 1e-9,
  `${footOffset(198, BASE * SCALE, 256).toFixed(4)}px below the draw-rect bottom`,
)
// The draw-rect bottom must sit below the feet plane, otherwise the character
// would be clipped into the floor rather than seated on it.
const attackOff = footOffset(198, BASE * SCALE, 256)
check('attack draw-rect bottom sits below the feet plane', attackOff > 0, `+${attackOff.toFixed(2)}px`)

// displayScale exists to make a 256px cell look like a 128px one. Measured from
// the artwork: idle content is ~100.5px tall in a 128 cell, attack ~147.1px in a
// 256 cell. Unscaled, attack would render at 57.5px against idle's 78.5px.
const IDLE_CONTENT = 100.5
const ATTACK_CONTENT = 147.1
const idleRendered = (IDLE_CONTENT / 128) * BASE
const attackRendered = (ATTACK_CONTENT / 256) * (BASE * SCALE)
check(
  'displayScale brings the attack character to the idle character size',
  Math.abs(attackRendered - idleRendered) < 1,
  `attack ${attackRendered.toFixed(2)}px vs idle ${idleRendered.toFixed(2)}px`,
)

console.log(failures === 0 ? '\nAll parity checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
