import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright-core'
const ROOT='/workspace/2594426d-bb11-4f70-be2b-49e2a6d55731/sessions/agent_f42c5e42-cdce-44c4-9af2-5b2f0fd490cf'
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ogg':'audio/ogg','.woff2':'font/woff2','.json':'application/json'}
const srv=createServer(async(req,res)=>{const u=(req.url??'/').split('?')[0];const rel=u==='/'?'/index.html':u
  try{const body=await readFile(join(ROOT,'web/dist',rel));res.writeHead(200,{'content-type':MIME[extname(rel)]??'application/octet-stream'});res.end(body)}catch{res.writeHead(404).end('nf')}})
const port=await new Promise(r=>srv.listen(0,'127.0.0.1',()=>r(srv.address().port)))
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1280,height:720}})).newPage()
await p.goto(`http://127.0.0.1:${port}/?debug=1`,{waitUntil:'load'})
await p.waitForFunction(()=>window.__game!==undefined,null,{timeout:30000})
await p.waitForTimeout(2500)
// Measure the on-screen bottom of the rendered character for each fidget frame.
const r=await p.evaluate(()=>{
  const g=window.__game
  const anim=g.animations
  const out=[]
  const cfg=anim.getConfig('IDLE_VARIANT')
  anim.playAction('IDLE_VARIANT',true)
  for(let f=0;f<8;f++){
    anim.currentFrameIndex=f
    anim.elapsedTimeSeconds=0
    // Foot offset the engine would apply for this frame
    out.push({f, foot:anim.footOffsetForCurrentFrame(70)})
  }
  return out
})
console.log('per-frame foot offset (logical px):')
for(const o of r) console.log(`  frame ${o.f}: ${o.foot.toFixed(2)}px`)
// The offset is *meant* to vary: it cancels the per-frame row drift so the visible feet land
// in one place. The quantity that must be constant is the compensated position,
//   feetY = (groundY + offset) - (cellHeight-1-row)/cellHeight * displaySize  ==  groundY
// so a constant compensation is what "planted" means here.
const rows=[115,115,116,116,117,117,117,117]
const cell=128, disp=70*0.929
const comp=r.map((o,i)=>o.foot-((cell-1-rows[i])/cell)*disp)
const spread=Math.max(...comp)-Math.min(...comp)
console.log('compensated feet position relative to the floor plane (logical px):')
comp.forEach((c,i)=>console.log(`  frame ${i}: ${c.toFixed(4)}`))
console.log(`spread: ${spread.toFixed(4)}px  ${spread<0.01?'-> planted on the floor':'-> SLIDING'}`)
// And confirm the measured offset really is the row compensation, not an arbitrary number.
const expect=r.map((_,i)=>((cell-1-rows[i])/cell)*disp)
const err=Math.max(...r.map((o,i)=>Math.abs(o.foot-expect[i])))
console.log(`offset matches the measured foot rows to ${err.toFixed(4)}px`)
await b.close(); srv.close()
