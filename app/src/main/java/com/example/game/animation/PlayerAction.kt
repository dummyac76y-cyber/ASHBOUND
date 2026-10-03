package com.example.game.animation

/**
 * All actions and states available to the player character.
 * This enumeration can easily be extended with new actions without rewriting
 * the animation system or player controller.
 */
enum class PlayerAction(val displayName: String) {
    IDLE("Idle"),

    /**
     * The occasional fidget while standing still.
     *
     * Not a locomotion state: it is the idle pose with something extra on top, and it must give
     * way the instant the player moves or acts. Separate from IDLE rather than an extra IDLE
     * variant because it has its own sheet, and a variant of a sheet the player sees every
     * other second cannot be expressed as more frames of that sheet.
     */
    IDLE_VARIANT("Idle Variant"),
    WALK("Walk"),
    ATTACK("Attack"),
    HEAVY_ATTACK("Heavy Attack"),
    BLOCK("Block"),
    DASH("Dash"),
    JUMP("Jump"),
    HURT("Hurt"),
    DEATH("Death")
}
