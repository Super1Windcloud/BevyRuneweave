package io.github.super1windcloud.runeweave.demo

import android.app.Activity
import android.app.NativeActivity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var urlField: EditText
    private lateinit var downloadButton: Button
    private lateinit var launchButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(createContent())
        updateInstalledState()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun createContent(): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            setBackgroundColor(Color.rgb(244, 245, 247))

            addView(TextView(context).apply {
                text = "Bevy RuneWeave"
                textSize = 28f
                setTextColor(Color.rgb(28, 32, 36))
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

            addView(TextView(context).apply {
                text = "Android host"
                textSize = 15f
                setTextColor(Color.rgb(83, 90, 98))
                setPadding(0, dp(4), 0, dp(24))
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

            urlField = EditText(context).apply {
                hint = "HTTPS asset package URL"
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_VARIATION_URI
                setSingleLine(true)
            }
            addView(urlField, ViewGroup.LayoutParams.MATCH_PARENT, dp(56))

            downloadButton = Button(context).apply {
                text = "Download and start"
                setOnClickListener { installFromUrl() }
            }
            addView(downloadButton, ViewGroup.LayoutParams.MATCH_PARENT, dp(52))

            launchButton = Button(context).apply {
                text = "Start installed game"
                setOnClickListener { launchGame() }
            }
            addView(launchButton, ViewGroup.LayoutParams.MATCH_PARENT, dp(52))

            progress = ProgressBar(context).apply { visibility = ProgressBar.GONE }
            addView(progress, dp(48), dp(48))

            status = TextView(context).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                textSize = 14f
                setTextColor(Color.rgb(73, 80, 87))
                setPadding(0, dp(12), 0, 0)
            }
            addView(status, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
    }

    private fun installFromUrl() {
        val rawUrl = urlField.text.toString().trim()
        val url = runCatching { URL(rawUrl) }.getOrNull()
        if (url == null || url.protocol != "https") {
            showError("Enter a valid HTTPS URL")
            return
        }
        setBusy(true, "Downloading package...")
        executor.execute {
            val result = runCatching { downloadAndInstall(url) }
            runOnUiThread {
                setBusy(false, "")
                result.onSuccess { launchGame() }
                    .onFailure { showError(it.message ?: "Installation failed") }
                updateInstalledState()
            }
        }
    }

    private fun downloadAndInstall(url: URL) {
        val staging = File(filesDir, "assets.staging")
        staging.deleteRecursively()
        check(staging.mkdirs()) { "Could not create staging directory" }

        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            check(connection.responseCode in 200..299) {
                "Download failed with HTTP ${connection.responseCode}"
            }
            check(connection.url.protocol == "https") { "Download redirected to a non-HTTPS URL" }
            ZipInputStream(BufferedInputStream(connection.inputStream)).use { archive ->
                extractZip(archive, staging)
            }
            validatePackage(staging)
            replaceInstalledAssets(staging)
        } finally {
            connection.disconnect()
            staging.deleteRecursively()
        }
    }

    private fun extractZip(archive: ZipInputStream, destination: File) {
        val root = destination.canonicalFile
        var entries = 0
        var bytesWritten = 0L
        while (true) {
            val entry = archive.nextEntry ?: break
            check(++entries <= MAX_ENTRIES) { "Archive contains too many entries" }
            val output = File(root, entry.name).canonicalFile
            check(output.path.startsWith(root.path + File.separator)) {
                "Archive entry escapes the asset directory"
            }
            if (entry.isDirectory) {
                check(output.mkdirs() || output.isDirectory) { "Could not create ${entry.name}" }
            } else {
                check(output.parentFile?.mkdirs() != false) { "Could not create ${entry.name}" }
                output.outputStream().buffered().use { stream ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = archive.read(buffer)
                        if (count < 0) break
                        bytesWritten += count
                        check(bytesWritten <= MAX_UNPACKED_BYTES) { "Archive is too large" }
                        stream.write(buffer, 0, count)
                    }
                }
            }
            archive.closeEntry()
        }
        check(entries > 0) { "Asset ZIP is empty" }
    }

    private fun validatePackage(assets: File) {
        val configFile = File(assets, "engineConfig.json")
        check(configFile.isFile) { "engineConfig.json is missing" }
        val config = JSONObject(configFile.readText())
        check(config.optInt("schemaVersion") == 1) { "Unsupported engineConfig schemaVersion" }
        check(config.optString("name").isNotBlank()) { "engineConfig name is empty" }
        check(config.optString("version").isNotBlank()) { "engineConfig version is empty" }
        val script = config.getJSONObject("script")
        val language = script.getString("language")
        check(language in setOf("js", "typescript", "lua")) { "Unsupported script language" }
        val entry = script.getString("entry")
        check(entry.isNotBlank() && !entry.startsWith('/') && !entry.split('/').contains("..")) {
            "script.entry must stay inside assets"
        }
        val extension = File(entry).extension.lowercase()
        check((language == "lua" && extension == "lua") ||
            (language in setOf("js", "typescript") && extension in setOf("js", "mjs"))) {
            "script.language does not match the entry extension"
        }
        check(File(assets, entry).isFile) { "Script entry does not exist: $entry" }
    }

    private fun replaceInstalledAssets(staging: File) {
        val installed = File(filesDir, "assets")
        val backup = File(filesDir, "assets.backup")
        backup.deleteRecursively()
        if (installed.exists()) check(installed.renameTo(backup)) { "Could not preserve installed game" }
        if (!staging.renameTo(installed)) {
            backup.renameTo(installed)
            error("Could not activate downloaded game")
        }
        backup.deleteRecursively()
    }

    private fun launchGame() {
        runCatching { validatePackage(File(filesDir, "assets")) }
            .onFailure {
                showError(it.message ?: "No valid game is installed")
                return
            }
        startActivity(Intent(this, NativeActivity::class.java))
    }

    private fun updateInstalledState() {
        launchButton.isEnabled = runCatching {
            validatePackage(File(filesDir, "assets"))
        }.isSuccess
    }

    private fun setBusy(busy: Boolean, message: String) {
        urlField.isEnabled = !busy
        downloadButton.isEnabled = !busy
        launchButton.isEnabled = !busy && launchButton.isEnabled
        progress.visibility = if (busy) ProgressBar.VISIBLE else ProgressBar.GONE
        status.setTextColor(Color.rgb(73, 80, 87))
        status.text = message
    }

    private fun showError(message: String) {
        status.setTextColor(Color.rgb(176, 39, 45))
        status.text = message
    }

    companion object {
        private const val MAX_ENTRIES = 10_000
        private const val MAX_UNPACKED_BYTES = 256L * 1024L * 1024L
    }
}
