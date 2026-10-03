import { SpriteAnimationSystem } from '../src/game/SpriteAnimationSystem.ts'
import { createDefaultConfigs } from '../src/game/AnimationConfig.ts'
import { PlayerAction } from '../src/game/PlayerAction.ts'
const cfg = createDefaultConfigs().get(PlayerAction.IDLE_VARIANT)
console.log('cfg:', {fps:cfg.fps, loop:cfg.loop, pingPong:cfg.pingPong, frames:cfg.frameCount})
const sys = new SpriteAnimationSystem('/sprites', new Map([[PlayerAction.IDLE_VARIANT,cfg]]),
  async () => ({width:1024,height:128}))
await sys.reloadAll()
console.log('played:', sys.playAction(PlayerAction.IDLE_VARIANT), 'action now:', sys.currentAction)
for(let i=0;i<8;i++){ sys.update(1/cfg.fps); console.log(i,'frame=',sys.currentFrameIndex,'elapsed=',sys.elapsedTimeSeconds.toFixed(3),'fin=',sys.isFinished) }
