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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
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

/**
 * The Ashbound main menu.
 *
 * Four layers, back to front, which is the required stack:
 *
 *   1. `main_menu`         the supplied background artwork
 *   2. `main_menu_overlay`  the character, on its own transparent canvas
 *   3. `main_menu_campfire` the campfire, on its own transparent canvas
 *   4. `main_menu_ui`       the title, the supplied button plates, and the sub-screens
 *
 * Every piece of supplied artwork is a full 1280x720 canvas already composed against the
 * background, so nothing is positioned by hand: each canvas is drawn across the same box
 * with `ContentScale.Fit` and the artwork lands where it was drawn. Mirrors
 * web/src/ui/MainMenu.ts.
 */

/** The backdrop artwork. Kept in step with the web engine's copy. */
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
 * The campfire, as its own transparent 1280x720 canvas like the character.
 *
 * Its visible ink sits at x 680..819, immediately left of the character's x 826..999, so
 * the two share no pixel today. The order between them is not incidental, though: the
 * stack is background -> character -> campfire -> buttons, so the campfire draws in
 * front of the character. That ordering is currently invisible; it is stated here so a
 * future revision of either canvas lands on the intended stack.
 */
const val MAIN_MENU_CAMPFIRE_FILE = "main_menu_campfire.png"

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

/** The campfire overlay. Same folder, same canvas size as the backdrop. */
@Composable
fun rememberMenuCampfire(assetFile: String = MAIN_MENU_CAMPFIRE_FILE): ImageBitmap? {
    val context = LocalContext.current
    return remember(assetFile) {
        runCatching {
            context.assets.open("bg/$assetFile").use { stream ->
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
fun MainMenu(modifier: Modifier = Modifier, onAction: (MainMenuAction) -> Unit) {
    var screen by remember { mutableStateOf(MenuScreen.MAIN) }

    Box(modifier = modifier.fillMaxSize().background(Color(0xFF0C0E14))) {
        // --- Layer 1: the supplied artwork ------------------------------------
        Box(Modifier.fillMaxSize().testTag("main_menu")) {
            rememberMenuBackground()?.let { image ->
                Image(
                    bitmap = image,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    // Fit, never Crop: a crop would silently cut off the composition the
                    // artwork was drawn for.
                    contentScale = ContentScale.Fit,
                )
            }
        }

        // --- Layer 2: the character ------------------------------------------
        // Same box and same ContentScale.Fit as the backdrop, so it registers.
        Box(Modifier.fillMaxSize().testTag("main_menu_overlay")) {
            rememberMenuOverlay()?.let { image ->
                Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
        }

        // --- Layer 3: the campfire -------------------------------------------
        Box(Modifier.fillMaxSize().testTag("main_menu_campfire")) {
            rememberMenuCampfire()?.let { image ->
                Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
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
                    SettingRow("MUSIC", "AWAITING AUDIO ASSETS", enabled = false)
                    Spacer(Modifier.height(8.dp))
                    SettingRow("SOUND EFFECTS", "AWAITING AUDIO ASSETS", enabled = false)
                    Spacer(Modifier.height(8.dp))
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
@Composable
private fun ArtButtons(surface: Modifier, canvas: CanvasBox, onPick: (String) -> Unit) {
    Box(surface.testTag("main_menu_art_buttons")) {
        for (art in MENU_BUTTON_ART) {
            rememberMenuButtonArt(art.file)?.let { image ->
                Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
            Box(
                modifier = Modifier
                    .offset(
                        x = (art.x * canvas.scale).dp,
                        y = (art.y * canvas.scale).dp,
                    )
                    .size((art.w * canvas.scale).dp, (art.h * canvas.scale).dp)
                    .semantics { contentDescription = art.label }
                    .clickable { onPick(art.id) }
                    .testTag("main_menu_${art.id}"),
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
