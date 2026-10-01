package com.example.game.ui

import android.graphics.BitmapFactory
import androidx.activity.ComponentActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scaleX
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import com.example.game.audio.AUDIO_CLIPS
import com.example.game.audio.AudioEngine
import com.example.game.audio.MAIN_MENU_AMBIENCE
import com.example.game.audio.MAIN_MENU_MUSIC
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min
import kotlin.math.sin

/**
 * The Ashbound main menu.
 *
 * Four layers, back to front, which is the required stack:
 *
 *   1. `main_menu`           the supplied background artwork, untouched
 *   2. `main_menu_character`  the animated character
 *   3. `main_menu_fire`       the animated campfire and its warm light, over the character
 *   4. `main_menu_ui`         the title, the supplied button plates, and the sub-screens
 *
 * The fire is in front of the character because the character is seated beside the fire and
 * the light it throws falls on it.
 *
 * Every piece of supplied artwork is a full 1280x720 canvas already composed against the
 * background, so nothing is positioned by hand: each canvas is drawn across the same box
 * with `ContentScale.Fit` and the artwork lands where it was drawn.
 *
 * Everything is drawn with `ContentScale.Fit`, so the background is always shown whole, at
 * its own size, scaled by a single factor, and nothing is ever cropped or stretched. The
 * composition box the plates, character and fire are registered to is the same rectangle
 * the backdrop's `Fit` occupies, so they register at any screen shape. Mirrors
 * web/src/ui/MainMenu.ts.
 */

/** The backdrop artwork. Kept in step with the web engine's copy. */
/** The corner icon that is a control in its own right, rather than a menu entry. */
private const val CREDITS_ID = "credits"

const val MAIN_MENU_BACKGROUND_FILE = "main_menu.jpg"

/**
 * The character/campfire overlay: a transparent 1280x720 canvas the same size as the
 * backdrop, with the art already positioned inside it.
 *
 * Because it is the same canvas size, drawing it in the same box with the same
 * [ContentScale.Fit] as the backdrop is what makes it register. Mirrors
 * `MAIN_MENU_OVERLAY_FILE` in the web build.
 */
const val MAIN_MENU_OVERLAY_FILE = "main_menu_overlay.png"

/**
 * The animated character: two supplied idle sheets, played one after the other.
 *
 * Each sheet is 1536x96, sixteen 96x96 frames. Both are anchored the way a seated figure
 * should be -- every frame's ink bottoms out on the same row (y=82) while only the upper
 * body moves -- so the character cannot slide and nothing here has to correct for drift
 * the artwork does not have.
 *
 * Only sheet B plays. Sheet A is held on its first frame for three seconds and then the
 * cycle begins, which leaves the figure settled at rest rather than shifting continuously:
 * a knight waiting by a fire sits still, and the motion that reads as life comes from the
 * loop that follows. See CHARACTER_HOLD_FRAMES for why sheet A's first frame is the one
 * worth holding.
 *
 * They are drawn scaled. The sheets carry roughly a 78x72 figure against the static
 * character's 174x161, so drawing them one-to-one would make the character about half the
 * size it is in the composition and it would no longer sit with the background. The factor
 * is derived from those two measurements rather than picked, and it is uniform, so the
 * pixel art keeps its proportions and its hard nearest-neighbour edges.
 *
 * Must match the web engine's numbers exactly, or the two will draw the character in
 * different places: 161 / 71 lines the drawn figure up with the 161px-tall static one.
 */
private const val CHARACTER_STATIC_X = 826
private const val CHARACTER_STATIC_Y = 386
private const val CHARACTER_STATIC_W = 174
private const val CHARACTER_STATIC_H = 161
/** The sheets' ink, as edges rather than pixel indices, so anchoring is arithmetic. */
private const val CHARACTER_SHEET_INK_X0 = 8
private const val CHARACTER_SHEET_INK_X1 = 86
private const val CHARACTER_SHEET_INK_Y0 = 11
private const val CHARACTER_SHEET_INK_Y1 = 83
private const val CHARACTER_FRAMES = 16
private const val CHARACTER_CELL = 96

/**
 * How much smaller than the static figure the animation is drawn. The figure was sitting at
 * the full size of the static composition, which read as looming over the fire rather than
 * sitting beside it. Eighty-two per cent leaves the knight clearly a bystander to the fire
 * rather than the subject of the frame, and this is the last of the three size passes the
 * scene has taken -- the artwork only has so far to go before the figure stops reading as
 * detailed pixel art rather than a smudge.
 *
 * Every other number below is still derived from the artwork, so changing this one rescales
 * the figure about its own base and nothing else has to know.
 */
private const val CHARACTER_SIZE = 0.82f

/**
 * 72 rows of sheet ink become 161 * 0.82 = 132 tall, and 78 columns become 143 against a
 * target of 174 * 0.82 = 143: one uniform factor, so the pixel art keeps its proportions
 * and its hard nearest-neighbour edges.
 */
