package com.example.game.ui

import android.graphics.BitmapFactory
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Neutral medieval slate used by the icon button.
 *
 * The attack button is the one control that carries artwork instead of a text
 * label, so it is given the dark stone treatment rather than a saturated fill.
 * Painting a colour behind a sword icon reads as a coloured disc behind the
 * artwork; this is the source of the red circle, and it is removed rather than
 * covered over.
 */
private val NeutralButtonColor = Color(0xFF39405A)

/**
 * On-screen touch controls independent from character rendering.
 * Left side: Virtual Analog Thumbstick for smooth horizontal movement.
 * Right side: Action diamond containing Attack, Heavy Attack, Block, Dash, Jump.
 */
@Composable
fun VirtualControls(
    onMove: (Float) -> Unit,
    onAttack: () -> Unit,
    onHeavyAttack: () -> Unit,
    onBlockChange: (Boolean) -> Unit,
    onDash: () -> Unit,
    onJump: () -> Unit,
    modifier: Modifier = Modifier
) {
    val view = LocalView.current

    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp)
    ) {
        // --- Left: Virtual Joystick ---
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .size(140.dp)
                .testTag("joystick_container"),
            contentAlignment = Alignment.Center
        ) {
            VirtualJoystick(
                onMove = onMove,
                modifier = Modifier.size(130.dp)
            )
        }

        // --- Right: Action Buttons Pad ---
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .testTag("action_buttons_container")
        ) {
            ActionButtonsCluster(
                onAttack = {
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    onAttack()
                },
                onHeavyAttack = {
                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onHeavyAttack()
                },
                onBlockChange = { isPressed ->
                    if (isPressed) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    onBlockChange(isPressed)
                },
                onDash = {
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    onDash()
                },
                onJump = {
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    onJump()
                }
            )
        }
    }
}

@Composable
fun VirtualJoystick(
    onMove: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    var thumbOffset by remember { mutableStateOf(Offset.Zero) }
    val maxRadius = 45f // in dp/pixels

    Box(
        modifier = modifier
            .testTag("virtual_joystick")
            .clip(CircleShape)
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0x66222638), Color(0x3310121C))
                )
            )
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        val center = Offset(size.width / 2f, size.height / 2f)
                        val delta = offset - center
                        val dist = delta.getDistance()
                        val angle = atan2(delta.y, delta.x)
                        val clampedDist = min(dist, maxRadius * 2)
                        thumbOffset = Offset(cos(angle) * clampedDist, sin(angle) * clampedDist)
                        val normX = (thumbOffset.x / (maxRadius * 2)).coerceIn(-1f, 1f)
                        onMove(normX)
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        val newOffset = thumbOffset + dragAmount
                        val dist = newOffset.getDistance()
                        val angle = atan2(newOffset.y, newOffset.x)
                        val clampedDist = min(dist, maxRadius * 2)
                        thumbOffset = Offset(cos(angle) * clampedDist, sin(angle) * clampedDist)
                        val normX = (thumbOffset.x / (maxRadius * 2)).coerceIn(-1f, 1f)
                        onMove(normX)
                    },
                    onDragEnd = {
                        thumbOffset = Offset.Zero
                        onMove(0f)
                    },
                    onDragCancel = {
                        thumbOffset = Offset.Zero
                        onMove(0f)
                    }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        // Outer boundary ring
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                color = Color(0x44FFFFFF),
                radius = size.minDimension / 2f - 4f,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx())
            )
            // Left/Right directional indicator arrows
            val cy = size.height / 2f
            drawLine(
                color = Color(0x77FFFFFF),
                start = Offset(16f, cy),
                end = Offset(32f, cy),
                strokeWidth = 3.dp.toPx()
            )
            drawLine(
                color = Color(0x77FFFFFF),
                start = Offset(size.width - 32f, cy),
                end = Offset(size.width - 16f, cy),
                strokeWidth = 3.dp.toPx()
            )
        }

        // Thumb nub
        Box(
            modifier = Modifier
                .offset { IntOffset(thumbOffset.x.roundToInt(), thumbOffset.y.roundToInt()) }
                .size(48.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        colors = listOf(Color(0xFF5B6998), Color(0xFF282E47))
                    )
                )
                .shadow(4.dp, CircleShape)
        )
    }
}

