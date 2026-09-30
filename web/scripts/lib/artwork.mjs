/**
 * Minimal PNG reader and floor-plane analysis for the verification scripts.
 *
 * The scene definitions declare a `floorRow`, and the point of this module is to
 * prove that number describes the artwork it belongs to rather than being copied
 * from another scene or guessed from the screen. It therefore re-derives the
 * visible ground plane from the PNG itself.
 *
 * The derivation deliberately avoids per-column surface tracing: the paintings are
 * heavily textured, and a per-column top-edge estimate lands anywhere within ~30px
 * of the truth depending on which stone grain it happens to catch. Aggregating over
 * the full width instead is stable, because the real combat floor is the only
 * surface in the image that spans essentially the whole frame.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/** Decodes a non-interlaced 8-bit PNG into a pixel accessor. */
export function readPng(path) {
  const buf = readFileSync(path)
  let off = 8
  let ihdr = null
  const idat = []
  let plte = null
  let trns = null
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (!ihdr) throw new Error(`${path}: no IHDR`)
  if (ihdr.depth !== 8) throw new Error(`${path}: unsupported bit depth ${ihdr.depth}`)
  if (ihdr.interlace) throw new Error(`${path}: interlaced PNG not supported`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color]
  if (!channels) throw new Error(`${path}: unsupported colour type ${ihdr.color}`)

  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = ihdr
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
  }

  const px = (x, y) => {
    const i = y * stride + x * channels
    if (ihdr.color === 3) {
      const p = plte
      return [p[out[i] * 3], p[out[i] * 3 + 1], p[out[i] * 3 + 2], out[i] < trns?.length ? trns[out[i]] : 255]
    }
    if (ihdr.color === 0) return [out[i], out[i], out[i], 255]
    if (ihdr.color === 4) return [out[i], out[i], out[i], out[i + 1]]
    return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255]
  }
  return {
    width,
    height,
    px,
    luma: (x, y) => {
      const [r, g, b] = px(x, y)
      return 0.299 * r + 0.587 * g + 0.114 * b
    },
  }
}

/**
 * The visible combat floor, as a row in the source image.
 *
 * A standable surface catches light on its top face, so its topmost row is a step
 * up from the row above. Scoring each candidate row by how much of the frame's
 * width carries that step finds the one surface that spans the whole painting —
 * the ground — and ignores rocks, ledges and scenery, which are narrow.
 *
 * Only the lower part of the image is searched, so lit areas up in the cave
 * ceiling cannot win.
 */
export function deriveFloorRow(img, { searchFrom = 0.5, step = 6, contrast = 6 } = {}) {
  const first = Math.floor(img.height * searchFrom)
  let best = -1
  let bestScore = -1
  const scores = []
  for (let y = first; y < img.height; y++) {
    let hits = 0
    for (let x = 0; x < img.width; x++) {
      if (img.luma(x, y) - img.luma(x, y - 3) > contrast) hits++
    }
    const score = hits / img.width
    scores.push({ y, score })
    if (score > bestScore) {
      bestScore = score
      best = y
    }
  }
  return { floorRow: best, score: bestScore, scores }
}

/**
 * The surface row in one horizontal window of the image, by the same
 * top-lit-edge rule as [deriveFloorRow] but aggregated over a single window.
 *
 * A window is the smallest unit that stays reliable: an individual column is too
 * easily thrown off by stone grain, while a 64px window still averages away the
 * texture and reports where the ground actually is at that part of the world.
 */
export function floorRowInWindow(img, x0, x1, { around = null, search = 24, contrast = 6 } = {}) {
  const lo = around === null ? Math.floor(img.height * 0.5) : around - search
  const hi = around === null ? img.height - 1 : around + search
  let best = -1
  let bestScore = -1
  for (let y = lo; y <= hi; y++) {
    let hits = 0
    for (let x = x0; x < x1; x++) {
      if (img.luma(x, y) - img.luma(x, y - 3) > contrast) hits++
    }
    const score = hits / (x1 - x0)
    if (score > bestScore) {
      bestScore = score
      best = y
    }
  }
  return { row: best, score: bestScore }
}

/**
 * Every standable surface in the image, found the same way but without a hint
 * about where to look.
 *
 * Used to show that the derived combat floor really is the widest one: if a rock
 * or timber ledge out-spanned the ground, the floor row would be ambiguous and the
 * scene would have to declare which one is walkable by hand.
 */
export function surfaceRows(img, { searchFrom = 0.5, contrast = 6, minScore = 0.25 } = {}) {
  const rows = []
  const first = Math.floor(img.height * searchFrom)
  for (let y = first; y < img.height; y++) {
    let hits = 0
    for (let x = 0; x < img.width; x++) {
      if (img.luma(x, y) - img.luma(x, y - 3) > contrast) hits++
    }
    const score = hits / img.width
    if (score >= minScore) rows.push({ y, score })
  }
  return rows
}