private const val CHARACTER_SCALE =
    (CHARACTER_STATIC_H * CHARACTER_SIZE).toFloat() /
        (CHARACTER_SHEET_INK_Y1 - CHARACTER_SHEET_INK_Y0).toFloat()

/**
 * Anchored on the figure's centre column and its base row rather than its top left, so
 * changing its size never lifts it off the ground or slides it sideways.
 */
private const val CHARACTER_CELL_X =
    CHARACTER_STATIC_X + CHARACTER_STATIC_W / 2f -
        (CHARACTER_SHEET_INK_X0 + CHARACTER_SHEET_INK_X1) / 2f * CHARACTER_SCALE
private const val CHARACTER_CELL_Y =
    CHARACTER_STATIC_Y + CHARACTER_STATIC_H - CHARACTER_SHEET_INK_Y1 * CHARACTER_SCALE

/**
 * How long the opening pose is held, in frames at CHARACTER_FPS.
 *
 * Sheet A's first frame, not an arbitrary one. Measured off the supplied artwork rather than
 * chosen by eye: it is 1332 pixels from sheet B's frame 0, where the nearest of the other
 * fifteen sheet A frames is 1750 and the furthest is 2176. Holding it hands the cycle off at
 * its closest approach, so the transition into the loop is the least noticeable join in the
 * whole sequence -- and it is the pose the rest pose should be anyway, being the one the
 * sheet departs from. verify-main-menu.mjs re-derives this every run, so the choice cannot
 * quietly stop being the best one if the artwork is ever replaced.
 *
 * Twenty-four frames is three seconds at eight per second. The opening used to be given
 * sixteen steps of sheet A to play through, so the figure was never actually still; this
 * holds instead of stepping, for half a second longer than that pass took.
 */
private const val CHARACTER_HOLD_FRAMES = 24

/**
 * The order the sheets play in, as [sheet, frame] pairs.
 *
 * The opening is sheet A's frame 0, repeated, so it is genuinely a still rather than sixteen
 * near-identical frames of fidgeting. Then sheet B plays forward and back the way it came --
 * 0..15 and then 14..1 -- which is a boomerang: it arrives back at the pose it started from,
 * so the loop can close without the figure snapping. Frame 15 is not repeated at the turn and
 * frame 1 steps into frame 0, so every step through the cycle is a single frame either way.
 */
private val CHARACTER_SEQUENCE: List<Pair<Int, Int>> =
    List(CHARACTER_HOLD_FRAMES) { 0 to 0 } +
        List(CHARACTER_FRAMES) { 1 to it } +
        List(CHARACTER_FRAMES - 2) { 1 to (CHARACTER_FRAMES - 2 - it) }

/**
 * Frames per second, matching the web. The sequence is 54 steps, so at eight the loop takes
 * nearly seven seconds: a settled breathing rather than a fidget.
 */
private const val CHARACTER_FPS = 8

/** The sheets, in the order they play. */
val MAIN_MENU_CHARACTER_FILES = listOf("character_idle_a.png", "character_idle_b.png")

/**
 * The animated campfire.
 *
 * The supplied sheet is a 1024x128 horizontal strip of eight 128x128 cells, measured
 * from the file itself: every frame's ink bottoms out on the same row (y=99) while the top
 * edge moves between y=21 and y=32, so the fire is anchored at its base and only the tip
 * flickers. Each cell carries the whole fire, flame above and the dark log and stone base
 * below, so this replaces the old static fire outright rather than stacking a flame on one
 * that was still underneath.
 *
 * The cell is placed at canvas (686, 455): the ink centres on the old fire's centre x and
 * its base lands on the old fire's base, so the fire stays on the same spot. It is
 * positioned inside the shared canvas box, so it is scaled by the one factor the backdrop
 * is and cannot drift from the background at any viewport or any frame.
 */
const val MAIN_MENU_CAMPFIRE_FLAME_FILE = "campfire_flame.png"

private const val CAMPFIRE_FLAME_FRAMES = 8
private const val CAMPFIRE_FLAME_CELL = 128
/** One flame cell's ink, as edges, measured from the sheet's alpha channel. */
private const val CAMPFIRE_CELL_INK_CENTRE_X = 64f
private const val CAMPFIRE_CELL_INK_BASE_Y = 100f

/** The fire in the supplied canvas: its solid core, with the soft glow excluded. */
private const val CAMPFIRE_SUPPLIED_CENTRE_X = 749.5f
private const val CAMPFIRE_SUPPLIED_BASE_Y = 552f

/**
 * How much bigger the flame is drawn than the sheet's own pixels. The sheet's ink is 104
 * wide and about 74 tall against the supplied fire's 139 by 96, which puts the matching
 * factor at 1.34 on width and 1.30 on height.
 *
 * It is now deliberately over: 104 * 1.46 = 152 and 74 * 1.46 = 108, eleven and twelve per
 * cent past the supplied fire. With the figure drawn smaller beside it, the fire has to carry
 * more of the frame to read as the thing the knight is sitting at rather than a detail of the
 * foreground. Uniform, so the flame keeps its proportions, and FilterQuality.None keeps the
 * scaled edges hard.
 */
