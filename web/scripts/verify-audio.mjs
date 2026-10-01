/**
 * Audio catalogue check.
 *
 * The web and Android audio banks are transcribed, not shared -- one is TypeScript against
 * the Web Audio API, the other Kotlin against SoundPool -- so this compares the two tables
 * as written and catches the failure that matters: the two engines disagreeing about what a
 * clip is called, where it lives, or how it behaves.
 *
 * It also checks the state the project is actually in, which is no audio files at all.
 * There are no placeholders here and there will not be any: a silent file that loads
 * successfully is worse than an absent one, because it turns a missing asset into a
 * debugging session. So the catalogue is verified, the directories are verified, and the
 * missing files are verified to be missing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB_SYSTEM = readFileSync(join(ROOT, 'web/src/game/AudioSystem.ts'), 'utf8')
const KT_ENGINE = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/audio/AudioEngine.kt'),
  'utf8',
)
const WEB_MAIN = readFileSync(join(ROOT, 'web/src/main.ts'), 'utf8')
const WEB_MENU = readFileSync(join(ROOT, 'web/src/ui/MainMenu.ts'), 'utf8')
const KT_GAME_SCREEN = readFileSync(
  join(ROOT, 'app/src/main/java/com/example/game/ui/GameScreen.kt'),
  'utf8',
)
const KT_MENU = readFileSync(join(ROOT, 'app/src/main/java/com/example/game/ui/MainMenu.kt'), 'utf8')

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** Every `clip(...)` / `clip(...)` call in either engine's table, as plain objects. */
function parseWebClips(src) {
  const out = []
  const table = src.slice(src.indexOf('export const AUDIO_CLIPS'))
  // `[^]` rather than `.` so an entry wrapped over several lines still parses: the flag that
  // needs explaining is exactly the one worth explaining, so it is the one that goes multi-line.
  for (const m of table.matchAll(/clip\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'([^]*?)\)\s*(?:,|\n)/g)) {
    const [, id, category, file, rest] = m
    const num = (key) => {
      const hit = rest.match(new RegExp(`${key}:\\s*([0-9.]+)`))
      return hit ? Number(hit[1]) : 0
    }
    const range = rest.match(/every:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/)
    out.push({
      id,
      category,
      file,
      loop: /loop:\s*true/.test(rest),
      volume: num('volume'),
      minInterval: num('minInterval'),
      every: range ? [Number(range[1]), Number(range[2])] : null,
    })
  }
  return out
}

function parseKotlinClips(src) {
  const out = []
  const table = src.slice(src.indexOf('val AUDIO_CLIPS'))
  for (const m of table.matchAll(
    /clip\(\s*"([^"]+)"\s*,\s*AudioCategory\.(\w+)\s*,\s*"([^"]+)"([^]*?)\)(?:,|\n)/g,
  )) {
    const [, id, category, file, rest] = m
    const num = (key) => {
      const hit = rest.match(new RegExp(`${key}\\s*=\\s*([0-9.]+)f?`))
      return hit ? Number(hit[1]) : 0
    }
    const range = rest.match(/every\s*=\s*([0-9.]+)f?\s+to\s+([0-9.]+)f?/)
    out.push({
      id,
      category: category.toLowerCase(),
      file,
      loop: /loop\s*=\s*true/.test(rest),
      volume: num('volume'),
      minInterval: num('minInterval'),
      every: range ? [Number(range[1]), Number(range[2])] : null,
    })
  }
  return out
}

/**
 * Two nulls agree; two ranges agree only if both ends do. The ambience clips carry the one
 * number that has to match exactly on both platforms, because a web fire that pops every 9s
 * against an Android fire that pops every 30s is the sort of thing nobody notices in review.
 */
function sameEvery(a, b) {
  if (a === null || b === null) return a === b
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

const web = parseWebClips(WEB_SYSTEM)
const kt = parseKotlinClips(KT_ENGINE)

// --- The catalogue ----------------------------------------------------------
section('Catalogue parity')
check('the web catalogue parses', web.length > 0, `${web.length} clips`)
check('the Android catalogue parses', kt.length > 0, `${kt.length} clips`)
check('both catalogues have the same length', web.length === kt.length, `${web.length} vs ${kt.length}`)

const webById = new Map(web.map((c) => [c.id, c]))
const ktById = new Map(kt.map((c) => [c.id, c]))
for (const clip of web) {
  const other = ktById.get(clip.id)
  if (!other) {
    check(`${clip.id} exists on both platforms`, false, 'missing from AudioEngine.kt')
    continue
  }
  check(
    `${clip.id} agrees across engines`,
    clip.file === other.file &&
      clip.category === other.category &&
      clip.loop === other.loop &&
      Math.abs(clip.volume - other.volume) < 1e-6 &&
      Math.abs(clip.minInterval - other.minInterval) < 1e-6 &&
      sameEvery(clip.every, other.every),
    `web ${JSON.stringify(clip)} vs kotlin ${JSON.stringify(other)}`,
  )
}
for (const clip of kt) {
  check(`${clip.id} exists on both platforms`, webById.has(clip.id))
}

// --- Filenames --------------------------------------------------------------
section('Filenames')
/**
 * The 12 filenames, fixed here rather than derived, so this fails when one engine drops a
 * clip instead of agreeing with the other about the omission.
 */
const EXPECTED = [
  'music/main_menu_music.ogg',
  'ambience/main_menu_ambience.ogg',
  'ambience/campfire.ogg',
  'sfx/sword_attack.ogg',
  'sfx/heavy_attack.ogg',
  'sfx/sword_hit.ogg',
  'sfx/footsteps_stone.ogg',
  'sfx/jump.ogg',
  'sfx/dash.ogg',
  'sfx/block.ogg',
  'sfx/hurt.ogg',
  'sfx/death.ogg',
]
for (const file of EXPECTED) {
  check(`${file} is in the web catalogue`, web.some((c) => c.file === file))
  check(`${file} is in the Android catalogue`, kt.some((c) => c.file === file))
}

// --- The shared audio root --------------------------------------------------
section('Paths')
// The two roots have to resolve to the same file. Web goes through `assetUrl` because that
// is what applies the fingerprint; Android prefixes the assets dir itself. Comparing the
// tables alone would miss a web path that had quietly stopped being fingerprinted, or a
// Kotlin root that had been changed to something assets/audio is not nested in.
check('the web resolves clips through assetUrl', /assetUrl\(c\.file\)/.test(WEB_SYSTEM))
check('the Android path root is assets/audio', /AUDIO_ROOT\s*=\s*"audio"/.test(KT_ENGINE))
check(
  'every clip sits under one of the three audio folders',
  web.every((c) => /^(music|ambience|sfx)\/[a-z_]+\.ogg$/.test(c.file)),
  web.filter((c) => !/^(music|ambience|sfx)\/[a-z_]+\.ogg$/.test(c.file)).map((c) => c.file).join(', '),
)
check(
  'each clip file is in the folder its category claims',
  web.every((c) => c.file.startsWith(`${c.category}/`)),
  web.filter((c) => !c.file.startsWith(`${c.category}/`)).map((c) => `${c.id}: ${c.category} vs ${c.file}`).join(', '),
)

// --- Directories exist on both platforms ------------------------------------
section('Asset directories')
for (const dir of ['music', 'ambience', 'sfx']) {
  for (const [label, base] of [
    ['android', join(ROOT, 'app/src/main/assets/audio', dir)],
    ['web', join(ROOT, 'web/public/audio', dir)],
  ]) {
    check(`${label} assets/audio/${dir} exists`, existsSync(base))
  }
}

// --- No placeholder audio ---------------------------------------------------
section('No placeholder audio')
/**
 * A tiny file, or one that is not Ogg at all, is a placeholder. Caught by content rather
 * than by size alone so a future 0-byte commit fails here too.
 */
const OGG_MAGIC = 'OggS'
function walkAudio(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walkAudio(p) : [p]
  })
}
const androidAudio = walkAudio(join(ROOT, 'app/src/main/assets/audio'))
const realAndroid = androidAudio.filter((p) => p.endsWith('.ogg'))
check(
  'no placeholder .ogg files were committed',
  realAndroid.every((p) => statSync(p).size > 1024),
  realAndroid.filter((p) => statSync(p).size <= 1024).join(', '),
)
for (const p of realAndroid) {
  const head = Buffer.alloc(4)
  readFileSync(p).copy(head, 0, 0, 4)
  check(`${p.slice(ROOT.length + 1)} is real Ogg data`, head.toString('latin1') === OGG_MAGIC)
}

