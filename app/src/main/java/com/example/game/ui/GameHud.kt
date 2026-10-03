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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.game.animation.PlayerAction
import com.example.game.animation.SpriteAnimationSystem
import com.example.game.controller.PlayerController

/**
 * Game Heads-Up Display showing player vitals, real-time animation state tracking,
 * and access to the Animation Inspector.
 */
@Composable
fun GameHud(
    player: PlayerController,
    animationSystem: SpriteAnimationSystem,
    fps: Int,
    onOpenInspector: () -> Unit,
    onResetPosition: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        // Left: Player Vitals & Status
        Column(
            modifier = Modifier
                .background(Color(0xCC10121C), RoundedCornerShape(8.dp))
                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 6.dp)
        ) {
            Text(
                text = "EXILED KNIGHT",
                color = Color(0xFFD4DAE8),
                fontSize = 11.sp,
                fontWeight = FontWeight.Black
            )

            Spacer(modifier = Modifier.height(3.dp))

            // HP Bar
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = "HP ", color = Color(0xFFFF6B6B), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                Box(
                    modifier = Modifier
                        .width(100.dp)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFF2C1414))
                ) {
                    val hpRatio = (player.hp.toFloat() / player.maxHp.toFloat()).coerceIn(0f, 1f)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(hpRatio)
                            .height(8.dp)
                            .background(Color(0xFFE63946))
                    )
                }
                Text(
                    text = " ${player.hp}/${player.maxHp}",
                    color = Color.White,
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            Spacer(modifier = Modifier.height(3.dp))

            // Stamina Bar
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = "STA", color = Color(0xFF48CAE4), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                Box(
                    modifier = Modifier
                        .width(100.dp)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(Color(0xFF0F2537))
                ) {
                    val staRatio = (player.stamina / player.maxStamina).coerceIn(0f, 1f)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(staRatio)
                            .height(6.dp)
                            .background(Color(0xFF00B4D8))
                    )
                }
            }
        }

        // Center: Real-time Animation State Monitor
        val currentSheet = animationSystem.getSheet(animationSystem.currentAction)
        val totalFrames = currentSheet?.frameCount ?: 1
        val frameIdx = animationSystem.currentFrameIndex + 1

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .background(Color(0xDD10121C), RoundedCornerShape(8.dp))
                .border(1.dp, Color(0x446B8AFF), RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .testTag("hud_animation_monitor")
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "STATE:",
                    color = Color(0xFFA0A5B8),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = animationSystem.currentAction.name,
                    color = when (animationSystem.currentAction) {
                        PlayerAction.IDLE -> Color(0xFF7DE392)
                        // Same green as IDLE: the fidget *is* idle, and a second colour in the
                        // state readout would imply it is a distinct state the game is in rather
                        // than idle doing something incidental.
                        PlayerAction.IDLE_VARIANT -> Color(0xFF7DE392)
                        PlayerAction.WALK -> Color(0xFF64B5F6)
                        PlayerAction.ATTACK, PlayerAction.HEAVY_ATTACK -> Color(0xFFFF5252)
                        PlayerAction.BLOCK -> Color(0xFFFFD54F)
                        PlayerAction.DASH -> Color(0xFF80CBC4)
                        PlayerAction.JUMP -> Color(0xFFBA68C8)
                        else -> Color.White
                    },
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black
                )
            }

            Text(
                text = "FRAME: $frameIdx/$totalFrames | ${(player.vx).toInt()}px/s | ${if (player.isFacingRight) "→ RIGHT" else "← LEFT"}",
                color = Color(0xFFCCD2E3),
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace
            )
        }

        // Right: Inspector & Reset Buttons
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(
                onClick = onResetPosition,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xCC2A2E44)),
                shape = RoundedCornerShape(6.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier.testTag("button_reset_character")
            ) {
                Text("RESET", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }

            Button(
                onClick = onOpenInspector,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xEE394B7B)),
                shape = RoundedCornerShape(6.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier.testTag("button_open_inspector")
            ) {
                Text("CONFIG ⚙", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
