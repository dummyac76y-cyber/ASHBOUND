package com.example.game.model

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import com.example.game.animation.SpriteMetrics
import com.example.game.engine.NPC_ART_FACES_RIGHT
import com.example.game.engine.NPC_BASELINE_Y
import com.example.game.engine.NPC_CELL_SIZE
import com.example.game.engine.NPC_CLIPS
import com.example.game.engine.NPC_IDLE_FPS
import com.example.game.engine.NPC_IDLE_WALK_SHEET
import com.example.game.engine.NPC_NEAREST_NEIGHBOR
import com.example.game.engine.NPC_VISIBLE_SCALE
import com.example.game.engine.NPC_WALK_FPS
import com.example.game.engine.NpcClip
import com.example.game.engine.emptyClip
import kotlin.math.sin

/**
 * The world character that stands where the old placeholder did.
 *
 * Lives in world space like everything else in a scene: it holds a world X, is drawn
 * through the same camera transform as the backdrop and the player, and so crosses
 * the screen only when the camera scrolls. Nothing here is in screen space.
 *
 * The sprite is the supplied 12-frame sheet, drawn unmodified at the player's own
 * display size, with the visible feet sitting on the scene's floor plane via the
 * measured baseline rather than by shifting any frame.
 *
 * Mirrors Npc.ts.
 */
