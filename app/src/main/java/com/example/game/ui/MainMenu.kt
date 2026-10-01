package com.example.game.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The Ashbound main menu.
 *
 * Three things stack here and it matters that they stay three things:
 *
 *   1. `main_menu`        the supplied background artwork
 *   2. `main_menu_overlay` the character/campfire artwork, on its own transparent canvas
 *   3. `main_menu_ui`      the title, the entries, and the sub-screens
 *
 * Keeping the artwork out of the UI layer is what lets the art stay exactly as supplied.
 * Mirrors web/src/ui/MainMenu.ts.
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

enum class MenuScreen {
    MAIN,
    LOAD,
    SETTINGS,
    QUIT,
}

/** What the menu asked the host to do. */
sealed interface MainMenuAction {
    /** START GAME. */
    data object Start : MainMenuAction

    /** QUIT. The host finishes the activity. */
    data object Quit : MainMenuAction
}

/** The four entries, in the order they appear. Mirrors the web build's MAIN_ENTRIES. */
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

/** The character/campfire overlay. Same folder, same canvas size as the backdrop. */
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

@Composable
fun MainMenu(modifier: Modifier = Modifier, onAction: (MainMenuAction) -> Unit) {
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

        // --- Layer 2: the character / campfire overlay -------------------------
        // Same box and same ContentScale.Fit as the backdrop, so the two register.
        Box(Modifier.fillMaxSize().testTag("main_menu_overlay")) {
            rememberMenuOverlay()?.let { image ->
                Image(
                    bitmap = image,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
            }
        }

        // --- Layer 3: the UI --------------------------------------------------
        MenuUi(onAction)
    }
}

@Composable
private fun MenuUi(onAction: (MainMenuAction) -> Unit) {
    var screen by remember { mutableStateOf(MenuScreen.MAIN) }

    // Pinned to the left, not centred, to match the web build. The overlay's visible art
    // occupies roughly x 826..1000 of the 1280-wide canvas -- right of centre -- so a
    // centred panel of any useful width would hide part of the character.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(start = 40.dp)
            .testTag("main_menu_ui"),
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.Center,
    ) {
        when (screen) {
            MenuScreen.MAIN -> MenuTitle {
                when (it) {
                    MenuScreen.MAIN -> onAction(MainMenuAction.Start)
                    MenuScreen.LOAD -> screen = MenuScreen.LOAD
                    MenuScreen.SETTINGS -> screen = MenuScreen.SETTINGS
                    MenuScreen.QUIT -> screen = MenuScreen.QUIT
                }
            }

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
                SettingRow("MUSIC", "AWAITING AUDIO ASSETS", enabled = false)
                Spacer(Modifier.height(8.dp))
                SettingRow("SOUND EFFECTS", "AWAITING AUDIO ASSETS", enabled = false)
                Spacer(Modifier.height(8.dp))
                // Not a toggle: MainActivity already runs the app edge-to-edge with the
                // system bars hidden, so a switch here could not change anything. Shown
                // disabled and truthful rather than wired to nothing.
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
        }
    }
}

@Composable
private fun MenuTitle(onPick: (MenuScreen) -> Unit) {
    Column(
        horizontalAlignment = Alignment.Start,
        modifier = Modifier
            .fillMaxWidth(0.62f)
            .testTag("main_menu_title"),
    ) {
        Text(
            "ASHBOUND",
            color = Parchment,
            fontSize = 44.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 9.sp,
        )
        Spacer(Modifier.height(6.dp))
        Text("A knight without a kingdom", color = ParchmentDim, fontSize = 13.sp)
        Spacer(Modifier.height(26.dp))
        MAIN_ENTRIES.forEach { (label, target) ->
            MenuButton(label) { onPick(target) }
            Spacer(Modifier.height(10.dp))
        }
    }
}

/**
 * The four entries, as the host sees them. Declared so the parity check can compare
 * the labels against the web build without parsing Compose code.
 */
val MAIN_MENU_LABELS: List<String> = MAIN_ENTRIES.map { it.first }

@Composable
private fun MenuPanel(heading: String, content: @Composable () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .testTag("main_menu_panel")
            .fillMaxWidth(0.86f)
            .padding(24.dp)
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

@Composable
/**
 * One settings row.
 *
 * A control with nothing behind it is dimmed and tagged `menu-setting-disabled` rather
 * than being left out, so the screen reads as a settings screen that is not finished
 * yet instead of an empty box -- and, more importantly, so a row that cannot be used
 * does not look identical to one that can.
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
private fun MenuButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .testTag("main_menu_$label"),
        shape = RoundedCornerShape(0.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Color(0xFF3C2C1E),
            contentColor = Parchment,
        ),
    ) {
        Text(
            label,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 3.sp,
        )
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