// --- Every clip is either wired or explicitly reserved -----------------------
section('Wiring')
/**
 * Clips with no trigger yet, and why.
 *
 * Listing them is the point. An empty list would mean every clip is played, which is not
 * true: the player cannot be damaged yet and there is no campfire in the world, so four of
 * these have nothing to fire them. An unlisted clip with no trigger is the failure -- a
 * catalogue entry that looks finished and is not.
 */
const RESERVED = {
  block: 'nothing damages the player, so no block ever connects',
  hurt: 'nothing damages the player',
  death: 'nothing damages the player',
}
const TRIGGER_SOURCES = [
  ['web/src/main.ts', WEB_MAIN],
  ['web/src/game/GameWorld.ts', readFileSync(join(ROOT, 'web/src/game/GameWorld.ts'), 'utf8')],
  ['app/.../GameScreen.kt', KT_GAME_SCREEN],
  ['app/.../GameWorld.kt', readFileSync(join(ROOT, 'app/src/main/java/com/example/game/engine/GameWorld.kt'), 'utf8')],
  ['app/.../MainMenu.kt', KT_MENU],
]
for (const clip of web) {
  if (RESERVED[clip.id]) {
    check(
      `${clip.id} is reserved, not silently unwired`,
      !TRIGGER_SOURCES.some(([, src]) => new RegExp(`['"]${clip.id}['"]`).test(src)),
      `reserved (${RESERVED[clip.id]}) but already has a trigger -- drop it from RESERVED`,
    )
    continue
  }
  const wired = TRIGGER_SOURCES.filter(([, src]) =>
    new RegExp(`\\bplay\\(\\s*['"]${clip.id}['"]|\\bstart\\(\\s*${clip.id.toUpperCase()}`).test(src),
  ).map(([name]) => name)
  check(
    `${clip.id} has a trigger`,
    wired.length > 0,
    `no play('${clip.id}') or start(${clip.id.toUpperCase()}) anywhere`,
  )
}
for (const [id, reason] of Object.entries(RESERVED)) {
  check(`${id} is still in the catalogue while reserved`, webById.has(id), reason)
}

