package io.github.super1windcloud.runeweave.demo

import android.app.Activity
import android.app.AlertDialog
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.LocaleList
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
import java.io.FilterInputStream
import java.io.InputStream
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
import kotlin.math.max

class MainActivity : Activity() {
    override fun attachBaseContext(newBase: Context) {
        val configuration = Configuration(newBase.resources.configuration)
        val appLocales = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            newBase.getSystemService(LocaleManager::class.java).applicationLocales
        } else LocaleList.getEmptyLocaleList()
        val preferred = if (appLocales.isEmpty) configuration.locales.get(0) else appLocales.get(0)
        val locale = if (preferred?.language.equals("zh", ignoreCase = true)) {
            java.util.Locale.SIMPLIFIED_CHINESE
        } else {
            java.util.Locale.ENGLISH
        }
        configuration.setLocales(LocaleList(locale))
        configuration.setLayoutDirection(locale)
        super.attachBaseContext(newBase.createConfigurationContext(configuration))
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val primaryLabels = mutableListOf<TextView>()
    private val secondaryLabels = mutableListOf<TextView>()
    private val themedButtons = mutableListOf<Button>()
    private val cards = mutableListOf<View>()
    private val accentLabels = mutableListOf<TextView>()
    private lateinit var urlField: EditText
    private lateinit var downloadButton: Button
    private lateinit var launchButton: Button
    private lateinit var clearResourcesButton: Button
    private val remoteAssetButtons = mutableListOf<Button>()
    private lateinit var remoteAssetsContainer: LinearLayout
    private lateinit var remoteAssetsStatus: TextView
    private lateinit var progress: ProgressBar
    private lateinit var downloadBar: ProgressBar
    private lateinit var status: TextView
    private lateinit var statusRow: LinearLayout
    private lateinit var installedTitle: TextView
    private lateinit var installedDetail: TextView
    private lateinit var appearanceSwitch: Switch
    private lateinit var rootView: LinearLayout
    private lateinit var homePage: View
    private lateinit var settingsPage: View
    private lateinit var bottomNavigation: LinearLayout
    private lateinit var homeNavigation: TextView
    private lateinit var settingsNavigation: TextView
    private var darkMode = false
    private var selectedPage = Page.HOME
    private var statusIsError = false
    private var busy = false

    private val backgroundColor get() = Color.parseColor(if (darkMode) "#101C1B" else "#F3F5F1")
    private val surfaceColor get() = Color.parseColor(if (darkMode) "#1B2B29" else "#FFFFFF")
    private val primaryColor get() = Color.parseColor(if (darkMode) "#EDF5F1" else "#172F2B")
    private val secondaryColor get() = Color.parseColor(if (darkMode) "#ADBFBA" else "#526A64")
    private val accentColor get() = Color.parseColor(if (darkMode) "#87DBC1" else "#006B54")
    private val softAccentColor get() = Color.parseColor(if (darkMode) "#28483F" else "#E4F2EB")
    private val navigationHeight get() = dp(BOTTOM_NAVIGATION_HEIGHT_DP) +
        dp((16 * (resources.configuration.fontScale - 1f)).coerceAtLeast(0f).toInt())

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

