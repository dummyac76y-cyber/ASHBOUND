import { chromium } from 'playwright-core'
import { readFile } from 'node:fs/promises'
const b = await chromium.launch()
const p = await (await b.newContext()).newPage()
const files = {
  idle: 'app/src/main/assets/sprites/idle.png',
  idle_variant: 'app/src/main/assets/sprites/idle_variant.png',
}
for (const [name, path] of Object.entries(files)) {
  const b64 = (await readFile(path)).toString('base64')
  const r = await p.evaluate(async ({ b64 }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.width; cv.height = img.height
    const cx = cv.getContext('2d', { willReadFrequently: true })
    cx.drawImage(img, 0, 0)
    const cell = img.height
    const frames = Math.trunc(img.width / cell)
    const out = []
    for (let f = 0; f < frames; f++) {
      const d = cx.getImageData(f * cell, 0, cell, cell).data
      let bottom = -1, top = cell, left = cell, right = -1
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        if (d[(y * cell + x) * 4 + 3] > 8) {
          if (y > bottom) bottom = y
          if (y < top) top = y
          if (x < left) left = x
          if (x > right) right = x
        }
      }
      out.push({ f, bottom, top, h: bottom - top + 1, w: right - left + 1 })
    }
    return { w: img.width, h: img.height, frames, cell, out }
  }, { b64 })
  console.log(`${name}: ${r.w}x${r.h} = ${r.frames} frames of ${r.cell}px`)
  console.log('  footRow(bottom):', r.out.map(o => o.bottom).join(','))
  console.log('  height:', r.out.map(o => o.h).join(','), ' median=', (() => { const s = r.out.map(o=>o.h).sort((a,b)=>a-b); return s[Math.floor(s.length/2)] })())
  console.log('  width :', r.out.map(o => o.w).join(','), ' median=', (() => { const s = r.out.map(o=>o.w).sort((a,b)=>a-b); return s[Math.floor(s.length/2)] })())
}
await b.close()
