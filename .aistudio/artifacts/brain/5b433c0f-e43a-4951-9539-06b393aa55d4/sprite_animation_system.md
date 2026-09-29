# Exiled Knight - 2D Sprite Animation System

## 1. Asset & Frame Layout Analysis

We inspected the provided character PNG sprite sheets:

| Asset Name | Source File | Sheet Dimensions | Frame Count | Per-Frame Size | Default FPS | Loop |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CHARACTER** | `character.png` | 128 x 128 px | **1** | 128 x 128 px | - | N/A |
| **IDLE** | `idle.png` | 1536 x 128 px | **12** | 128 x 128 px | 10 FPS | Yes |
| **WALK** | `walk.png` | 1536 x 128 px | **12** | 128 x 128 px | 12 FPS | Yes |
| **ATTACK** | `attack.png` | 1024 x 128 px | **8** | 128 x 128 px | 16 FPS | No |
| **HEAVY ATK** | `heavy_attack.png` | 1280 x 128 px | **10** | 128 x 128 px | 14 FPS | No |
| **BLOCK** | `block.png` | 768 x 128 px | **6** | 128 x 128 px | 12 FPS | Yes |
| **DASH** | `dash.png` | 768 x 128 px | **6** | 128 x 128 px | 15 FPS | No |
| **HURT** | `hurt.png` | 512 x 128 px | **4** | 128 x 128 px | 12 FPS | No |
| **DEATH** | `death.png` | 1024 x 128 px | **8** | 128 x 128 px | 8 FPS | No |

---

## 2. Animation Logic & State Machine

- **State Transitions**:
  - **Moving Left or Right** $\rightarrow$ Transitions to `WALK`.
  - **Stopped** $\rightarrow$ Smoothly transitions to `IDLE`.
  - **Horizontal Direction** $\rightarrow$ Changing direction flips the sprite horizontally (`canvas.scale(-1f, 1f)`) without reloading or altering the PNG file.
  - **Frame Persistence** $\rightarrow$ The animation does **not** restart every game frame. It tracks elapsed time and advances frame indexes steadily based on the action's target FPS.
  - **Action Completion** $\rightarrow$ Non-looping actions (e.g. `ATTACK`, `HEAVY_ATTACK`, `DASH`) lock or transition into their follow-through frames and return smoothly to `IDLE` or `WALK` upon completion.

---

## 3. Pixel-Art Rendering & Resolution

- **Logical Game Resolution**: Rendered at a logical 640x360 16:9 canvas, uniformly scaled with aspect ratio preservation (letterbox / pillarbox centering).
- **Nearest-Neighbor Filtering**: `Paint.isFilterBitmap = false` and `Paint.isAntiAlias = false` guarantees crisp retro pixel edges with zero blurry bilinear interpolation.

---

## 4. Touch Controls

- **Left Thumb Virtual Joystick**: Free-floating drag vector for variable walking speed and directional turning.
- **Combat Cluster (Right)**:
  - `ATK` (Quick slash combo)
  - `HEAVY` (Overhead slam with shockwave)
  - `BLOCK` (Hold to guard and deflect damage)
  - `DASH` (Rapid roll/thrust with invulnerability window)
  - `JUMP` (Airborne jump physics with ground collision)

---

## 5. Live In-Game Configuration & Inspector

Tapping **CONFIG ⚙** in the top-right HUD opens the Live Animation Inspector, where you can:
1. Preview each action animation.
2. Dynamically adjust playback **FPS** via slider.
3. Modify the **frame count** in real-time.
4. Inspect raw dimensions and loaded sprite sheet properties.
