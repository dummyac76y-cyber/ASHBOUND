package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.game.animation.DefaultAnimationConfigs
import com.example.game.animation.PlayerAction
import com.example.game.animation.SpriteAnimationSystem
import com.example.game.controller.PlayerController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExampleRobolectricTest {

    @Test
    fun `read string from context`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appName = context.getString(R.string.app_name)
        assertEquals("Exiled Knight", appName)
    }

    @Test
    fun `verify default animation configuration`() {
        val configs = DefaultAnimationConfigs.createDefaults()
        val idleConfig = configs[PlayerAction.IDLE]
        val walkConfig = configs[PlayerAction.WALK]

        assertNotNull(idleConfig)
        assertEquals(12, idleConfig?.frameCount)
        assertEquals(10, idleConfig?.fps)
        assertTrue(idleConfig?.loop == true)

        assertNotNull(walkConfig)
        assertEquals(12, walkConfig?.frameCount)
        assertEquals(12, walkConfig?.fps)
        assertTrue(walkConfig?.loop == true)
    }

    @Test
    fun `verify player controller movement transitions to walk and idle`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val animSystem = SpriteAnimationSystem(context)
        val player = PlayerController(animSystem, x = 100f, groundY = 280f)

        // Initial state is IDLE
        player.update(0.016f, 0f, 1000f, 280f)
        assertEquals(PlayerAction.IDLE, animSystem.currentAction)

        // Move right
        player.setMovementInput(1f)
        player.update(0.016f, 0f, 1000f, 280f)
        assertEquals(PlayerAction.WALK, animSystem.currentAction)
        assertTrue(player.isFacingRight)

        // Move left
        player.setMovementInput(-1f)
        player.update(0.016f, 0f, 1000f, 280f)
        assertEquals(PlayerAction.WALK, animSystem.currentAction)
        assertFalse(player.isFacingRight) // Flipped horizontally!

        // Stop moving
        player.setMovementInput(0f)
        player.update(0.016f, 0f, 1000f, 280f)
        assertEquals(PlayerAction.IDLE, animSystem.currentAction)
    }

    @Test
    fun `verify combat actions jump and dash`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val animSystem = SpriteAnimationSystem(context)
        val player = PlayerController(animSystem, x = 100f, groundY = 280f)

        // Jump
        val jumped = player.onJump()
        assertTrue(jumped)
        assertEquals(PlayerAction.JUMP, animSystem.currentAction)

        // Reset
        player.resetPlayer(100f, 280f)

        // Dash
        val dashed = player.onDash()
        assertTrue(dashed)
        assertEquals(PlayerAction.DASH, animSystem.currentAction)
        assertTrue(player.isInvulnerable)
    }
}