/**
 * Loads a bitmap out of assets/, returning null when the asset is missing so a
 * button can fall back to its text labels instead of rendering an empty circle.
 */
@Composable
private fun rememberAssetIcon(assetPath: String): ImageBitmap? {
    val context = LocalContext.current
    return remember(assetPath) {
        runCatching {
            context.assets.open(assetPath).use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

@Composable
fun ActionButtonsCluster(
    onAttack: () -> Unit,
    onHeavyAttack: () -> Unit,
    onBlockChange: (Boolean) -> Unit,
    onDash: () -> Unit,
    onJump: () -> Unit
) {
    val attackIcon = rememberAssetIcon("ui/btn_attack.png")

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Top row: HEAVY ATTACK & JUMP
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ActionButton(
                label = "HEAVY",
                sublabel = "ATK",
                baseColor = Color(0xFFC8452B),
                testTag = "button_heavy_attack",
                onClick = onHeavyAttack
            )
            ActionButton(
                label = "JUMP",
                sublabel = "UP",
                baseColor = Color(0xFF2D7BC7),
                testTag = "button_jump",
                onClick = onJump
            )
        }

        // Middle row: DASH & BLOCK & ATTACK
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ActionButton(
                label = "DASH",
                sublabel = "ROLL",
                baseColor = Color(0xFF389E82),
                testTag = "button_dash",
                onClick = onDash
            )

            // Holdable Block Button
            HoldActionButton(
                label = "BLOCK",
                sublabel = "GUARD",
                baseColor = Color(0xFF9E7A26),
                testTag = "button_block",
                onPressedChange = onBlockChange
            )

            ActionButton(
                label = "ATK",
                sublabel = "SLASH",
                baseColor = NeutralButtonColor,
                testTag = "button_attack",
                size = 62,
                icon = attackIcon,
                onClick = onAttack
            )
        }
    }
}

@Composable
fun ActionButton(
    label: String,
    sublabel: String,
    baseColor: Color,
    testTag: String,
    size: Int = 54,
    icon: ImageBitmap? = null,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .size(size.dp)
            .testTag(testTag)
            .clip(CircleShape)
            .pointerInput(Unit) {
                detectTapGestures(onTap = { onClick() })
            },
        shape = CircleShape,
        color = baseColor.copy(alpha = 0.85f),
        shadowElevation = 6.dp
    ) {
        if (icon != null) {
            // 90% of the 62px button is ~56px, the requested icon size.
            // ContentScale.Fit keeps the square artwork at its natural aspect
            // ratio, so it is never cropped or stretched.
            Image(
                bitmap = icon,
                contentDescription = label,
                modifier = Modifier.fillMaxSize(0.9f),
                contentScale = ContentScale.Fit
            )
        } else {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = label,
                    color = Color.White,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = sublabel,
                    color = Color(0xCCFFFFFF),
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
fun HoldActionButton(
    label: String,
    sublabel: String,
    baseColor: Color,
    testTag: String,
    size: Int = 54,
    onPressedChange: (Boolean) -> Unit
) {
    var isPressed by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier
            .size(size.dp)
            .testTag(testTag)
            .clip(CircleShape)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        isPressed = true
                        onPressedChange(true)
                        tryAwaitRelease()
                        isPressed = false
                        onPressedChange(false)
                    }
                )
            },
        shape = CircleShape,
        color = if (isPressed) baseColor else baseColor.copy(alpha = 0.85f),
        shadowElevation = if (isPressed) 2.dp else 6.dp
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = label,
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center
            )
            Text(
                text = if (isPressed) "HELD" else sublabel,
                color = Color(0xCCFFFFFF),
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
        }
    }
}
