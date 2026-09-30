package com.example.game.model

import android.graphics.RectF

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
