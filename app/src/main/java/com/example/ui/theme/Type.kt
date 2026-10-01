package com.example.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.example.R

/**
 * Pixelta, the supplied UI face, from `res/font/pixelta.ttf`.
 *
 * One weight, because the file ships one. Everything that used to ask for bold or black text
 * now gets synthetic emboldening instead, which is the honest trade for a single-weight
 * pixel font: slightly softer stems in exchange for the face being the intended one. Callers
 * that care should lean on size and letter-spacing, which is what the menu already does.
 *
 * Android resource names cannot start with a capital, which is why the file is `pixelta.ttf`
 * here while the web copy keeps the supplied `Pixelta.ttf`. `FONT_FAMILY_NAME` is the name
 * inside the file and is what has to match on both engines.
 *
 * Built lazily and memoised by Compose, so this costs one resource lookup rather than a font
 * parse per composable.
 */
val Pixelta =
  FontFamily(
    Font(R.font.pixelta, weight = FontWeight.Normal),
    Font(R.font.pixelta, weight = FontWeight.Bold),
    Font(R.font.pixelta, weight = FontWeight.Black),
  )

/** The family name declared inside the font file. Shared with the web build. */
const val FONT_FAMILY_NAME = "Pixelta"

// Set of Material typography styles to start with
val Typography =
  Typography(
    bodyLarge =
      TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
      )
    /* Other default text styles to override
    titleLarge = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp
    )
    */
  )