class Npc(
    var x: Float,
    var groundY: Float,
    /** Side of the torso a sword can reach, in world units. */
    val width: Float = 56f,
    /** How tall the body stands off the floor, in world units. */
    val height: Float = 68f
) {
    var maxHp: Int = 100
    var hp: Int = 100
    var hitFlashTimer: Float = 0f
    var wobbleTime: Float = 0f

    /** Current motion, and which direction the NPC is looking. */
    var state: String = STATE_IDLE
        private set
    /**
     * Which way the NPC is looking, and so which way it travels while walking.
     *
     * Starts on the direction the artwork natively faces, so the NPC is drawn
     * un-flipped at rest.
     */
    var facingRight: Boolean = NPC_ART_FACES_RIGHT

    /**
     * Whether the sprite must be mirrored for the NPC to look the way it is moving.
     *
     * A left-facing sheet is drawn as supplied while travelling left and mirrored
     * while travelling right. Mirrors `Npc.flipX` in the web engine.
     */
    val flipX: Boolean
        get() = if (NPC_ART_FACES_RIGHT) !facingRight else facingRight

    /** Index of the frame being drawn within its clip. */
    var currentFrame: Int = 0
        private set

    /** Seconds the current state has been running, used to drive the frame. */
    private var stateElapsed: Float = 0f

    /** Seconds still to stand still for. */
    private var idleRemaining: Float = NPC_IDLE_SECONDS

    /** Left and right limits of the patrol, in world units. */
    val patrolLeft: Float = x - NPC_PATROL_REACH
    val patrolRight: Float = x + NPC_PATROL_REACH

    /**
     * The decoded walk sheet, or null while it is still loading. Null draws the NPC's
     * ground shadow and HP bar only, so a missing asset shows an empty stand rather
     * than nothing at all.
     */
    var sprite: Bitmap? = null

    val hitbox: RectF
        get() = RectF(x - width / 2f, groundY - height, x + width / 2f, groundY)

    /** True while the NPC is on the move, which is what a facing flip follows. */
    val isWalking: Boolean get() = state == STATE_WALK

    /** Frame rate the running clip plays at. */
    val fps: Int get() = if (state == STATE_WALK) NPC_WALK_FPS else NPC_IDLE_FPS

    fun takeDamage(amount: Int): Boolean {
        hp = (hp - amount).coerceAtLeast(0)
        hitFlashTimer = 0.2f
        wobbleTime = 0.4f
        if (hp <= 0) {
            hp = maxHp
        }
        return true
    }

    /**
     * Advances the patrol and the animation.
     *
     * The loop is: stand, walk to the patrol limit, turn round, stand, walk back.
     *
     * Turning happens on reaching a limit rather than on wrapping, so the NPC never
     * reverses while out in the open. `facingRight` is written in exactly one place,
     * [turnAround], and that also drops the NPC back to `idle` -- so a change of
     * direction and a change of facing are the same event, and the NPC is always
     * standing still while it turns. That is what stops it ever taking a step with the
     * sprite pointing the other way, which is what reads as walking backwards.
     */
    fun update(dt: Float) {
        if (hitFlashTimer > 0) hitFlashTimer -= dt
        if (wobbleTime > 0) wobbleTime -= dt

        if (state == STATE_IDLE) {
            idleRemaining -= dt
            if (idleRemaining <= 0f) {
                state = STATE_WALK
                stateElapsed = 0f
            }
        } else {
            val next = x + (if (facingRight) 1f else -1f) * NPC_WALK_SPEED * dt
            if (facingRight && next >= patrolRight) {
                x = patrolRight
                turnAround()
            } else if (!facingRight && next <= patrolLeft) {
                x = patrolLeft
                turnAround()
            } else {
                x = next
            }
        }

        stateElapsed += dt
        currentFrame = frameForElapsed(stateElapsed)
    }

    /**
     * Reaches a patrol limit: stop, face the other way, and stand for a while.
     *
     * The order matters and is the whole point of the method: the NPC is switched to
     * `idle` as it turns, and it spends the next [NPC_IDLE_SECONDS] standing still
     * before `update` will let it walk again. The new direction is therefore both
     * chosen and visibly adopted before the first step is taken in it, so the sprite
     * never leads or trails the movement.
     *
     * Standing after a turn also stops the sprite from snapping to a mirrored walk
     * mid-stride, where a leg that was mid-swing would read as the wrong one leading.
     */
    private fun turnAround() {
        facingRight = !facingRight
        state = STATE_IDLE
        idleRemaining = NPC_IDLE_SECONDS
        stateElapsed = 0f
    }

    /**
     * Frame to draw for a given elapsed time in the current state.
     *
     * Split out from [update] so the frame maths can be tested without also moving the
     * NPC around the world.
     */
    fun frameForElapsed(elapsed: Float): Int {
        val clip = clip
        if (clip.frameCount <= 1) return 0
        val raw = (elapsed * clip.fps).toInt()
        return clip.firstFrame + (raw % clip.frameCount)
    }

    /** The clip the current state plays. */
    private val clip: NpcClip
        get() = NPC_CLIPS.firstOrNull { it.name == state } ?: emptyClip(STATE_IDLE, NPC_IDLE_FPS)

    /**
     * Height of the sprite's drawn box above the floor, in world units.
     *
     * The cell is drawn square at the player's display size, then dropped by the
     * measured baseline offset so the visible feet -- not the cell's transparent
     * lower edge -- land on the floor.
     */
    private fun spriteTop(display: Float): Float =
        -(display - SpriteMetrics.footOffsetForRow(NPC_BASELINE_Y, display, NPC_CELL_SIZE.toFloat()))

    /** Draws the NPC in world space. The canvas is already camera-translated. */
    fun render(canvas: Canvas, paint: Paint) {
        val wobble = if (wobbleTime > 0f) sin(wobbleTime * 30f) * 4f else 0f
        val display = NPC_DRAWN_SIZE

        canvas.save()
        canvas.translate(x + wobble, groundY)

        // Ground shadow, seated on the floor line like the player's.
        paint.color = Color.argb(82, 0, 0, 0)
        paint.style = Paint.Style.FILL
        canvas.drawOval(-22f, -4f, 22f, 4f, paint)

        renderSprite(canvas, paint, display)

        // Health bar, kept above the head. spriteTop() is already measured upward from
        // the floor, so the bar sits a little further up again.
        val barW = 44f
        val barH = 6f
        val barY = spriteTop(display) - 10f
        paint.color = Color.rgb(40, 40, 40)
        canvas.drawRect(-barW / 2f, barY, barW / 2f, barY + barH, paint)

        val hpRatio = hp.toFloat() / maxHp.toFloat()
        paint.color = Color.rgb(220, 50, 50)
        canvas.drawRect(
            -barW / 2f + 1f, barY + 1f,
            -barW / 2f + 1f + (barW - 2f) * hpRatio, barY + barH - 1f, paint
        )

        canvas.restore()
    }

    /** Draws the current frame of the sheet, if it has loaded. */
    private fun renderSprite(canvas: Canvas, paint: Paint, display: Float) {
        val sheet = sprite ?: return
        val cell = NPC_CELL_SIZE
        val footOffset = SpriteMetrics.footOffsetForRow(NPC_BASELINE_Y, display, cell.toFloat())
        val bottom = footOffset
        val top = bottom - display
        val left = -display / 2f
        val spritePaint = if (NPC_NEAREST_NEIGHBOR) {
            // Pin nearest-neighbour for this draw regardless of the caller's paint, so
            // the NPC cannot be softened by a filtered paint passed in.
            Paint(paint).apply {
                isFilterBitmap = false
                isDither = false
                isAntiAlias = false
            }
        } else {
            paint
        }

        canvas.save()
        // Turning round mirrors the sheet about the NPC's own centre. Only ever a
        // horizontal flip -- never a rotation, and never a vertical one, which would
        // stand the figure on its head.
        if (flipX) canvas.scale(-1f, 1f, 0f, 0f)
        canvas.drawBitmap(
            sheet,
            null,
            RectF(left, top, left + display, top + display),
            spritePaint
        )
        canvas.restore()
    }

    companion object {
        const val STATE_IDLE = "idle"
        const val STATE_WALK = "walk"

        /** Seconds the NPC stands still before setting off again. */
        const val NPC_IDLE_SECONDS = 2.5f

        /** Walking speed in world units per second. Deliberately unhurried. */
        const val NPC_WALK_SPEED = 26f

        /**
         * How far either side of its starting post the NPC is allowed to roam, in
         * world units. A short patrol: far enough to read as walking, not enough to
         * wander out of the fight or off the drawn floor.
         */
        const val NPC_PATROL_REACH = 40f

        /**
         * Logical size a 128px sprite cell is drawn at, matching the player.
         *
         * The world's own `SPRITE_DISPLAY_SIZE` is asserted to be this same number by
         * the verification suite, so the two characters stay the same size without
         * either reaching into the other.
         */
        const val NPC_SPRITE_DISPLAY_SIZE = 100f

        /**
         * The size the NPC's cell is actually drawn at: the shared basis scaled up so
         * its visible height matches the player's.
         *
         * Every part of the NPC that draws against a size uses this, so the sprite,
         * the foot offset that grounds it and the HP bar above its head stay
         * consistent. Mirrors `NPC_DRAWN_SIZE` in the web engine.
         */
        const val NPC_DRAWN_SIZE = NPC_SPRITE_DISPLAY_SIZE * NPC_VISIBLE_SCALE

        /** File the walk sheet is loaded from, as declared in NpcAssets.kt. */
        const val SPRITE_FILE = NPC_IDLE_WALK_SHEET.file
    }
}