private const val CAMPFIRE_FLAME_SCALE = 1.46f

/**
 * Anchored on the fire's centre column and its base row rather than its top left, so
 * scaling the flame up grows it out of the same spot on the ground.
 */
private val CAMPFIRE_FLAME_CELL_X =
    CAMPFIRE_SUPPLIED_CENTRE_X - CAMPFIRE_CELL_INK_CENTRE_X * CAMPFIRE_FLAME_SCALE
private val CAMPFIRE_FLAME_CELL_Y =
    CAMPFIRE_SUPPLIED_BASE_Y - CAMPFIRE_CELL_INK_BASE_Y * CAMPFIRE_FLAME_SCALE

/**
 * Frames per second, matching the web. Slow on purpose: at twelve the eight-frame loop
 * repeats every two thirds of a second, which reads as a fire breathing.
 */
private const val CAMPFIRE_FLAME_FPS = 8

/** The warm light, centred on the fire's ink. Same numbers as the web engine's glow. */
private const val CAMPFIRE_GLOW_CX = 749.5f
private const val CAMPFIRE_GLOW_CY = 515f
private const val CAMPFIRE_GLOW_R = 130f

/** Every supplied canvas is this size, as is the backdrop. */
private const val CANVAS_WIDTH = 1280
private const val CANVAS_HEIGHT = 720

enum class MenuScreen {
    MAIN,
    LOAD,
    SETTINGS,
    QUIT,
    CREDITS,
}

/** What the menu asked the host to do. */
sealed interface MainMenuAction {
    /** START GAME. */
    data object Start : MainMenuAction

    /** QUIT. The host finishes the activity. */
    data object Quit : MainMenuAction
}

/**
 * One supplied button plate.
 *
 * Each entry is its own 1280x720 transparent canvas holding one pre-composed plate, already
 * positioned against the background. [x], [y], [w], [h] are the plate's visible bounds in
 * canvas pixels, measured from the file's alpha channel. The plate itself is positioned by
 * the artwork; these numbers place the clickable area over it.
 */
data class MenuButtonArt(
    val id: String,
    val label: String,
    val file: String,
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
)

private val MENU_BUTTON_ART = listOf(
    MenuButtonArt("start_game", "START GAME", "start_game.png", 83, 130, 332, 113),
    MenuButtonArt("load_game", "LOAD GAME", "load_game.png", 80, 266, 335, 114),
    MenuButtonArt("settings", "SETTINGS", "settings.png", 80, 403, 335, 107),
    MenuButtonArt("quit", "QUIT", "quit.png", 83, 540, 332, 107),
    // Reverses an earlier instruction that ruled credits out: the supplied artwork includes
    // a credits control and the user identified it as such.
    MenuButtonArt("credits", "CREDITS", "credits.png", 1196, 33, 52, 58),
)

/** The four entries, in the order they appear. */
private val MAIN_ENTRIES = listOf(
    "START GAME" to MenuScreen.MAIN,
    "LOAD GAME" to MenuScreen.LOAD,
    "SETTINGS" to MenuScreen.SETTINGS,
    "QUIT" to MenuScreen.QUIT,
)

private val PanelColor = Color(0xE61A1610)
private val BorderDark = Color(0xFF2A1D12)
private val Parchment = Color(0xFFF2E4C4)
private val ParchmentDim = Color(0xFFC9B593)

