# ASHBOUND audio assets

ASHBOUND already contains a shared audio contract:

- Web: `web/src/game/AudioSystem.ts`
- Android: `app/src/main/java/com/example/game/audio/AudioEngine.kt`

Both engines use the same IDs and the same relative paths under `audio/`.

## Files to add manually

### Web

Place the real files under:

```text
web/public/audio/music/main_menu_music.ogg
web/public/audio/ambience/main_menu_ambience.ogg
web/public/audio/ambience/campfire.ogg
web/public/audio/sfx/sword_attack.ogg
web/public/audio/sfx/heavy_attack.ogg
web/public/audio/sfx/sword_hit.ogg
web/public/audio/sfx/footsteps_stone.ogg
web/public/audio/sfx/jump.ogg
web/public/audio/sfx/dash.ogg
web/public/audio/sfx/block.ogg
web/public/audio/sfx/hurt.ogg
web/public/audio/sfx/death.ogg
```

### Android

Mirror the same files under:

```text
app/src/main/assets/audio/music/main_menu_music.ogg
app/src/main/assets/audio/ambience/main_menu_ambience.ogg
app/src/main/assets/audio/ambience/campfire.ogg
app/src/main/assets/audio/sfx/sword_attack.ogg
app/src/main/assets/audio/sfx/heavy_attack.ogg
app/src/main/assets/audio/sfx/sword_hit.ogg
app/src/main/assets/audio/sfx/footsteps_stone.ogg
app/src/main/assets/audio/sfx/jump.ogg
app/src/main/assets/audio/sfx/dash.ogg
app/src/main/assets/audio/sfx/block.ogg
app/src/main/assets/audio/sfx/hurt.ogg
app/src/main/assets/audio/sfx/death.ogg
```

Do not commit the ZIP's separate `MenuAudio.ts`/`useMenuAudio.ts` implementation. The repository already has an audio manager, and maintaining two competing audio systems would cause duplicated playback and inconsistent settings.

## Main menu

The existing web menu already owns the music and ambience lifecycle. The audio manager also contains a dedicated `campfire` looping ambience clip. When the campfire file is installed, it should be started and stopped with the main-menu ambience rather than being implemented as a second audio manager.

## Missing files are safe

Missing audio is intentionally non-fatal. The game should boot silently until the real assets are added. Do not create fake placeholder `.ogg` files.

## Source audio from the menu-audio ZIP

The supplied ZIP contains `menu-music.mp3` and `menu-ambience.mp3`. Rename/convert them to the repository contract above rather than adding a second `public/audio` implementation.
