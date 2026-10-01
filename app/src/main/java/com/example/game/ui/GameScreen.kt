package com.example.game.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.game.audio.AudioEngine
import com.example.game.engine.GameWorld
import kotlin.math.min

/**
 * Main game screen composable.
 * Runs 60 FPS tick loop, renders game canvas with nearest-neighbor scaling,
 * and overlays decoupled virtual touch controls and HUD.
 */
@Composable
fun GameScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val gameWorld = remember { GameWorld(context) }

    // Optional in the strongest sense: the game starts, plays and is perfectly playable
    // with no audio file present at all, which is the state the project is in right now.
    // Loading is fired rather than awaited, so a missing file can never hold up the first
    // frame, and `loadAll` reports rather than throws.
    val audio = remember { AudioEngine(context) }
    LaunchedEffect(Unit) {
        val found = audio.loadAll()
        Log.i("GameScreen", "audio: ${found.loaded.size} loaded, ${found.missing.size} missing")
    }

    // The world reports what happened; the audio bank decides what that sounds like. Wired
    // here rather than inside GameWorld keeps the simulation free of a dependency on sound
    // -- which matters, because sound is the one part of this that is allowed to be absent.
    //
    // One clip covers both a light and a heavy connect: a near-duplicate pair differing by a
    // few percent is not worth an asset, and the bank's replay interval stops a heavy from
    // cutting off the light hit that landed a moment before it.
    LaunchedEffect(Unit) {
        gameWorld.onSwordHit = { audio.play("sword_hit") }
        gameWorld.onFootstep = { audio.play("footsteps_stone") }
    }

    // Audio is suspended with the app and released on the way out. A looping track left
    // running in the background is the sort of thing that makes people uninstall, and the
    // pool holds native handles that must be freed rather than left to the collector.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> audio.suspend()
                Lifecycle.Event.ON_RESUME -> audio.resume()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            audio.dispose()
        }
    }

    // Dialog state for tuning/inspecting animations
    var showInspector by remember { mutableStateOf(false) }

    // Whether the world is running. The main menu gates it: the simulation is held
    // rather than started-and-paused, so nothing moves behind the menu and the scene
    // the player walks into is the one they were just looking at.
    var started by remember { mutableStateOf(false) }

    // FPS calculation state
    var fps by remember { mutableIntStateOf(60) }
    var frameCounter by remember { mutableIntStateOf(0) }
    var lastFpsCalcTime by remember { mutableLongStateOf(0L) }

    // Continuous 60 FPS game tick loop
    var gameTick by remember { mutableLongStateOf(0L) }

    LaunchedEffect(Unit) {
        var lastFrameTimeNanos = 0L
        while (true) {
            withFrameNanos { frameTimeNanos ->
                if (lastFrameTimeNanos != 0L) {
                    val dt = ((frameTimeNanos - lastFrameTimeNanos) / 1_000_000_000f).coerceIn(0.001f, 0.05f)
                    if (started) gameWorld.update(dt)

                    // FPS calculation
                    frameCounter++
                    if (frameTimeNanos - lastFpsCalcTime >= 1_000_000_000L) {
                        fps = frameCounter
                        frameCounter = 0
                        lastFpsCalcTime = frameTimeNanos
                    }
                } else {
                    lastFpsCalcTime = frameTimeNanos
                }
                lastFrameTimeNanos = frameTimeNanos
                gameTick++
            }
        }
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0C0E14))
            .testTag("game_screen_root")
    ) {
        // Read gameTick to trigger recomposition each frame
        val currentTick = gameTick

        // Render Game World on Canvas with nearest-neighbor pixel-art scaling
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .testTag("game_canvas")
        ) {
            // The world is not drawn while the menu is up, not merely left un-updated. The
            // menu's backdrop is ContentScale.Fit, so on a screen that is not 16:9 it
            // letterboxes, and a scene that is merely paused is still visible through the
            // bands. Gating update() alone is not enough.
            if (started && currentTick >= 0) { // Ensures recomposition on each tick
                drawIntoCanvas { composeCanvas ->
                    val nativeCanvas = composeCanvas.nativeCanvas

                    val scaleX = size.width / GameWorld.LOGICAL_WIDTH
                    val scaleY = size.height / GameWorld.LOGICAL_HEIGHT
                    val scale = min(scaleX, scaleY)

                    // Center within screen (letterbox / pillarbox)
                    val offsetX = (size.width - GameWorld.LOGICAL_WIDTH * scale) / 2f
                    val offsetY = (size.height - GameWorld.LOGICAL_HEIGHT * scale) / 2f

                    nativeCanvas.save()
                    nativeCanvas.translate(offsetX, offsetY)
                    nativeCanvas.scale(scale, scale)

                    // Clip to logical resolution boundaries
                    nativeCanvas.clipRect(0f, 0f, GameWorld.LOGICAL_WIDTH, GameWorld.LOGICAL_HEIGHT)

                    // Render game world (arena, background, character, effects)
                    gameWorld.render(nativeCanvas)

                    nativeCanvas.restore()
                }
            }
        }

        // --- Heads-up display and touch controls, only once play has begun ---
        // They belong to the world, so they appear and disappear with it rather than
        // sitting on top of the menu.
        if (started) {
            GameHud(
                player = gameWorld.player,
                animationSystem = gameWorld.animationSystem,
                fps = fps,
                onOpenInspector = { showInspector = true },
                onResetPosition = {
                    gameWorld.respawn()
                }
            )

            // Decoupled touch controls on top
            VirtualControls(
                onMove = { horizontal ->
                    gameWorld.player.setMovementInput(horizontal)
                },
                // Sound is played from the same `boolean` the action returns, so an input
                // the state machine refuses -- a dash with no stamina left, an attack
                // mid-swing -- stays silent instead of playing a sound for something that
                // did not happen.
                onAttack = {
                    if (gameWorld.player.onAttack()) audio.play("sword_attack")
                },
                onHeavyAttack = {
                    if (gameWorld.player.onHeavyAttack()) audio.play("heavy_attack")
                },
                onBlockChange = { isBlocking ->
                    gameWorld.player.setBlockActive(isBlocking)
                },
                onDash = {
                    if (gameWorld.player.onDash()) audio.play("dash")
                },
                onJump = {
                    if (gameWorld.player.onJump()) audio.play("jump")
                }
            )
        }

        // --- The main menu ---
        if (!started) {
            MainMenu(
                audio = audio,
                onAction = { action ->
                    when (action) {
                        // MainMenu stops its own cues as it is torn down, so the title track
                        // cannot end up playing under the first walk of a new game.
                        is MainMenuAction.Start -> started = true
                        is MainMenuAction.Quit -> context.quitApp()
                    }
                },
            )
        }

        // Animation Inspector Modal Dialog
        if (showInspector) {
            AnimationInspectorDialog(
                animationSystem = gameWorld.animationSystem,
                onDismiss = { showInspector = false }
            )
        }
    }
}
