package io.github.super1windcloud.runeweave.demo

import android.app.NativeActivity
import android.content.Intent
import android.os.Bundle
import android.os.Process

/**
 * The only NativeActivity in the application process. The downloader is brought above this
 * activity when the user selects another package; returning here sends a switch request instead
 * of constructing a second winit event loop.
 */
class RuntimeActivity : NativeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

    private external fun nativeSwitchScript(scriptPath: String): Int

    companion object {
        const val EXTRA_SCRIPT = "io.github.super1windcloud.runeweave.demo.SCRIPT"

        init {
            System.loadLibrary("bevy_runeweave")
        }
    }
}
