package io.github.dreamtheater484.memora

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

/** The engine lives as long as the app's process, not one window: turning the phone keeps it. */
class MemoraApp : Application() {
    val engine by lazy { Engine(this).also { it.start() } }
}

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var splash: TextView
    private val opened = SystemClock.elapsedRealtime()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val engine = (application as MemoraApp).engine
        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this).apply {
            visibility = View.INVISIBLE
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            webViewClient = object : WebViewClient() {
                // Only Memora's own address opens in the window; other links open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == "127.0.0.1") return false
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (view.visibility != View.VISIBLE && !url.contains("/auth/desktop")) {
                        view.visibility = View.VISIBLE
                        splash.visibility = View.GONE
                        Log.i(Engine.TAG, "trial: page shown ${SystemClock.elapsedRealtime() - opened}ms after the window opened")
                    }
                }
            }
        }
        splash = TextView(this).apply {
            text = "Starting Memora…"
            textSize = 18f
            setTextColor(Color.parseColor("#4f46e5"))
            gravity = Gravity.CENTER
        }
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#f6f6fb"))
            addView(web)
            addView(splash)
            // Android 15 draws apps under the status and navigation bars: Memora keeps clear of
            // them, and of the keyboard. (Older Androids lay the window out around them.)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                setOnApplyWindowInsetsListener { view, insets ->
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                    WindowInsets.CONSUMED
                }
            }
        })
        engine.whenReady { runOnUiThread { web.loadUrl(engine.signInUrl()) } }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }
}
