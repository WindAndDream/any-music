package com.anymusic.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safeTypes = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val safe = insets.getInsets(safeTypes)
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      // Native padding already handles these areas; forward zeroes so WebView clears its CSS insets.
      // Keep other insets, including IME, flowing so keyboard viewport updates still reach the page.
      WindowInsetsCompat.Builder(insets)
        .setInsets(safeTypes, Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
