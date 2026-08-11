package io.github.super1windcloud.runeweave.demo

import android.app.NativeActivity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager

/**
 * The only NativeActivity in the application process. The downloader is brought above this
 * activity when the user selects another package; returning here sends a switch request instead
 * of constructing a second winit event loop.
 */
class RuntimeActivity : NativeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        switchFromIntent(intent)
    }

    override fun onBackPressed() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        )
    }

    override fun onDestroy() {
        val finishing = isFinishing
        super.onDestroy()
        if (finishing) {
            // Do not leave a process with a consumed winit EventLoop behind.
            Process.killProcess(Process.myPid())
        }
    }

    private fun switchFromIntent(intent: Intent?) {
        val script = intent?.getStringExtra(EXTRA_SCRIPT) ?: return
        check(nativeSwitchScript(script) == 0) { "Could not switch runtime script" }
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    private external fun nativeSwitchScript(scriptPath: String): Int

    companion object {
        const val EXTRA_SCRIPT = "io.github.super1windcloud.runeweave.demo.SCRIPT"

        init {
            System.loadLibrary("bevy_runeweave")
        }
    }
}