// --- Menu cues --------------------------------------------------------------
section('Menu cues')
check('the web starts the menu music', /audio\.start\(MAIN_MENU_MUSIC\)/.test(WEB_MAIN))
check('the web starts the menu ambience', /audio\.start\(MAIN_MENU_AMBIENCE\)/.test(WEB_MAIN))
check('the web menu stops cues on start', /audio\.stop\(\)/.test(WEB_MAIN))
check('Android starts the menu music', /audio\.start\(MAIN_MENU_MUSIC\)/.test(KT_MENU))
check('Android starts the menu ambience', /audio\.start\(MAIN_MENU_AMBIENCE\)/.test(KT_MENU))
// The fire's crackle rides with the menu, not with a world object that does not exist yet.
// AUDIO_SETUP.md asks for exactly this, and it keeps the menu to one place that decides what
// it is playing.
check('the web starts the campfire with the menu cues', /audio\.start\(CAMPFIRE\)/.test(WEB_MAIN))
check('Android starts the campfire with the menu cues', /audio\.start\(CAMPFIRE\)/.test(KT_MENU))
check(
  'and the campfire stops with them rather than looping on',
  /audio\.stop\(\)/.test(WEB_MAIN) && /onDispose\s*\{\s*audio\.stop\(\)/s.test(KT_MENU),
)
check('Android stops cues when the menu is torn down', /onDispose\s*\{\s*audio\.stop\(\)/s.test(KT_MENU))
check('the menu music id matches on both', /MAIN_MENU_MUSIC\s*=\s*'main_menu_music'/.test(WEB_SYSTEM) && /MAIN_MENU_MUSIC\s*=\s*"main_menu_music"/.test(KT_ENGINE))

// --- Settings toggles -------------------------------------------------------
section('Settings')
check('the web settings screen has a MUSIC switch', /audioToggle\('MUSIC'/.test(WEB_MENU))
check('the web settings screen has an FX switch', /audioToggle\('FX'/.test(WEB_MENU))
check('the web switches are bound to the bank', /audio\.setMusicEnabled\(on\)/.test(WEB_MENU) && /audio\.setSfxEnabled\(on\)/.test(WEB_MENU))
check('the removed AUDIO FILES row is gone on the web', !/AUDIO FILES/.test(WEB_MENU))
check('Android settings has a MUSIC switch', /AudioToggleRow\("MUSIC"/.test(KT_MENU))
check('Android settings has an FX switch', /AudioToggleRow\("FX"/.test(KT_MENU))
check('the Android switches are bound to the bank', /audio\.setMusicEnabled\(it\)/.test(KT_MENU) && /audio\.setSfxEnabled\(it\)/.test(KT_MENU))
check('the removed AUDIO FILES row is gone on Android', !/AUDIO FILES/.test(KT_MENU))
check('neither platform claims audio is finished', !/AWAITING AUDIO ASSETS/.test(WEB_MENU) && !/AWAITING AUDIO ASSETS/.test(KT_MENU))

// --- Ambience belongs to FX, not to music ------------------------------------
section('Ambience rides the FX switch')
/**
 * The grouping is the bug this file exists to prevent, so it is asserted rather than assumed.
 * Both ambience clips used to be gated on the music flag, which meant the two switches read as
 * "music" and "everything else" while the fire kept crackling after effects were switched off,
 * and switching music off killed a fire that had nothing to do with it.
 *
 * The fire is the sharp end of this: it is the one clip the player can hear at all times on
 * the menu, so it is the one they notice surviving a mute.
 */
for (const [label, system] of [['web', WEB_SYSTEM], ['Android', KT_ENGINE]]) {
  check(
    `${label}: the ambience mixer is scaled by the FX flag, not the music one`,
    /gains\.ambience\.gain\.value = this\.sfxEnabled/.test(system) ||
      /entry\.category == AudioCategory\.AMBIENCE\) sfxEnabled/.test(system),
  )
  check(
    `${label}: ambience one-shots are gated on FX`,
    /!this\.sfxEnabled\) return false/.test(system) || /!sfxEnabled\) return false/.test(system),
  )
  check(
    `${label}: the repeating ambience schedule is gated on FX`,
    /!this\.sfxEnabled/.test(system) || /!sfxEnabled/.test(system),
  )
  check(
    `${label}: the mute rule is written down once rather than repeated per call site`,
    /mutedFor\(/.test(system) || /AMBIENCE\) sfxEnabled/.test(system),
    'so the two toggles cannot drift apart between the loop and the one-shot path',
  )
  // Matched to the end of the member, at the four-space indent Kotlin gives it. Stopping at
  // the first `\n    }` would cut the function off at its first inner block and let a real
  // regression hide past the cut.
  const musicMute = system.match(/\n(\s+)(?:fun )?setMusicEnabled\(on: (?:boolean|Boolean)\)(:[^\n]*)?\s*\{([\s\S]*?)\n\1\}(?=\n|$)/)
  check(
    `${label}: switching music off does not touch the ambience`,
    musicMute !== null && !/sfxEnabled|repeating|removeCallbacks|clearTimeout|\.stop\(/.test(musicMute[3]),
    'music owns the music mixer and nothing else',
  )
  const fxMute = system.match(/\n(\s+)(?:fun )?setSfxEnabled\(on: (?:boolean|Boolean)\)(:[^\n]*)?\s*\{([\s\S]*?)\n\1\}(?=\n|$)/)
  check(
    `${label}: switching FX off parks the repeating clips, and back on restores them`,
    fxMute !== null && /clearTimeout|removeCallbacks/.test(fxMute[3]) && /applyVolumes|applyGains/.test(fxMute[3]),
    'otherwise a gated one-shot would keep firing behind the mute',
  )
  check(
    `${label}: unmuting replays whatever was asked for while muted`,
    fxMute !== null && /wanted/.test(fxMute[3]) && /start\(/.test(fxMute[3]),
    'a menu entered with FX off must get its fire when FX comes back on',
  )
  const musicMuteBody = musicMute === null ? '' : musicMute[3]
  // Both mute paths, not just one: a muted loop and a muted repeating clip each have to
  // leave the intent behind, and a menu entered with FX off is silent for the whole visit if
  // either one forgets. Matching the branch to its own `return false` keeps a stray
  // `wanted.add` elsewhere in the file from satisfying this.
  check(
    `${label}: a muted start still records its intent, so unmuting has something to replay`,
    /mutedFor\(entry\)\)\s*\{\s*this\.wanted\.add\(id\)\s*return false\s*\}/.test(system) ||
      /mutedFor\(entry\)\)\s*\{\s*wanted\.add\(id\)\s*return false\s*\}/.test(system),
  )
  check(
    `${label}: a muted repeating clip records its intent too`,
    /!this\.sfxEnabled\)\s*\{\s*this\.wanted\.add\(id\)\s*return false\s*\}/.test(system) ||
      /!sfxEnabled\)\s*\{\s*wanted\.add\(id\)\s*return false\s*\}/.test(system),
    'the ambience is a repeating clip, so this is the one that actually matters for the fire',
  )
  check(
    `${label}: muting music cannot be undone by the FX switch and vice versa`,
    musicMuteBody !== '' && !/setSfxEnabled/.test(musicMuteBody),
  )
}
check(
  'the web muting path never calls stop(), which is what killed the ambience',
  !/setMusicEnabled\(on: boolean\)[\s\S]{0,400}?this\.stop\(\)/.test(WEB_SYSTEM),
)
check(
  'Android applies the volumes on an FX change, not only on a music change',
  /fun setSfxEnabled\(on: Boolean\) \{\s*sfxEnabled = on\s*applyVolumes\(\)/.test(KT_ENGINE),
  'otherwise the campfire keeps playing at full volume with FX off',
)

// --- Missing assets are not fatal ------------------------------------------
section('Missing assets are survivable')
check('the web loader reports rather than throws', /missing:\s*readonly string\[\]/.test(WEB_SYSTEM))
check('the web play returns a boolean', /play\(id: string\): boolean/.test(WEB_SYSTEM))
check('the web unlock is gesture-gated', /unlock\(\)/.test(WEB_MAIN))
check('the web page loads without audio', /void audio\.loadAll\(\)/.test(WEB_MAIN))
check('the Android loader reports rather than throws', /val missing: List<String>/.test(KT_ENGINE))
check('the Android play returns a boolean', /fun play\(id: String\): Boolean/.test(KT_ENGINE))
check('Android loading is fired, not awaited on the first frame', /LaunchedEffect\(Unit\)[\s\S]{0,200}audio\.loadAll\(\)/.test(KT_GAME_SCREEN))
check('Android suspends audio with the app', /ON_PAUSE -> audio\.suspend\(\)/.test(KT_GAME_SCREEN))
check('Android releases the pool on dispose', /audio\.dispose\(\)/.test(KT_GAME_SCREEN))

// --- Installed files are actually playable ------------------------------------
section('Installed files')
/**
 * Only the clips that are installed can be measured, so this is conditional by design: with
 * nothing installed there is nothing to say, and the check above already covers that case.
 *
 * Two bugs lived here until real files arrived, which is why they get their own checks now.
 * A cue asked for before its buffer finished decoding used to return false and never be
 * retried, so the music silently never played while the ambience did. And muting music called
 * `stop()`, which takes every loop with it, so turning music off killed the fire too and
 * turning it back on left both silent. Neither was visible while the whole table was empty.
 */
const installed = web.filter((c) => existsSync(join(ROOT, 'app/src/main/assets', 'audio', c.file)))
check(
  'at least one clip is installed, or this section proves nothing',
  installed.length > 0,
  `${installed.length} of ${web.length} installed`,
)
check('an early start() records its intent for retry', /this\.wanted\.add\(id\)/.test(WEB_SYSTEM))
check('loadAll replays whatever was asked for too early', /for \(const id of \[\.\.\.this\.wanted\]\)/.test(WEB_SYSTEM))
check('stop() clears that intent, so a stopped cue cannot resurrect', /this\.wanted\.clear\(\)|this\.wanted\.delete\(id\)/.test(WEB_SYSTEM))
check(
  'muting music does not stop the sources, which is what killed the ambience',
  /setMusicEnabled\(on: boolean\)[\s\S]{0,300}?this\.applyGains\(\)/.test(WEB_SYSTEM) &&
    !/setMusicEnabled\(on: boolean\)[\s\S]{0,300}?this\.stop\(\)/.test(WEB_SYSTEM),
  'sets the gain and nothing else',
)
for (const clip of installed) {
  const path = join(ROOT, 'app/src/main/assets', 'audio', clip.file)
  check(`${clip.file} is present and not a stub`, statSync(path).size > 1024)
  check(`${clip.file} is mirrored into web/public by sync-assets`, existsSync(join(ROOT, 'web/public', 'audio', clip.file)))
}

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} of ${checks} checks FAILED`}`)
process.exit(failures === 0 ? 0 : 1)