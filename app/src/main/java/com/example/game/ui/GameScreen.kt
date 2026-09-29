package com.example.game.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
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

    // Dialog state for tuning/inspecting animations
    var showInspector by remember { mutableStateOf(false) }

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
                    gameWorld.update(dt)

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
            if (currentTick >= 0) { // Ensures recomposition on each tick
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

        // Heads-up display
        GameHud(
            player = gameWorld.player,
            animationSystem = gameWorld.animationSystem,
            fps = fps,
            onOpenInspector = { showInspector = true },
            onResetPosition = {
                gameWorld.player.resetPlayer(300f, GameWorld.FLOOR_Y)
            }
        )

        // Decoupled touch controls on top
        VirtualControls(
            onMove = { horizontal ->
                gameWorld.player.setMovementInput(horizontal)
            },
            onAttack = {
                gameWorld.player.onAttack()
            },
            onHeavyAttack = {
                gameWorld.player.onHeavyAttack()
            },
            onBlockChange = { isBlocking ->
                gameWorld.player.setBlockActive(isBlocking)
            },
            onDash = {
                gameWorld.player.onDash()
            },
            onJump = {
                gameWorld.player.onJump()
            }
        )

        // Animation Inspector Modal Dialog
        if (showInspector) {
            AnimationInspectorDialog(
                animationSystem = gameWorld.animationSystem,
                onDismiss = { showInspector = false }
            )
        }
    }
}
