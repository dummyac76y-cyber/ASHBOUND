package com.example.game.animation

/**
 * All actions and states available to the player character.
 * This enumeration can easily be extended with new actions without rewriting
 * the animation system or player controller.
 */
enum class PlayerAction(val displayName: String) {
    IDLE("Idle"),
    WALK("Walk"),
    ATTACK("Attack"),
    HEAVY_ATTACK("Heavy Attack"),
    BLOCK("Block"),
    DASH("Dash"),
    JUMP("Jump"),
    HURT("Hurt"),
    DEATH("Death")
}
