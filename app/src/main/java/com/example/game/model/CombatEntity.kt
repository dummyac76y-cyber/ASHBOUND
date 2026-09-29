package com.example.game.model

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import kotlin.math.sin

/**
 * Floating damage number effect.
 */
data class DamageText(
    var x: Float,
    var y: Float,
    val text: String,
    val color: Int,
    var alpha: Float = 1.0f,
    var lifetime: Float = 0.8f
) {
    fun update(dt: Float): Boolean {
        y -= 35f * dt
        lifetime -= dt
        alpha = (lifetime / 0.8f).coerceIn(0f, 1f)
        return lifetime > 0
    }
}

/**
 * Spark particle created on sword hit or block deflection.
 */
data class SparkParticle(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    val color: Int,
    var size: Float,
    var life: Float = 0.4f
) {
    fun update(dt: Float): Boolean {
        x += vx * dt
        y += vy * dt
        vy += 200f * dt // gravity
        life -= dt
        return life > 0
    }
}

/**
 * Interactive Training Target in the arena so the player can test combat actions.
 */
class TrainingDummy(
    var x: Float,
    var groundY: Float,
    val width: Float = 40f,
    val height: Float = 75f
) {
    var maxHp: Int = 100
    var hp: Int = 100
    var hitFlashTimer: Float = 0f
    var wobbleTime: Float = 0f

    val hitbox: RectF
        get() = RectF(x - width / 2f, groundY - height, x + width / 2f, groundY)

    fun takeDamage(amount: Int): Boolean {
        hp = (hp - amount).coerceAtLeast(0)
        hitFlashTimer = 0.2f
        wobbleTime = 0.4f
        if (hp <= 0) {
            // Respawn after short delay
            hp = maxHp
        }
        return true
    }

    fun update(dt: Float) {
        if (hitFlashTimer > 0) hitFlashTimer -= dt
        if (wobbleTime > 0) wobbleTime -= dt
    }

    fun render(canvas: Canvas, paint: Paint) {
        val wobble = if (wobbleTime > 0) sin(wobbleTime * 30f) * 6f else 0f

        canvas.save()
        canvas.translate(x + wobble, groundY)

        // Shadow
        paint.color = Color.argb(100, 0, 0, 0)
        paint.style = Paint.Style.FILL
        canvas.drawOval(-24f, -4f, 24f, 4f, paint)

        // Body / Post
        paint.color = if (hitFlashTimer > 0) Color.WHITE else Color.rgb(90, 70, 55)
        canvas.drawRect(-8f, -height, 8f, 0f, paint)

        // Training Straw Torso
        paint.color = if (hitFlashTimer > 0) Color.WHITE else Color.rgb(180, 150, 90)
        canvas.drawRect(-18f, -height + 15f, 18f, -20f, paint)

        // Head
        paint.color = if (hitFlashTimer > 0) Color.WHITE else Color.rgb(200, 170, 110)
        canvas.drawCircle(0f, -height + 8f, 12f, paint)

        // Crossbeam (dummy arms)
        paint.color = if (hitFlashTimer > 0) Color.WHITE else Color.rgb(120, 95, 70)
        canvas.drawRect(-26f, -height + 25f, 26f, -height + 31f, paint)

        // Health bar
        val barW = 40f
        val barH = 6f
        val barY = -height - 14f
        paint.color = Color.rgb(40, 40, 40)
        canvas.drawRect(-barW / 2f, barY, barW / 2f, barY + barH, paint)

        val hpRatio = hp.toFloat() / maxHp.toFloat()
        paint.color = Color.rgb(220, 50, 50)
        canvas.drawRect(-barW / 2f + 1f, barY + 1f, -barW / 2f + 1f + (barW - 2f) * hpRatio, barY + barH - 1f, paint)

        canvas.restore()
    }
}