        homePage = scrollPage(createHomeContent())
        settingsPage = scrollPage(createSettingsContent()).apply { visibility = View.GONE }
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
        homeNavigation = navigationItem(getString(R.string.host_home), R.drawable.ic_home, Page.HOME)
        settingsNavigation = navigationItem(
            getString(R.string.host_settings),
            R.drawable.ic_settings,
            Page.SETTINGS,
        )
        bottomNavigation.addView(
            homeNavigation,
            LinearLayout.LayoutParams(0, navigationHeight, 1f),
        )
        bottomNavigation.addView(
            settingsNavigation,
            LinearLayout.LayoutParams(0, navigationHeight, 1f),
        )
        rootView.addView(bottomNavigation, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            navigationHeight,
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
            val keyboardInset = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                insets.getInsets(WindowInsets.Type.ime()).bottom
            } else 0
            rootView.setPadding(safeInsets[0], safeInsets[1], safeInsets[2],
                max(0, keyboardInset - safeInsets[3]))
            bottomNavigation.setPadding(0, 0, 0, safeInsets[3])
            bottomNavigation.layoutParams = bottomNavigation.layoutParams.apply {
                height = navigationHeight + safeInsets[3]
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

    private fun scrollPage(content: LinearLayout) = ScrollView(this).apply {
        isFillViewport = true
        clipToPadding = false
        addView(content)
        addOnLayoutChangeListener { _, left, _, right, _, _, _, _, _ ->
            val inset = max(dp(20), (right - left - dp(640)) / 2)
            if (content.paddingLeft != inset) content.setPadding(inset, dp(24), inset, dp(28))
        }
    }

    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun createHomeContent() = column().apply {
        setPadding(dp(20), dp(24), dp(20), dp(28))
        addView(label("RUNEWEAVE  /  ANDROID", 12f).apply {
            letterSpacing = 0.14f
            accentLabels += this
        }, spaced(12))

        val hero = column().apply {
            setPadding(dp(24), dp(26), dp(24), dp(26))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#164E40"), Color.parseColor("#102F2C"))).apply {
                cornerRadius = dp(28).toFloat()
            }
            addView(TextView(context).apply {
                text = getString(R.string.host_play_create_explore)
                textSize = 11f
                letterSpacing = 0.16f
                setTextColor(Color.parseColor("#A8DDC8"))
            }, spaced(12))
            addView(TextView(context).apply {
                text = getString(R.string.host_little_world)
                textSize = 30f
                setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL))
                setTextColor(Color.WHITE)
                setLineSpacing(dp(2).toFloat(), 1f)
                markAsHeading()
            }, spaced(12))
            addView(TextView(context).apply {
                text = getString(R.string.host_discover_intro)
                textSize = 15f
                setTextColor(Color.parseColor("#C1DCD1"))
            }, matchWrap())
        }
        addView(hero, spaced(24))

        statusRow = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            setPadding(0, 0, 0, dp(16))
        }
        progress = ProgressBar(context).apply { visibility = View.GONE }
        statusRow.addView(progress, LinearLayout.LayoutParams(dp(24), dp(24)).apply {
            marginEnd = dp(12)
        })
        status = label("", 14f, secondary = true).apply {
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        statusRow.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(statusRow, matchWrap())
        downloadBar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = DOWNLOAD_PROGRESS_STEPS
            visibility = View.GONE
            contentDescription = getString(R.string.host_download_progress_label)
        }
        addView(downloadBar, matchWrap().apply { bottomMargin = dp(16) })

        addView(sectionHeading(getString(R.string.host_your_space)), spaced(12))
        addView(card().apply {
            installedTitle = label(getString(R.string.host_next_adventure), 19f)
            installedDetail = label(getString(R.string.host_choose_release), 14f, secondary = true)
            addView(installedTitle, spaced(6))
            addView(installedDetail, spaced(18))
            launchButton = themedButton(getString(R.string.host_start_installed), R.drawable.ic_play).apply {
                setOnClickListener { launchGame() }
            }
            addView(launchButton, spaced(10))
            clearResourcesButton = themedButton(getString(R.string.host_clear_downloaded)).apply {
                setOnClickListener { confirmClearResources() }
            }
            addView(clearResourcesButton, matchWrap())
        }, spaced(28))

        addView(sectionHeading(getString(R.string.host_discover)), spaced(6))
        remoteAssetsStatus = label(getString(R.string.host_finding_release), 13f, secondary = true).apply {
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        addView(remoteAssetsStatus, spaced(12))
        remoteAssetsContainer = column()
        addView(remoteAssetsContainer, spaced(18))

        addView(card().apply {
            addView(label(getString(R.string.host_package_link), 19f), spaced(6))
            addView(label(getString(R.string.host_package_link_intro), 14f, secondary = true), spaced(16))
            urlField = EditText(context).apply {
                hint = "https://…/game.zip"
                textSize = 15f
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_VARIATION_URI
                imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_GO
                setSingleLine(true)
                minHeight = dp(56)
                setPadding(dp(14), dp(14), dp(14), dp(14))
                contentDescription = getString(R.string.host_package_url)
                setOnEditorActionListener { _, action, _ ->
                    if (action == android.view.inputmethod.EditorInfo.IME_ACTION_GO) {
                        if (!busy) installFromUrl()
                        true
                    } else false
                }
            }
            addView(urlField, spaced(12))
            downloadButton = themedButton(getString(R.string.host_download_start), R.drawable.ic_download).apply {
                setOnClickListener { installFromUrl() }
            }
            addView(downloadButton, matchWrap())
        }, spaced(24))
        addView(label(getString(R.string.host_powered_by), 12f, secondary = true).apply {
            gravity = Gravity.CENTER
        }, matchWrap())
    }

    private fun createSettingsContent() = column().apply {
        setPadding(dp(20), dp(24), dp(20), dp(28))
        addView(label(getString(R.string.host_make_it_yours), 12f).apply {
            letterSpacing = 0.14f
            accentLabels += this
        }, spaced(12))
        addView(label(getString(R.string.host_settings), 32f).apply { markAsHeading() }, spaced(8))
        addView(label(getString(R.string.host_comfortable_space), 15f, secondary = true), spaced(28))
        addView(sectionHeading(getString(R.string.host_appearance)), spaced(12))
        addView(card().apply {
            val row = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
            row.addView(column().apply {
                addView(label(getString(R.string.host_dark_mode), 17f), spaced(4))
                addView(label(getString(R.string.host_softer_glow), 14f, secondary = true), matchWrap())
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(12)
            })
            appearanceSwitch = Switch(context).apply {
                contentDescription = getString(R.string.host_dark_mode)
                minHeight = dp(48)
                isChecked = darkMode
                setOnCheckedChangeListener { _, enabled ->
                    darkMode = enabled
                    getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                        .putBoolean(DARK_MODE, enabled).apply()
                    applyTheme()
                }
            }
            row.addView(appearanceSwitch)
            addView(row, matchWrap())
        }, spaced(28))
        addView(label("Bevy RuneWeave", 16f), spaced(4))
        addView(label(getString(R.string.host_big_ideas), 14f, secondary = true), matchWrap())
    }

    private fun TextView.markAsHeading() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setAccessibilityHeading(true)
    }

    private fun sectionHeading(text: String) = label(text, 21f).apply { markAsHeading() }

    private fun card() = column().apply {
        setPadding(dp(20), dp(20), dp(20), dp(20))
        background = rounded(surfaceColor, 24)
        cards += this
    }

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun spaced(bottom: Int) = matchWrap().apply { bottomMargin = dp(bottom) }

    private fun label(text: String, size: Float, secondary: Boolean = false) = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(if (secondary) secondaryColor else primaryColor)
        if (!secondary) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setLineSpacing(dp(2).toFloat(), 1f)
        if (secondary) secondaryLabels += this else primaryLabels += this
    }

    private fun themedButton(title: String, icon: Int? = null) = Button(this).apply {
        text = title
        textSize = 15f
        isAllCaps = false
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        minHeight = dp(54)
        minimumHeight = dp(54)
        setPadding(dp(16), dp(14), dp(16), dp(14))
        stateListAnimator = null
        icon?.let {
            setCompoundDrawablesRelativeWithIntrinsicBounds(it, 0, 0, 0)
            compoundDrawablePadding = dp(12)
        }
        themedButtons += this
        styleButton(this)
    }

    private fun styleButton(button: Button, primary: Boolean = false) {
        val foreground = if (primary) backgroundColor else accentColor
        button.setTextColor(ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(secondaryColor, foreground),
        ))
        button.background = RippleDrawable(ColorStateList.valueOf(0x2287DBC1),
            rounded(if (primary) accentColor else softAccentColor, 16), null)
        button.compoundDrawableTintList = button.textColors
        button.alpha = if (button.isEnabled) 1f else 0.5f
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
        setPadding(dp(12), dp(10), dp(12), dp(10))
    }

    private fun showPage(page: Page) {
        selectedPage = page
        homePage.visibility = if (page == Page.HOME) View.VISIBLE else View.GONE
        settingsPage.visibility = if (page == Page.SETTINGS) View.VISIBLE else View.GONE
        applyNavigationTheme()
    }

    private fun applyTheme() {
        rootView.setBackgroundColor(backgroundColor)
        homePage.setBackgroundColor(backgroundColor)
        settingsPage.setBackgroundColor(backgroundColor)
        bottomNavigation.setBackgroundColor(surfaceColor)
        cards.forEach { it.background = rounded(surfaceColor, 24) }
        primaryLabels.forEach { it.setTextColor(primaryColor) }
        secondaryLabels.forEach { it.setTextColor(secondaryColor) }
        accentLabels.forEach { it.setTextColor(accentColor) }
        refreshButtons()
        urlField.setTextColor(primaryColor)
        urlField.setHintTextColor(secondaryColor)
        urlField.background = rounded(backgroundColor, 14)
        urlField.backgroundTintList = null
        status.setTextColor(if (statusIsError) errorColor() else secondaryColor)
        progress.indeterminateTintList = ColorStateList.valueOf(accentColor)
        downloadBar.progressTintList = ColorStateList.valueOf(accentColor)
        downloadBar.indeterminateTintList = ColorStateList.valueOf(accentColor)
        downloadBar.progressBackgroundTintList = ColorStateList.valueOf(softAccentColor)
        appearanceSwitch.thumbTintList = ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(accentColor, secondaryColor),
        )
        appearanceSwitch.trackTintList = ColorStateList.valueOf(softAccentColor)

        window.statusBarColor = backgroundColor
        window.navigationBarColor = surfaceColor
        window.decorView.systemUiVisibility = edgeToEdgeSystemUiFlags() or if (darkMode) 0 else
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        applyNavigationTheme()
    }

    private fun applyNavigationTheme() {
        listOf(homeNavigation to Page.HOME, settingsNavigation to Page.SETTINGS).forEach { (item, page) ->
            val selected = selectedPage == page
            val color = if (selected) accentColor else secondaryColor
            item.isSelected = selected
            item.setTextColor(color)
            item.typeface = Typeface.create(if (selected) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
            item.compoundDrawables.filterNotNull().forEach { it.setTint(color) }
            item.background = InsetDrawable(RippleDrawable(ColorStateList.valueOf(0x2287DBC1),
                rounded(if (selected) softAccentColor else surfaceColor, 18), null),
                dp(20), dp(6), dp(20), dp(6))
        }
    }

    private fun refreshButtons() {
        themedButtons.forEach { styleButton(it, it === downloadButton) }
    }

    private fun errorColor() = Color.parseColor(if (darkMode) "#FFA9A3" else "#AF3036")

    private fun matchWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun loadRemoteAssets() {
        remoteAssetsStatus.text = getString(R.string.host_finding_release)
        remoteAssetsContainer.removeAllViews()
        themedButtons.removeAll(remoteAssetButtons.toSet())
        remoteAssetButtons.clear()
        executor.execute {
            val result = runCatching { fetchRemoteAssets() }
                .recover { fallbackRemoteRelease() }
            runOnUiThread {
                result.onSuccess(::showRemoteAssets).onFailure { error ->
                    remoteAssetsStatus.text = error.message ?: getString(R.string.host_release_failed)
                    val retry = themedButton(getString(R.string.host_retry), R.drawable.ic_download).apply {
                        isEnabled = !busy
                        setOnClickListener { loadRemoteAssets() }
                    }
                    remoteAssetButtons += retry
                    remoteAssetsContainer.addView(retry, spaced(10))
                    refreshButtons()
                }
            }
        }
    }

    private fun showRemoteAssets(release: RemoteRelease) {
        val tag = if (release.tag == "direct downloads") getString(R.string.host_direct_downloads) else release.tag
        remoteAssetsStatus.text = getString(R.string.host_latest_release, tag)
        release.assets.forEach { asset ->
            val detail = if (asset.size > 0) getString(R.string.host_download_size, formatSize(asset.size)) else getString(R.string.host_download_asset)
            val button = themedButton("${asset.name}\n$detail", R.drawable.ic_download).apply {
                isEnabled = !busy
                textSize = 14f
                setOnClickListener {
                    urlField.setText(asset.url)
                    installFromUrl()
                }
            }
            remoteAssetButtons += button
            remoteAssetsContainer.addView(button, spaced(10))
        }
        if (release.assets.isEmpty()) remoteAssetsStatus.text = getString(R.string.host_no_assets)
        refreshButtons()
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
                getString(R.string.host_release_http, connection.responseCode.toString())
            }
            return connection.inputStream.bufferedReader().use { reader ->
                val text = reader.readText()
                check(text.toByteArray().size <= MAX_REMOTE_METADATA_BYTES) {
                    getString(R.string.host_metadata_large)
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
        if (busy) return
        val rawUrl = urlField.text.toString().trim()
        val url = runCatching { URL(rawUrl) }.getOrNull()
        if (url == null || url.protocol != "https") {
            showError(getString(R.string.host_valid_https))
            urlField.requestFocus()
            urlField.error = getString(R.string.host_valid_https)
            return
        }
        urlField.error = null
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
            .hideSoftInputFromWindow(urlField.windowToken, 0)
        urlField.clearFocus()
        setBusy(true, getString(R.string.host_downloading))
        showDownloadProgress(0, 0)
        executor.execute {
            val result = runCatching {
                downloadAndInstall(url, { received, total ->
                    runOnUiThread { if (busy) showDownloadProgress(received, total) }
                }, {
                    runOnUiThread { if (busy) showInstalling() }
                })
            }
            runOnUiThread {
                setBusy(false, "")
                result.onSuccess { launchGame() }
                    .onFailure { showError(it.message ?: getString(R.string.host_installation_failed)) }
                updateInstalledState()
            }
        }
    }

    private fun showDownloadProgress(received: Long, total: Long) {
        downloadBar.visibility = View.VISIBLE
        downloadBar.isIndeterminate = total <= 0
        if (total > 0) {
            val fraction = (received.toDouble() / total).coerceIn(0.0, 1.0)
            downloadBar.progress = (fraction * DOWNLOAD_PROGRESS_STEPS).toInt()
            status.text = getString(
                R.string.host_download_progress,
                formatSize(received),
                formatSize(total),
                "${(fraction * 100).toInt()}%",
            )
        } else {
            status.text = getString(R.string.host_download_progress_unknown, formatSize(received))
        }
    }

    private fun showInstalling() {
        downloadBar.isIndeterminate = true
        status.text = getString(R.string.host_installing_package)
    }

    private fun downloadAndInstall(url: URL, onProgress: (Long, Long) -> Unit, onInstalling: () -> Unit) {
        val staging = File(filesDir, "assets.staging")
        staging.deleteRecursively()
        check(staging.mkdirs()) { getString(R.string.host_staging_failed) }

        val connection = openDownloadConnection(url).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            check(connection.responseCode in 200..299) {
                getString(R.string.host_download_http, connection.responseCode.toString())
            }
            check(connection.url.protocol == "https") { getString(R.string.host_https_redirect) }
            val total = connection.contentLengthLong
            onProgress(0, total)
            val counted = ProgressInputStream(connection.inputStream) { received -> onProgress(received, total) }
            ZipInputStream(BufferedInputStream(counted)).use { archive ->
                extractZip(archive, staging)
            }
            onInstalling()
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
            check(++entries <= MAX_ENTRIES) { getString(R.string.host_many_entries) }
            val output = File(root, entry.name).canonicalFile
            check(output.path.startsWith(root.path + File.separator)) {
                getString(R.string.host_unsafe_archive)
            }
            if (entry.isDirectory) {
                check(output.mkdirs() || output.isDirectory) { getString(R.string.host_create_entry, entry.name) }
            } else {
                val parent = checkNotNull(output.parentFile) { getString(R.string.host_entry_no_parent) }
                check(parent.isDirectory || parent.mkdirs()) { getString(R.string.host_create_entry, entry.name) }
                output.outputStream().buffered().use { stream ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = archive.read(buffer)
                        if (count < 0) break
                        bytesWritten += count
                        check(bytesWritten <= MAX_UNPACKED_BYTES) { getString(R.string.host_archive_large) }
                        stream.write(buffer, 0, count)
                    }
                }
            }
            archive.closeEntry()
        }
        check(entries > 0) { getString(R.string.host_zip_empty) }
    }

    private fun validatePackage(assets: File) {
        val configFile = File(assets, "engineConfig.json")
        check(configFile.isFile) { getString(R.string.host_config_missing) }
        val config = JSONObject(configFile.readText())
        check(config.optInt("schemaVersion") == 1) { getString(R.string.host_schema_unsupported) }
        check(config.optString("name").isNotBlank()) { getString(R.string.host_config_name_empty) }
        check(config.optString("version").isNotBlank()) { getString(R.string.host_config_version_empty) }
        val mobile = if (config.has("mobile")) config.getJSONObject("mobile") else null
        check((mobile?.optString("orientation", "auto") ?: "auto") in setOf("auto", "portrait", "landscape")) {
            getString(R.string.host_mobile_orientation_invalid)
        }
        val script = config.getJSONObject("script")
        val language = script.getString("language")
        check(language in setOf("js", "typescript", "lua")) { getString(R.string.host_script_unsupported) }
        val entry = script.getString("entry")
        check(entry.isNotBlank() && !entry.startsWith('/') && !entry.split('/').contains("..")) {
            getString(R.string.host_script_inside)
        }
        val extension = File(entry).extension.lowercase()
        check((language == "lua" && extension == "lua") ||
            (language in setOf("js", "typescript") && extension in setOf("js", "mjs"))) {
            getString(R.string.host_script_extension)
        }
        check(File(assets, entry).isFile) { getString(R.string.host_script_missing, entry) }
    }

    private fun replaceInstalledAssets(staging: File) {
        val installed = File(filesDir, "assets")
        val backup = File(filesDir, "assets.backup")
        backup.deleteRecursively()
        if (installed.exists()) check(installed.renameTo(backup)) { getString(R.string.host_preserve_failed) }
        if (!staging.renameTo(installed)) {
            backup.renameTo(installed)
            error(getString(R.string.host_activate_download_failed))
        }
        backup.deleteRecursively()
    }

    private fun confirmClearResources() {
        if (busy) return
        AlertDialog.Builder(this)
            .setTitle(R.string.host_clear_title)
            .setMessage(R.string.host_mobile_clear_description)
            .setNegativeButton(R.string.host_cancel, null)
            .setPositiveButton(R.string.host_clear_resources) { _, _ -> clearLocalResources() }
            .show()
    }

    private fun clearLocalResources() {
        if (busy) return
        setBusy(true, getString(R.string.host_clearing))
        executor.execute {
            val result = runCatching {
                for (name in listOf("assets", "assets.staging", "assets.backup")) {
                    val directory = File(filesDir, name)
                    check(!directory.exists() || directory.deleteRecursively()) {
                        getString(R.string.host_mobile_clear_failed, name)
                    }
                }
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                setBusy(false, if (result.isSuccess) getString(R.string.host_cleared) else "")
                result.onFailure {
                    showError(it.message ?: getString(R.string.host_attention))
                }
            }
        }
    }

    private fun launchGame() {
        if (busy) return
        val config = runCatching {
            val assets = File(filesDir, "assets")
            validatePackage(assets)
            JSONObject(File(assets, "engineConfig.json").readText())
        }.getOrElse {
            showError(it.message ?: getString(R.string.host_no_valid_game))
            return
        }
        startActivity(
            Intent(this, RuntimeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(RuntimeActivity.EXTRA_SCRIPT, config.getJSONObject("script").getString("entry"))
                .putExtra(RuntimeActivity.EXTRA_ORIENTATION, config.optJSONObject("mobile")?.optString("orientation", "auto") ?: "auto"),
        )
    }

    private fun updateInstalledState() {
        val config = runCatching {
            val assets = File(filesDir, "assets")
            validatePackage(assets)
            JSONObject(File(assets, "engineConfig.json").readText())
        }.getOrNull()
        launchButton.isEnabled = !busy && config != null
        installedTitle.text = config?.getString("name") ?: getString(R.string.host_next_adventure)
        installedDetail.text = if (config != null) {
            getString(R.string.host_ready, config.getString("version"), config.getJSONObject("script").getString("language"))
        } else getString(R.string.host_choose_release)
        refreshButtons()
    }

    private fun setBusy(busy: Boolean, message: String) {
        this.busy = busy
        remoteAssetButtons.forEach { it.isEnabled = !busy }
        urlField.isEnabled = !busy
        downloadButton.isEnabled = !busy
        clearResourcesButton.isEnabled = !busy
        updateInstalledState()
        progress.visibility = if (busy) ProgressBar.VISIBLE else ProgressBar.GONE
        if (!busy) downloadBar.visibility = View.GONE
        statusRow.visibility = if (message.isEmpty()) View.GONE else View.VISIBLE
        statusIsError = false
        status.setTextColor(secondaryColor)
        status.text = message
        refreshButtons()
        if (busy) statusRow.post {
            statusRow.requestRectangleOnScreen(android.graphics.Rect(0, 0, statusRow.width, statusRow.height))
        }
    }

    private fun showError(message: String) {
        statusIsError = true
        statusRow.visibility = View.VISIBLE
        status.setTextColor(errorColor())
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
        private const val DOWNLOAD_PROGRESS_STEPS = 1_000
        private const val PROGRESS_INTERVAL_NANOS = 100_000_000L
        private const val MAX_UNPACKED_BYTES = 256L * 1024L * 1024L
        private const val PREFERENCES = "host_settings"
        private const val DARK_MODE = "dark_mode"
        private const val BOTTOM_NAVIGATION_HEIGHT_DP = 72
    }

    /** Counts compressed bytes read from the network, reporting at most every 100 ms. */
    private class ProgressInputStream(
        input: InputStream,
        private val report: (Long) -> Unit,
    ) : FilterInputStream(input) {
        private var received = 0L
        private var lastReport = 0L

        override fun read(): Int = super.read().also { if (it >= 0) advance(1) }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            super.read(buffer, offset, length).also { if (it > 0) advance(it.toLong()) }

        override fun skip(count: Long): Long = super.skip(count).also { if (it > 0) advance(it) }

        private fun advance(count: Long) {
            received += count
            val now = System.nanoTime()
            if (now - lastReport >= PROGRESS_INTERVAL_NANOS) {
                lastReport = now
                report(received)
            }
        }

        override fun close() {
            report(received)
            super.close()
        }
    }

    private data class RemoteAsset(val name: String, val url: String, val size: Long)
    private data class RemoteRelease(val tag: String, val assets: List<RemoteAsset>)

    private enum class Page { HOME, SETTINGS }
}