/** Reads one of the menu artworks out of the assets tree. */
@Composable
fun rememberMenuBackground(assetFile: String = MAIN_MENU_BACKGROUND_FILE): ImageBitmap? {
    val context = LocalContext.current
    return remember(assetFile) {
        runCatching {
            context.assets.open("bg/$assetFile").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

/** The character overlay. Same folder, same canvas size as the backdrop. */
@Composable
fun rememberMenuOverlay(assetFile: String = MAIN_MENU_OVERLAY_FILE): ImageBitmap? {
    val context = LocalContext.current
    return remember(assetFile) {
        runCatching {
            context.assets.open("bg/$assetFile").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

/**
 * The animated flame strip, loaded from the same folder as the supplied plates.
 *
 * Decoded whole rather than frame by frame: it is one 1024x128 sheet, and a single decode
 * keeps every frame on exactly the pixels the artist drew, with no chance of a frame being
 * resampled on its way to the screen.
 */
@Composable
fun rememberMenuCampfireFlame(
    assetFile: String = MAIN_MENU_CAMPFIRE_FLAME_FILE,
): ImageBitmap? {
    val context = LocalContext.current
    return remember(assetFile) {
        runCatching {
            context.assets.open("bg/menu_buttons/$assetFile").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

/**
 * The fire: a warm light, and the animated flame over it.
 *
 * The flame is a one-cell window with the whole strip sliding behind it, which plays a
 * sprite sheet without scaling or cropping a pixel of it. The window is sized and offset
 * inside the shared canvas box, so it carries the same single scale factor as the
 * backdrop and stays registered to the background at every frame.
 */
@Composable
fun MenuFire(surface: Modifier, flame: ImageBitmap?) {
    var frame by remember { mutableIntStateOf(0) }
    var glow by remember { mutableFloatStateOf(0f) }

    // One clock drives both, so the light and the flame stay in step rather than drifting
    // apart. Cancelled with the composition, so a torn-down menu stops asking for frames.
    LaunchedEffect(Unit) {
        val started = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                val seconds = (now - started) / 1_000_000_000f
                frame =
                    ((seconds * CAMPFIRE_FLAME_FPS).toInt().coerceAtLeast(0)) % CAMPFIRE_FLAME_FRAMES
                // A slow breath rather than a strobe, and shallow on purpose.
                glow = 0.62f + 0.38f * (0.5f + 0.5f * sin(seconds * 2.2f))
            }
        }
    }

    Box(surface.testTag("main_menu_fire")) {
        // The warm light. Screen-like lightening is not available the way CSS `screen` is,
        // so this is a plain warm falloff at low alpha, which reads the same at this size.
        Box(
            Modifier
                .offset(
                    x = (CAMPFIRE_GLOW_CX - CAMPFIRE_GLOW_R).dp,
                    y = (CAMPFIRE_GLOW_CY - CAMPFIRE_GLOW_R).dp,
                )
                .size((CAMPFIRE_GLOW_R * 2).dp)
                .alpha(glow)
                .background(
                    Brush.radialGradient(
                        0.0f to Color(0xFFFFB04A).copy(alpha = 0.50f),
                        0.38f to Color(0xFFFF8C28).copy(alpha = 0.24f),
                        0.66f to Color(0xFFD26014).copy(alpha = 0.09f),
                        1.0f to Color(0x00B4460A),
                    ),
                    CircleShape,
                )
                .testTag("main_menu_fire_glow"),
        )

        if (flame != null) {
            Box(
                Modifier
                    .offset(x = CAMPFIRE_FLAME_CELL_X.dp, y = CAMPFIRE_FLAME_CELL_Y.dp)
                    .size((CAMPFIRE_FLAME_CELL * CAMPFIRE_FLAME_SCALE).dp)
                    .clipToBounds()
                    .testTag("main_menu_fire_flame"),
            ) {
                Image(
                    flame,
                    contentDescription = null,
                    modifier = Modifier
                        .size(
                            width = (CAMPFIRE_FLAME_CELL * CAMPFIRE_FLAME_FRAMES * CAMPFIRE_FLAME_SCALE).dp,
                            height = (CAMPFIRE_FLAME_CELL * CAMPFIRE_FLAME_SCALE).dp,
                        )
                        .offset(x = (-frame * CAMPFIRE_FLAME_CELL * CAMPFIRE_FLAME_SCALE).dp),
                    // The window is one cell at the drawing scale and the image exactly the
                    // whole strip at the same scale, so the strip is never resampled; only
                    // the whole fire is scaled, by one factor, uniformly.
                    contentScale = ContentScale.FillBounds,
                    filterQuality = FilterQuality.None,
                )
            }
        }
    }
}

/**
 * The animated character: a one-cell window with each sheet sliding behind it.
 *
 * Both sheets are composed even though only one is visible at a time, so switching between
 * them never shows a window with nothing in it. The inactive one is made transparent rather
 * than dropped from the tree: drawing only the active sheet would leave a frame with no
 * figure in it on the frame the switch happens, and it would also mean the sheet's own
 * measurement pass depended on which one happened to be playing.
 *
 * The window is mirrored. The supplied sheets face away from the fire, while the seated
 * figure in the background sits to the right of it and looks back into the flames;
 * matching the two alpha masks settles it at 0.93 agreement mirrored against 0.59
 * unflipped. The mirror is on the window rather than the strip, because the strip carries
 * all sixteen frames at once and mirroring that would also reverse the order they play in.
 */
@Composable
fun MenuCharacter(surface: Modifier, sheets: List<ImageBitmap?>) {
    var frame by remember { mutableIntStateOf(0) }
    var sheetIndex by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        val started = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                val seconds = (now - started) / 1_000_000_000f
                // coerceAtLeast(0) because Kotlin's % keeps the sign too, and a negative
                // index would walk off the front of the sequence.
                val cursor =
                    ((seconds * CHARACTER_FPS).toInt().coerceAtLeast(0)) % CHARACTER_SEQUENCE.size
                val (sheet, localFrame) = CHARACTER_SEQUENCE[cursor]
                sheetIndex = sheet
                frame = localFrame
            }
        }
    }

    val cellDp = (CHARACTER_CELL * CHARACTER_SCALE).dp
    Box(surface.testTag("main_menu_character")) {
        sheets.forEachIndexed { index, sheet ->
            if (sheet != null) {
                Box(
                    Modifier
                        .offset(
                            x = CHARACTER_CELL_X.dp,
                            y = CHARACTER_CELL_Y.dp,
                        )
                        .size(cellDp)
                        .clipToBounds()
                        .scaleX(-1f)
                        .alpha(if (index == sheetIndex) 1f else 0f)
                        .testTag("main_menu_character_$index"),
                ) {
                    Image(
                        sheet,
                        contentDescription = null,
                        modifier = Modifier
                            .size(
                                width = (CHARACTER_CELL * CHARACTER_FRAMES * CHARACTER_SCALE).dp,
                                height = cellDp,
                            )
                            .offset(x = (-frame * CHARACTER_CELL * CHARACTER_SCALE).dp),
                        contentScale = ContentScale.FillBounds,
                        filterQuality = FilterQuality.None,
                    )
                }
            }
        }
    }
}

/**
 * One character idle sheet, loaded from the same folder as the supplied plates.
 *
 * Decoded whole: it is one 1536x96 image, and a single decode keeps every frame on exactly
 * the pixels the artist drew, with no chance of a frame being resampled on its way in.
 */
@Composable
fun rememberMenuCharacterSheet(file: String): ImageBitmap? {
    val context = LocalContext.current
    return remember(file) {
        runCatching {
            context.assets.open("bg/menu_buttons/$file").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

/** One supplied button plate. */
@Composable
fun rememberMenuButtonArt(file: String): ImageBitmap? {
    val context = LocalContext.current
    return remember(file) {
        runCatching {
            context.assets.open("bg/menu_buttons/$file").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()
    }
}

/**
 * The box a 1280x720 canvas occupies inside the screen, under [ContentScale.Fit].
 *
 * Compose has no `object-fit`, so the letterbox has to be computed rather than assumed:
 * the canvas is scaled by the smaller of the two ratios and centred. Everything placed
 * inside the menu's fourth layer is positioned against this box, not against the raw
 * screen, so the plates and the supplied artwork register with the background on any
 * aspect ratio.
 */
private data class CanvasBox(val scale: Float, val width: Dp, val height: Dp, val offsetX: Dp, val offsetY: Dp)

/**
 * Computes the box inside a [BoxWithConstraints] scope, which is where the measured
 * constraints live. Not its own composable: `BoxWithConstraints`' content lambda is not
 * inline, so a `return` out of it would not compile.
 */
private fun BoxWithConstraintsScope.canvasBox(): CanvasBox {
    val w = maxWidth.value
    val h = maxHeight.value
    val scale = min(w / CANVAS_WIDTH.toFloat(), h / CANVAS_HEIGHT.toFloat())
    val cw = CANVAS_WIDTH * scale
    val ch = CANVAS_HEIGHT * scale
    return CanvasBox(scale, cw.dp, ch.dp, ((w - cw) / 2f).dp, ((h - ch) / 2f).dp)
}

@Composable
fun MainMenu(
    modifier: Modifier = Modifier,
    audio: AudioEngine,
    onAction: (MainMenuAction) -> Unit,
) {
    var screen by remember { mutableStateOf(MenuScreen.MAIN) }

    // The menu owns its own cues and releases them on the way out, so a title track cannot
    // end up playing under the first walk of a new game. Done here rather than at the call
    // site so returning to the title from any route brings the music back with it.
    LaunchedEffect(Unit) {
        audio.start(MAIN_MENU_MUSIC)
        audio.start(MAIN_MENU_AMBIENCE)
    }
    DisposableEffect(Unit) {
        onDispose { audio.stop() }
    }

    Box(modifier = modifier.fillMaxSize().background(Color(0xFF0C0E14))) {
        // --- Layer 1: the supplied artwork ------------------------------------
        Box(Modifier.fillMaxSize().testTag("main_menu")) {
            rememberMenuBackground()?.let { image ->
                Image(
                    bitmap = image,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    // Fit, so the background is always shown whole, at its own size, with one
                    // uniform scale. Crop was tried and reverted: it does fill the frame, but
                    // it cuts the edges off a composition whose controls are painted into its
                    // own left and right thirds.
                    contentScale = ContentScale.Fit,
                )
            }
        }

        // --- Layer 2: the animated character ---------------------------------
        // Drawn in the shared canvas box so it scales by one factor with the backdrop.
        // It replaces the static overlay canvas, which stays in the asset tree unaltered
        // and is simply no longer drawn.
        Box(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val characterCanvas = canvasBox()
                MenuCharacter(
                    Modifier
                        .offset(x = characterCanvas.offsetX, y = characterCanvas.offsetY)
                        .size(characterCanvas.width, characterCanvas.height),
                    MAIN_MENU_CHARACTER_FILES.map { rememberMenuCharacterSheet(it) },
                )
            }
        }

        // --- Layer 3: the campfire and its light -----------------------------
        // In front of the character: the figure is seated beside the fire and the warm
        // light it throws falls across it. Drawn in the shared canvas box like the
        // character, so all three scale by one factor together.
        Box(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val fireCanvas = canvasBox()
                MenuFire(
                    Modifier
                        .offset(x = fireCanvas.offsetX, y = fireCanvas.offsetY)
                        .size(fireCanvas.width, fireCanvas.height),
                    rememberMenuCampfireFlame(),
                )
            }
        }

        // --- Layer 4: the UI -------------------------------------------------
        BoxWithConstraints(Modifier.fillMaxSize().testTag("main_menu_ui")) {
            val canvas = canvasBox()
            val surface = Modifier
                .offset(x = canvas.offsetX, y = canvas.offsetY)
                .size(canvas.width, canvas.height)

            if (screen == MenuScreen.MAIN) {
                MenuTitle(surface)
                ArtButtons(surface, canvas) { id ->
                    when (id) {
                        "start_game" -> onAction(MainMenuAction.Start)
                        "load_game" -> screen = MenuScreen.LOAD
                        "settings" -> screen = MenuScreen.SETTINGS
                        "quit" -> screen = MenuScreen.QUIT
                        "credits" -> screen = MenuScreen.CREDITS
                    }
                }
            }

        }

        // The sub-screens are panels rather than positioned plates, so they live in a
        // sibling of the canvas box rather than inside it.
        Box(Modifier.fillMaxSize().testTag("main_menu_screens")) {
            when (screen) {
                MenuScreen.MAIN -> Unit

                // There is no save system yet, so this says so. An invented slot with a
                // timestamp would be worse than an empty list: a player would load it and
                // have no way to tell the menu had lied.
                MenuScreen.LOAD -> MenuPanel("LOAD GAME") {
                    EmptyState("No saved games")
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Saving has not been implemented yet, so there is nothing to load. " +
                            "Your progress will appear here once it can be kept.",
                        color = ParchmentDim,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(18.dp))
                    BackButton("BACK") { screen = MenuScreen.MAIN }
                }

                MenuScreen.SETTINGS -> MenuPanel("SETTINGS") {
                    // Not a toggle: MainActivity already runs the app edge-to-edge with the
                    // system bars hidden, so a switch here could not change anything. Shown
                    // disabled and truthful rather than wired to nothing.
                    // Real switches, not placeholders. They are live with no audio files
                    // present: a player who turns sound off before the assets are added
                    // should find it still off afterwards, and a switch that cannot be
                    // pressed is worse than one that changes nothing yet.
                    AudioToggleRow("MUSIC", audio.isMusicEnabled, { audio.setMusicEnabled(it) })
                    Spacer(Modifier.height(8.dp))
                    AudioToggleRow("SOUND EFFECTS", audio.isSfxEnabled, { audio.setSfxEnabled(it) })
                    Spacer(Modifier.height(8.dp))
                    // Said plainly, because a switch reading ON while nothing can be heard
                    // is a small lie and the screen would otherwise look finished.
                    val found = audio.inventory()
                    if (found.loaded.size < AUDIO_CLIPS.size) {
                        SettingRow(
                            "AUDIO FILES",
                            if (found.loaded.isEmpty()) "NONE INSTALLED YET"
                            else "${found.loaded.size} OF ${AUDIO_CLIPS.size} PRESENT",
                            enabled = false,
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    SettingRow("FULLSCREEN", "ALWAYS ON (IMMERSIVE)", enabled = false)
                    Spacer(Modifier.height(18.dp))
                    BackButton("BACK") { screen = MenuScreen.MAIN }
                }

                // Android really can leave, so the host is asked to. The web build returns
                // to the title instead, because a tab cannot close itself.
                MenuScreen.QUIT -> MenuPanel("THANKS FOR PLAYING") {
                    Text(
                        "Leaving Ashbound.",
                        color = ParchmentDim,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(18.dp))
                    BackButton("BACK TO TITLE") {
                        screen = MenuScreen.MAIN
                        onAction(MainMenuAction.Quit)
                    }
                }

                MenuScreen.CREDITS -> MenuPanel("CREDITS") {
                    Text(
                        "Ashbound is built on the Exiled Knight engine. Artwork supplied " +
                            "directly by the project.",
                        color = ParchmentDim,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(18.dp))
                    BackButton("BACK") { screen = MenuScreen.MAIN }
                }
            }
        }
    }
}

/**
 * The title, above the first plate.
 *
 * The plates start at y=130, so the title sits above them and is aligned to their left
 * edge at x=83. No panel behind it: the supplied art already provides the background, and
 * a panel would be a second one on top of the first.
 */
@Composable
private fun MenuTitle(surface: Modifier) {
    Column(
        horizontalAlignment = Alignment.Start,
        modifier = surface
            .offset(x = 83.dp, y = 34.dp)
            .width(334.dp)
            .testTag("main_menu_title"),
    ) {
        Text(
            "ASHBOUND",
            color = Parchment,
            fontSize = 34.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 4.sp,
        )
        Spacer(Modifier.height(2.dp))
        Text("A knight without a kingdom", color = ParchmentDim, fontSize = 11.sp)
    }
}

/**
 * The supplied plates, with a clickable area over each.
 *
 * The plate is a full-canvas image, so it is drawn across the whole surface; the clickable
 * area is then placed over the plate's measured bounds, scaled by the canvas factor. The
 * artwork carries its own label, so nothing is drawn on top of it -- the label lives on the
 * node's content description, which is what a screen reader would otherwise be missing.
 */
/** One clickable area: a supplied plate, scaled, plus whatever growth it needs to stay hittable. */
private data class HitTarget(
    val art: MenuButtonArt,
    val left: Dp,
    val top: Dp,
    val width: Dp,
    val height: Dp,
)

/** The four entries that share the column, in the order they are stacked. */
private val STACKED_IDS = setOf("start_game", "load_game", "settings", "quit")

/**
 * Builds the clickable areas for the supplied plates.
 *
 * A 1280x720 composition letterboxed into a tall portrait phone scales to roughly a
 * quarter of its intended size, and a proportionally correct target is then far too
 * small to hit: the credits control comes out around 15dp across, against a 48dp minimum
 * comfortable touch target, so a press misses it almost every time. That reads as "the
 * button does not work" even though it is wired correctly.
 *
 * So each area grows to at least [minTouch]. The artwork is untouched -- only the
 * invisible hit area changes -- and the four stacked entries may only grow as far as the
 * midpoint to their neighbours, because growing freely would make one target start
 * swallowing the taps meant for the next.
 */
@Composable
private fun ArtButtons(surface: Modifier, canvas: CanvasBox, onPick: (String) -> Unit) {
    val minTouch = 48.dp
    val scaled = MENU_BUTTON_ART.map { art ->
        HitTarget(
            art = art,
            left = (art.x * canvas.scale).dp,
            top = (art.y * canvas.scale).dp,
            width = (art.w * canvas.scale).dp,
            height = (art.h * canvas.scale).dp,
        )
    }
    val stacked = scaled.filter { it.art.id in STACKED_IDS }.sortedBy { it.top }

    Box(surface.testTag("main_menu_art_buttons")) {
        for (art in MENU_BUTTON_ART) {
            // The credits control is drawn on its own below, as a window onto its own plate.
            if (art.id == CREDITS_ID) continue
            rememberMenuButtonArt(art.file)?.let { image ->
                Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
            val target = scaled.first { it.art.id == art.id }
            val index = stacked.indexOfFirst { it.art.id == art.id }

            // Stacked entries are bounded by their neighbours; everything else, such as the
            // credits control in the corner, is free to grow.
            val width = maxOf(target.width, minTouch)
            val (top, height) = if (index >= 0) {
                val bandTop = if (index == 0) 0.dp else stacked[index - 1].top + stacked[index - 1].height
                val next = stacked.getOrNull(index + 1)
                val bandBottom = next?.top ?: canvas.height
                val h = minOf(maxOf(target.height, minTouch), bandBottom - bandTop)
                // Centred on the plate, then clamped inside the band so neighbours cannot meet.
                val t = (target.top + target.height / 2f - h / 2f).coerceIn(bandTop, bandBottom - h)
                t to h
            } else {
                val h = maxOf(target.height, minTouch)
                (target.top + target.height / 2f - h / 2f) to h
            }

            // Keep the grown target on the frame. The credits control sits in the corner,
            // so its minimum size would otherwise push it off the right edge or off the top.
            val clampedWidth = width.coerceAtMost(canvas.width)
            val left = target.left.coerceIn(0.dp, canvas.width - clampedWidth)
            val maxTop = (canvas.height - height).coerceAtLeast(0.dp)
            val clampedTop = top.coerceIn(0.dp, maxTop)

            Box(
                modifier = Modifier
                    .offset(x = left, y = clampedTop)
                    .size(clampedWidth, height)
                    .semantics { contentDescription = art.label }
                    .clickable { onPick(art.id) }
                    .testTag("main_menu_${art.id}"),
            )
        }

        CreditsControl(surface, canvas, scaled, onPick)
    }
}

/**
 * The credits control: the supplied artwork *is* the control.
 *
 * Every other plate is a full 1280x720 canvas whose ink is a band on the left of the
 * picture, which is fine for a control the size of a menu entry. The credits control is a
 * small icon hard against the top-right corner, and drawn the same way it is a 1280x720
 * sheet of which about fifty pixels are ever visible -- a hit area covering all of it, with
 * the button somewhere inside. So it is drawn the way the character and the flame already
 * are: the button is a window, the canvas is slid behind it, and the clip is what leaves
 * only the plate showing. The artwork therefore arrives at the canvas scale, untouched.
 *
 * The window grows to the same 48dp minimum as every other control and is clamped inside
 * the canvas, because a 48dp target centred on a plate that close to the corner would
 * otherwise hang off the top and the right.
 */
@Composable
private fun CreditsControl(
    surface: Modifier,
    canvas: CanvasBox,
    scaled: List<HitTarget>,
    onPick: (String) -> Unit,
) {
    val art = MENU_BUTTON_ART.first { it.id == CREDITS_ID }
    val target = scaled.first { it.art.id == CREDITS_ID }
    val minTouch = 48.dp
    val width = minOf(maxOf(target.width, minTouch), canvas.width)
    val height = minOf(maxOf(target.height, minTouch), canvas.height)
    val left = (target.left + target.width / 2f - width / 2f).coerceIn(0.dp, canvas.width - width)
    val top = (target.top + target.height / 2f - height / 2f).coerceIn(0.dp, canvas.height - height)

    Box(
        modifier = surface
            .offset(x = left, y = top)
            .size(width, height)
            .clipToBounds()
            .semantics { contentDescription = art.label }
            .clickable { onPick(art.id) }
            .testTag("main_menu_$CREDITS_ID"),
    ) {
        rememberMenuButtonArt(art.file)?.let { image ->
            // Placed so the plate's own centre lands on the window's centre, which keeps the
            // artwork on the plate however far the window had to grow or be clamped.
            Image(
                bitmap = image,
                contentDescription = null,
                modifier = Modifier
                    .offset(
                        x = width / 2f - (art.x + art.w / 2f) * canvas.scale.dp,
                        y = height / 2f - (art.y + art.h / 2f) * canvas.scale.dp,
                    )
                    .size(canvas.width, canvas.height),
                contentScale = ContentScale.Fit,
            )
        }
    }
}

@Composable
private fun MenuPanel(heading: String, content: @Composable () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .padding(28.dp)
            .testTag("main_menu_panel"),
        verticalArrangement = Arrangement.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth(0.44f)
                .background(PanelColor)
                .border(2.dp, BorderDark)
                .padding(24.dp),
        ) {
            Text(
                heading,
                color = Parchment,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            )
            Spacer(Modifier.height(20.dp))
            content()
        }
    }
}

@Composable
private fun EmptyState(text: String) {
    Text(
        text,
        color = ParchmentDim,
        fontSize = 15.sp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 20.dp),
        textAlign = TextAlign.Center,
    )
}

/**
 * One settings row.
 *
 * A control with nothing behind it is dimmed and tagged `menu-setting-disabled` rather
 * than being left out, so the screen reads as a settings screen that is not finished yet
 * instead of an empty box -- and, more importantly, so a row that cannot be used does not
 * look identical to one that can.
 */
/**
 * An on/off switch bound to a piece of the audio bank.
 *
 * Painted from the engine's own state on every click rather than from a local boolean, so
 * the label cannot drift from what the mixer is actually doing.
 */
@Composable
private fun AudioToggleRow(label: String, isOn: () -> Boolean, setOn: (Boolean) -> Unit) {
    var enabled by remember { mutableStateOf(isOn()) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xB33C2C1E))
            .clickable {
                setOn(!isOn())
                enabled = isOn()
            }
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("menu-setting"),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = Parchment,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp,
        )
        Text(
            if (enabled) "ON" else "OFF",
            color = ParchmentDim,
            fontSize = 12.sp,
            letterSpacing = 1.sp,
        )
    }
}

@Composable
private fun SettingRow(label: String, value: String, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (enabled) Color(0xB33C2C1E) else Color(0x733C2C1E))
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .then(if (enabled) Modifier else Modifier.alpha(0.5f))
            .testTag("menu-setting" + if (enabled) "" else " menu-setting-disabled"),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = if (enabled) Parchment else ParchmentDim,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp,
        )
        Text(value, color = ParchmentDim, fontSize = 12.sp, letterSpacing = 1.sp)
    }
}

@Composable
private fun BackButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .width(220.dp)
            .height(48.dp)
            .testTag("main_menu_back"),
        shape = RoundedCornerShape(0.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Color(0x99241B13),
            contentColor = Parchment,
        ),
    ) {
        Text(label, fontSize = 13.sp, letterSpacing = 2.sp)
    }
}

/**
 * Leaves the app for real.
 *
 * `finish()` is the correct call: it unwinds the activity properly, so Android can reclaim
 * its window and any Compose state is disposed as usual. `exitProcess` is only a backstop
 * for the case where there is no activity to finish -- which should not happen in normal
 * use, but a QUIT button that does nothing is worse than a blunt one.
 */
internal fun android.content.Context.quitApp() {
    var finished = false
    var current: android.content.Context? = this
    while (current != null) {
        if (current is ComponentActivity) {
            current.finish()
            finished = true
            break
        }
        current = current.baseContext?.takeIf { it !== current }
    }
    if (!finished) kotlin.system.exitProcess(0)
}

/** The four entry labels, as the host sees them. */
val MAIN_MENU_LABELS: List<String> = MAIN_ENTRIES.map { it.first }
