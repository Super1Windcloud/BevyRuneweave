package io.github.super1windcloud.runeweave.demo

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val primaryLabels = mutableListOf<TextView>()
    private val secondaryLabels = mutableListOf<TextView>()
    private val themedButtons = mutableListOf<Button>()
    private lateinit var urlField: EditText
    private lateinit var downloadButton: Button
    private lateinit var launchButton: Button
    private val remoteAssetButtons = mutableListOf<Button>()
    private lateinit var remoteAssetsContainer: LinearLayout
    private lateinit var remoteAssetsStatus: TextView
    private lateinit var progress: ProgressBar
    private lateinit var status: TextView
    private lateinit var rootView: LinearLayout
    private lateinit var homePage: View
    private lateinit var settingsPage: View
    private lateinit var settingsRow: LinearLayout
    private lateinit var bottomNavigation: LinearLayout
    private lateinit var homeNavigation: TextView
    private lateinit var settingsNavigation: TextView
    private var darkMode = false
    private var selectedPage = Page.HOME
    private var statusIsError = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureEdgeToEdgeLayout()
        darkMode = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getBoolean(DARK_MODE, false)
        setContentView(createContent())
        applyBottomNavigationInsets()
        applyTheme()
        updateInstalledState()
        loadRemoteAssets()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun createContent(): View {
        rootView = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val pages = FrameLayout(this)
        rootView.addView(pages, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f,
        ))

        homePage = ScrollView(this).apply {
            isFillViewport = true
            addView(createHomeContent())
        }
        settingsPage = ScrollView(this).apply {
            isFillViewport = true
            visibility = View.GONE
            addView(createSettingsContent())
        }
        pages.addView(homePage, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))
        pages.addView(settingsPage, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        bottomNavigation = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        homeNavigation = navigationItem("Home", android.R.drawable.ic_menu_view, Page.HOME)
        settingsNavigation = navigationItem(
            "Settings",
            android.R.drawable.ic_menu_preferences,
            Page.SETTINGS,
        )
        bottomNavigation.addView(
            homeNavigation,
            LinearLayout.LayoutParams(0, dp(BOTTOM_NAVIGATION_HEIGHT_DP), 1f),
        )
        bottomNavigation.addView(
            settingsNavigation,
            LinearLayout.LayoutParams(0, dp(BOTTOM_NAVIGATION_HEIGHT_DP), 1f),
        )
        rootView.addView(bottomNavigation, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(BOTTOM_NAVIGATION_HEIGHT_DP),
        ))
        return rootView
    }

    private fun applyBottomNavigationInsets() {
        rootView.setOnApplyWindowInsetsListener { _, insets ->
            val safeInsets = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val values = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
                )
                intArrayOf(values.left, values.top, values.right, values.bottom)
            } else {
                @Suppress("DEPRECATION")
                intArrayOf(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom,
                )
            }
            rootView.setPadding(safeInsets[0], safeInsets[1], safeInsets[2], 0)
            bottomNavigation.setPadding(0, 0, 0, safeInsets[3])
            bottomNavigation.layoutParams = bottomNavigation.layoutParams.apply {
                height = dp(BOTTOM_NAVIGATION_HEIGHT_DP) + safeInsets[3]
            }
            insets
        }
        rootView.requestApplyInsets()
    }

    @Suppress("DEPRECATION")
    private fun configureEdgeToEdgeLayout() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        }
        window.decorView.systemUiVisibility = edgeToEdgeSystemUiFlags()
    }

    @Suppress("DEPRECATION")
    private fun edgeToEdgeSystemUiFlags() =
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

    private fun createHomeContent() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(24), dp(48), dp(24), dp(24))

        addView(label("Bevy RuneWeave", 28f), matchWrap())
        addView(label("Android host", 15f, secondary = true).apply {
            setPadding(0, dp(4), 0, dp(24))
        }, matchWrap())
        addView(label("GitHub release assets", 16f), matchWrap())

        remoteAssetsStatus = label("Loading latest release...", 14f, secondary = true)
        addView(remoteAssetsStatus, matchWrap())
        remoteAssetsContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
        }
        addView(remoteAssetsContainer, matchWrap())

        urlField = EditText(context).apply {
            hint = "HTTPS asset package URL"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        addView(urlField, ViewGroup.LayoutParams.MATCH_PARENT, dp(56))

        downloadButton = themedButton("Download and start").apply {
            setOnClickListener { installFromUrl() }
        }
        addView(downloadButton, ViewGroup.LayoutParams.MATCH_PARENT, dp(52))

        launchButton = themedButton("Start installed game").apply {
            setOnClickListener { launchGame() }
        }
        addView(launchButton, ViewGroup.LayoutParams.MATCH_PARENT, dp(52))

        progress = ProgressBar(context).apply { visibility = ProgressBar.GONE }
        addView(progress, dp(48), dp(48))

        status = label("", 14f, secondary = true).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(12), 0, 0)
        }
        addView(status, matchWrap())
    }

    private fun createSettingsContent() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(48), dp(24), dp(24))
        addView(label("Settings", 28f), matchWrap())
        addView(label("Appearance", 15f, secondary = true).apply {
            setPadding(0, dp(28), 0, dp(8))
        }, matchWrap())

        settingsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(12), 0)
            addView(label("Dark mode", 16f), LinearLayout.LayoutParams(0, dp(56), 1f).apply {
                gravity = Gravity.CENTER_VERTICAL
            })
            addView(Switch(context).apply {
                isChecked = darkMode
                setOnCheckedChangeListener { _, enabled ->
                    darkMode = enabled
                    getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                        .edit()
                        .putBoolean(DARK_MODE, enabled)
                        .apply()
                    applyTheme()
                }
            })
        }
        addView(settingsRow, matchWrap())
    }

    private fun label(text: String, size: Float, secondary: Boolean = false) = TextView(this).apply {
        this.text = text
        textSize = size
        if (secondary) secondaryLabels += this else primaryLabels += this
    }

    private fun themedButton(title: String) = Button(this).apply {
        text = title
        themedButtons += this
    }

    private fun navigationItem(title: String, icon: Int, page: Page) = TextView(this).apply {
        text = title
        textSize = 12f
        gravity = Gravity.CENTER
        setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0)
        compoundDrawablePadding = dp(4)
        isClickable = true
        isFocusable = true
        setOnClickListener { showPage(page) }
    }

    private fun showPage(page: Page) {
        selectedPage = page
        homePage.visibility = if (page == Page.HOME) View.VISIBLE else View.GONE
        settingsPage.visibility = if (page == Page.SETTINGS) View.VISIBLE else View.GONE
        applyNavigationTheme()
    }

    private fun applyTheme() {
        val background = if (darkMode) Color.rgb(18, 20, 23) else Color.rgb(244, 245, 247)
        val surface = if (darkMode) Color.rgb(34, 38, 43) else Color.WHITE
        val primary = if (darkMode) Color.rgb(239, 242, 245) else Color.rgb(28, 32, 36)
        val secondary = if (darkMode) Color.rgb(173, 181, 190) else Color.rgb(83, 90, 98)
        val accent = if (darkMode) Color.rgb(88, 166, 255) else Color.rgb(35, 105, 194)

        rootView.setBackgroundColor(background)
        homePage.setBackgroundColor(background)
        settingsPage.setBackgroundColor(background)
        bottomNavigation.setBackgroundColor(surface)
        settingsRow.setBackgroundColor(surface)
        primaryLabels.forEach { it.setTextColor(primary) }
        secondaryLabels.forEach { it.setTextColor(secondary) }
        themedButtons.forEach {
            it.setTextColor(primary)
            it.backgroundTintList = ColorStateList.valueOf(surface)
        }
        downloadButton.setTextColor(Color.WHITE)
        downloadButton.backgroundTintList = ColorStateList.valueOf(accent)
        urlField.setTextColor(primary)
        urlField.setHintTextColor(secondary)
        urlField.backgroundTintList = ColorStateList.valueOf(accent)
        status.setTextColor(if (statusIsError) Color.rgb(220, 80, 85) else secondary)
        progress.indeterminateTintList = ColorStateList.valueOf(accent)

        window.statusBarColor = background
        window.navigationBarColor = surface
        window.decorView.systemUiVisibility = edgeToEdgeSystemUiFlags() or if (darkMode) 0 else
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        applyNavigationTheme()
    }

    private fun applyNavigationTheme() {
        val selected = if (darkMode) Color.rgb(88, 166, 255) else Color.rgb(35, 105, 194)
        val unselected = if (darkMode) Color.rgb(173, 181, 190) else Color.rgb(83, 90, 98)
        homeNavigation.setTextColor(if (selectedPage == Page.HOME) selected else unselected)
        settingsNavigation.setTextColor(if (selectedPage == Page.SETTINGS) selected else unselected)
        homeNavigation.compoundDrawables.filterNotNull().forEach {
            it.setTint(if (selectedPage == Page.HOME) selected else unselected)
        }
        settingsNavigation.compoundDrawables.filterNotNull().forEach {
            it.setTint(if (selectedPage == Page.SETTINGS) selected else unselected)
        }
    }

    private fun matchWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun loadRemoteAssets() {
        remoteAssetsStatus.text = "Loading latest release..."
        remoteAssetsContainer.removeAllViews()
        remoteAssetButtons.clear()
        executor.execute {
            val result = runCatching { fetchRemoteAssets() }
                .recover { fallbackRemoteRelease() }
            runOnUiThread {
                result.onSuccess(::showRemoteAssets).onFailure { error ->
                    remoteAssetsStatus.text = error.message ?: "Could not load release assets"
                    remoteAssetsContainer.addView(
                        themedButton("Refresh").apply { setOnClickListener { loadRemoteAssets() } },
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        dp(48),
                    )
                }
            }
        }
    }

    private fun showRemoteAssets(release: RemoteRelease) {
        remoteAssetsStatus.text = "Latest release ${release.tag}"
        release.assets.forEach { asset ->
            val detail = if (asset.size > 0) " (${formatSize(asset.size)})" else ""
            val button = themedButton("Download ${asset.name}$detail").apply {
                setOnClickListener {
                    urlField.setText(asset.url)
                    installFromUrl()
                }
            }
            remoteAssetButtons += button
            remoteAssetsContainer.addView(button, ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        }
        if (release.assets.isEmpty()) remoteAssetsStatus.text = "Latest release has no assets"
    }

    private fun fetchRemoteAssets(): RemoteRelease {
        if (!BuildConfig.DEBUG) return fallbackRemoteRelease()
        val latest = readJsonObject(URL("$GITHUB_API_ROOT/releases/latest"))
        val tag = latest.getString("tag_name")
        val assetsJson = latest.getJSONArray("assets")
        val assets = buildList {
            repeat(assetsJson.length()) { index ->
                val asset = assetsJson.getJSONObject(index)
                add(RemoteAsset(
                    asset.getString("name"),
                    asset.getString("browser_download_url"),
                    asset.getLong("size"),
                ))
            }
        }
        return RemoteRelease(tag, assets.sortedBy { it.name.lowercase() })
    }

    private fun fallbackRemoteRelease() = RemoteRelease(
        "direct downloads",
        FALLBACK_RELEASE_ASSETS.map { name ->
            RemoteAsset(name, "$GITHUB_RELEASE_DOWNLOAD_ROOT/$name", 0)
        },
    )

    private fun readJsonObject(url: URL) = JSONObject(readRemoteMetadata(url))

    private fun readRemoteMetadata(url: URL): String {
        val connection = openDownloadConnection(url).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "BevyRuneweave-Android-Demo/0.1")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            if (BuildConfig.DEBUG && BuildConfig.GITHUB_TOKEN.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer ${BuildConfig.GITHUB_TOKEN}")
            }
        }
        try {
            check(connection.responseCode in 200..299) {
                "Release lookup failed with HTTP ${connection.responseCode}"
            }
            return connection.inputStream.bufferedReader().use { reader ->
                val text = reader.readText()
                check(text.toByteArray().size <= MAX_REMOTE_METADATA_BYTES) {
                    "Release metadata is too large"
                }
                text
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun formatSize(bytes: Long) = when {
        bytes >= 1024 * 1024 -> "%.1f MB".format(bytes.toDouble() / (1024 * 1024))
        bytes >= 1024 -> "%.1f KB".format(bytes.toDouble() / 1024)
        else -> "$bytes B"
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

        val connection = openDownloadConnection(url).apply {
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

    private fun openDownloadConnection(url: URL): HttpURLConnection {
        val connection = url.openConnection() as HttpURLConnection
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
            connection is HttpsURLConnection) {
            connection.sslSocketFactory = DEBUG_TRUST_ALL_SOCKET_FACTORY
            connection.hostnameVerifier = DEBUG_TRUST_ALL_HOSTNAMES
        }
        return connection
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
                val parent = checkNotNull(output.parentFile) { "Archive entry has no parent directory" }
                check(parent.isDirectory || parent.mkdirs()) { "Could not create ${entry.name}" }
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
        startActivity(
            Intent(this, RuntimeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(RuntimeActivity.EXTRA_SCRIPT, JSONObject(File(File(filesDir, "assets"), "engineConfig.json").readText()).getJSONObject("script").getString("entry")),
        )
    }

    private fun updateInstalledState() {
        launchButton.isEnabled = installedGameAvailable()
    }

    private fun installedGameAvailable() = runCatching {
        validatePackage(File(filesDir, "assets"))
    }.isSuccess

    private fun setBusy(busy: Boolean, message: String) {
        remoteAssetButtons.forEach { it.isEnabled = !busy }
        urlField.isEnabled = !busy
        downloadButton.isEnabled = !busy
        launchButton.isEnabled = !busy && launchButton.isEnabled
        progress.visibility = if (busy) ProgressBar.VISIBLE else ProgressBar.GONE
        statusIsError = false
        status.setTextColor(if (darkMode) Color.rgb(173, 181, 190) else Color.rgb(73, 80, 87))
        status.text = message
    }

    private fun showError(message: String) {
        statusIsError = true
        status.setTextColor(Color.rgb(176, 39, 45))
        status.text = message
    }

    companion object {
        private val DEBUG_TRUST_ALL_HOSTNAMES = HostnameVerifier { _, _ -> true }
        private val DEBUG_TRUST_ALL_SOCKET_FACTORY by lazy {
            val trustManager = object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            }
            SSLContext.getInstance("TLS").apply {
                init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
            }.socketFactory
        }

        private const val GITHUB_API_ROOT =
            "https://api.github.com/repos/Super1Windcloud/BevyRuneweave"
        private const val GITHUB_RELEASE_DOWNLOAD_ROOT =
            "https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download"
        private val FALLBACK_RELEASE_ASSETS = listOf(
            "script-squadron-typescript.zip",
            "script-squadron-js.zip",
            "script-squadron-lua.zip",
        )
        private const val MAX_REMOTE_METADATA_BYTES = 2 * 1024 * 1024
        private const val MAX_ENTRIES = 10_000
        private const val MAX_UNPACKED_BYTES = 256L * 1024L * 1024L
        private const val PREFERENCES = "host_settings"
        private const val DARK_MODE = "dark_mode"
        private const val BOTTOM_NAVIGATION_HEIGHT_DP = 72
    }

    private data class RemoteAsset(val name: String, val url: String, val size: Long)
    private data class RemoteRelease(val tag: String, val assets: List<RemoteAsset>)

    private enum class Page { HOME, SETTINGS }
}
