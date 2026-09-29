package com.example.game.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.example.game.animation.AnimationConfig
import com.example.game.animation.PlayerAction
import com.example.game.animation.SpriteAnimationSystem

/**
 * Live Animation Configuration & Debug Inspector dialog.
 * Enables inspecting frame dimensions, dynamically tuning FPS, adjusting frame count,
 * and testing animation transitions in real time.
 */
@Composable
fun AnimationInspectorDialog(
    animationSystem: SpriteAnimationSystem,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedAction by remember { mutableStateOf(animationSystem.currentAction) }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = modifier
                .fillMaxWidth(0.95f)
                .height(340.dp)
                .testTag("dialog_animation_inspector"),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF161822))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "SPRITE ANIMATION CONFIG",
                        color = Color(0xFFE2E7F5),
                        fontWeight = FontWeight.Black,
                        fontSize = 14.sp
                    )
                    TextButton(onClick = onDismiss, modifier = Modifier.testTag("button_close_inspector")) {
                        Text("CLOSE", color = Color(0xFF88A0DF), fontWeight = FontWeight.Bold)
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Left list: Action Selector
                    LazyColumn(
                        modifier = Modifier
                            .width(130.dp)
                            .background(Color(0xFF0F1018), RoundedCornerShape(8.dp))
                            .padding(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(animationSystem.getAllActions()) { action ->
                            val isSelected = action == selectedAction
                            val sheet = animationSystem.getSheet(action)
                            val hasSheet = sheet != null

                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(
                                        if (isSelected) Color(0xFF2C3554) else Color.Transparent,
                                        RoundedCornerShape(6.dp)
                                    )
                                    .border(
                                        width = if (isSelected) 1.dp else 0.dp,
                                        color = if (isSelected) Color(0xFF6B8AFF) else Color.Transparent,
                                        shape = RoundedCornerShape(6.dp)
                                    )
                                    .padding(vertical = 6.dp, horizontal = 8.dp)
                                    .testTag("action_tab_${action.name}")
                            ) {
                                TextButton(
                                    onClick = {
                                        selectedAction = action
                                        animationSystem.playAction(action, restartIfSame = true)
                                    },
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)
                                ) {
                                    Column {
                                        Text(
                                            text = action.displayName,
                                            color = if (isSelected) Color.White else Color(0xFFA0A5B8),
                                            fontSize = 11.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                        )
                                        Text(
                                            text = if (hasSheet) "${sheet?.frameCount}f @ ${sheet?.config?.fps}fps" else "Pending",
                                            color = if (hasSheet) Color(0xFF7DE392) else Color(0xFFFF8E8E),
                                            fontSize = 9.sp
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Right pane: Inspector Details & Controls
                    val currentConfig = animationSystem.getConfig(selectedAction)
                    val currentSheet = animationSystem.getSheet(selectedAction)

                    if (currentConfig != null && currentSheet != null) {
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .background(Color(0xFF0F1018), RoundedCornerShape(8.dp))
                                .padding(12.dp)
                        ) {
                            Text(
                                text = "Source: ${currentConfig.sourceFileName}",
                                color = Color(0xFFC4CADB),
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                text = "Bitmap: ${currentSheet.bitmap.width}x${currentSheet.bitmap.height} px",
                                color = Color(0xFFA0A5B8),
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                text = "Frame Size: ${currentSheet.frameWidth}x${currentSheet.frameHeight} px (${currentSheet.frameCount} frames)",
                                color = Color(0xFFA0A5B8),
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )

                            Spacer(modifier = Modifier.height(8.dp))

                            // FPS Slider
                            var fpsValue by remember(selectedAction) { mutableFloatStateOf(currentConfig.fps.toFloat()) }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("FPS: ${fpsValue.toInt()}", color = Color.White, fontSize = 11.sp)
                                Button(
                                    onClick = {
                                        animationSystem.playAction(selectedAction, restartIfSame = true)
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF384775)),
                                    modifier = Modifier.testTag("button_play_preview")
                                ) {
                                    Text("Preview", fontSize = 10.sp)
                                }
                            }
                            Slider(
                                value = fpsValue,
                                onValueChange = {
                                    fpsValue = it
                                    animationSystem.updateConfig(currentConfig.copy(fps = it.toInt()))
                                },
                                valueRange = 4f..30f,
                                modifier = Modifier.testTag("slider_fps")
                            )

                            // Frame Count modifier buttons
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Frame Count: ${currentSheet.frameCount}", color = Color.White, fontSize = 11.sp)
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Button(
                                        onClick = {
                                            val newCount = (currentSheet.frameCount - 1).coerceAtLeast(1)
                                            animationSystem.updateConfig(currentConfig.copy(frameCount = newCount))
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF262A3C)),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp)
                                    ) {
                                        Text("-", color = Color.White)
                                    }
                                    Button(
                                        onClick = {
                                            val newCount = currentSheet.frameCount + 1
                                            animationSystem.updateConfig(currentConfig.copy(frameCount = newCount))
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF262A3C)),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp)
                                    ) {
                                        Text("+", color = Color.White)
                                    }
                                }
                            }
                        }
                    } else {
                        Box(
                            modifier = Modifier.weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("No SpriteSheet loaded for $selectedAction", color = Color.Gray, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}
