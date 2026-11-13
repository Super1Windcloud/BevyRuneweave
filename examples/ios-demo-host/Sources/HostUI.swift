import UIKit

private enum HostStyle {
    static let background = color(light: 0xF3F5F1, dark: 0x101C1B)
    static let surface = color(light: 0xFFFFFF, dark: 0x1B2B29)
    static let primary = color(light: 0x172F2B, dark: 0xEDF5F1)
    static let secondary = color(light: 0x526A64, dark: 0xADBFBA)
    static let accent = color(light: 0x006B54, dark: 0x87DBC1)
    static let softAccent = color(light: 0xE4F2EB, dark: 0x28483F)

    static func color(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        }
    }

    static func label(_ text: String, size: CGFloat = 15, color: UIColor = secondary,
                      weight: UIFont.Weight = .regular, heading: Bool = false) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = UIFontMetrics(forTextStyle: heading ? .title2 : .body)
            .scaledFont(for: .systemFont(ofSize: size, weight: weight))
        label.adjustsFontForContentSizeCategory = true
        label.textColor = color
        label.numberOfLines = 0
        if heading { label.accessibilityTraits.insert(.header) }
        return label
    }

    static func stack(spacing: CGFloat = 12) -> UIStackView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = spacing
        return stack
    }

    static func card(_ content: UIStackView, color: UIColor = surface, inset: CGFloat = 20) -> UIView {
        let card = UIView()
        card.backgroundColor = color
        card.layer.cornerRadius = 24
        card.layer.cornerCurve = .continuous
        content.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: inset),
            content.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -inset),
            content.topAnchor.constraint(equalTo: card.topAnchor, constant: inset),
            content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -inset),
        ])
        return card
    }
}

// Constraints let long release filenames and accessibility text determine the row height.
private final class HostActionButton: UIButton {
    func configure(title: String, symbol: String, primary: Bool = false) {
        backgroundColor = primary ? HostStyle.accent : HostStyle.softAccent
        layer.cornerRadius = 16
        layer.cornerCurve = .continuous
        let foreground = primary ? HostStyle.background : HostStyle.accent
        let text = HostStyle.label(title, color: foreground, weight: .semibold)
        let icon = UIImageView(image: UIImage(systemName: symbol))
        icon.tintColor = foreground
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 22).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 22).isActive = true
        let row = UIStackView(arrangedSubviews: [icon, text])
        row.alignment = .center
        row.spacing = 12
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 16),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -16),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 54),
        ])
        accessibilityLabel = title
        isAccessibilityElement = true
    }

    override var isEnabled: Bool { didSet { alpha = isEnabled ? 1 : 0.45 } }
    override var isHighlighted: Bool { didSet { alpha = isHighlighted ? 0.65 : (isEnabled ? 1 : 0.45) } }
}

// Keep winit's controller and rendering view intact as a child. Only this host
// container chooses the game's allowed orientations; UIKit still owns geometry.
private final class RuntimeOrientationViewController: UIViewController {
    private let content: UIViewController
    private var orientationMask: UIInterfaceOrientationMask = .allButUpsideDown

    init(content: UIViewController) {
        self.content = content
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func loadView() {
        view = UIView()
        addChild(content)
        content.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content.view)
        NSLayoutConstraint.activate([
            content.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.view.topAnchor.constraint(equalTo: view.topAnchor),
            content.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        content.didMove(toParent: self)
    }

    override var shouldAutorotate: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientationMask }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        orientationMask == .landscape ? .landscapeRight : .portrait
    }
    override var childForStatusBarHidden: UIViewController? { content }
    override var childForHomeIndicatorAutoHidden: UIViewController? { content }
    override var childForScreenEdgesDeferringSystemGestures: UIViewController? { content }

    func applyOrientation(_ orientation: String) {
        switch orientation {
        case "landscape": orientationMask = .landscape
        case "portrait": orientationMask = .portrait
        default: orientationMask = .allButUpsideDown
        }
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            if let scene = view.window?.windowScene {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientationMask)) { error in
                    NSLog("Could not update game orientation: %@", error.localizedDescription)
                }
                return
            }
        }
        // Legacy application windows can have no UIWindowScene, including on iOS 16+.
        UIViewController.attemptRotationToDeviceOrientation()
    }
}

final class HostCoordinator {
    static let shared = HostCoordinator()

    private(set) var store: PackageStore?
    private var launcherWindow: UIWindow?

    private init() {}

    func configure(store: PackageStore) {
        self.store = store
    }

    func presentLauncher(attempts: Int = 40) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            guard let runtimeWindow = self.runtimeWindow() else {
                if attempts > 0 { self.presentLauncher(attempts: attempts - 1) }
                return
            }
            guard let store = self.store else { return }
            (runtimeWindow.rootViewController as? RuntimeOrientationViewController)?.applyOrientation("auto")

            let launcher = HostLauncherViewController(store: store)
            launcher.tabBarItem = UITabBarItem(title: hostText("Home"), image: UIImage(systemName: "house"), tag: 0)
            let settings = HostSettingsViewController(style: .insetGrouped)
            settings.tabBarItem = UITabBarItem(title: hostText("Settings"), image: UIImage(systemName: "gearshape"), tag: 1)
            let tabs = UITabBarController()
            tabs.viewControllers = [launcher, settings]
            tabs.tabBar.tintColor = HostStyle.accent
            tabs.tabBar.unselectedItemTintColor = HostStyle.secondary
            let appearance = UITabBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = HostStyle.surface
            appearance.shadowColor = .clear
            tabs.tabBar.standardAppearance = appearance
            if #available(iOS 15.0, *) { tabs.tabBar.scrollEdgeAppearance = appearance }

            let root = UIViewController()
            root.view.backgroundColor = HostStyle.background
            root.addChild(tabs)
            tabs.view.translatesAutoresizingMaskIntoConstraints = false
            root.view.addSubview(tabs.view)
            NSLayoutConstraint.activate([
                tabs.view.topAnchor.constraint(equalTo: root.view.topAnchor),
                tabs.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
                tabs.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor),
                tabs.view.bottomAnchor.constraint(equalTo: root.view.safeAreaLayoutGuide.bottomAnchor),
            ])
            tabs.didMove(toParent: root)

            let window: UIWindow
            if let scene = runtimeWindow.windowScene {
                window = UIWindow(windowScene: scene)
            } else {
                window = UIWindow(frame: UIScreen.main.bounds)
            }
            window.rootViewController = root
            window.windowLevel = .alert + 1
            self.launcherWindow = window
            self.applyInterfaceStyle()
            window.makeKeyAndVisible()
        }
    }

    func returnToLauncher() {
        DispatchQueue.main.async {
            (self.runtimeWindow()?.rootViewController as? RuntimeOrientationViewController)?.applyOrientation("auto")
            if let window = self.launcherWindow {
                window.isHidden = false
                window.makeKeyAndVisible()
            } else {
                self.presentLauncher()
            }
        }
    }

    func activate(config: EngineConfig) throws {
        let result = config.script.entry.withCString { game_runtime_switch_script($0) }
        guard result == 0 else { throw HostFailure(hostText("The runtime could not activate the selected script")) }
        let runtime = runtimeWindow()
        launcherWindow?.isHidden = true
        launcherWindow?.rootViewController = nil
        launcherWindow = nil
        runtime?.makeKeyAndVisible()
        if let runtime = runtime, let content = runtime.rootViewController {
            let controller: RuntimeOrientationViewController
            if let existing = content as? RuntimeOrientationViewController {
                controller = existing
            } else {
                controller = RuntimeOrientationViewController(content: content)
                runtime.rootViewController = controller
            }
            controller.applyOrientation(config.mobile?.orientation ?? "auto")
        }
    }

    func applyInterfaceStyle() {
        let dark = UserDefaults.standard.bool(forKey: hostDarkModeDefaultsKey)
        launcherWindow?.overrideUserInterfaceStyle = dark ? .dark : .light
    }

    private func runtimeWindow() -> UIWindow? {
        var fallback: UIWindow?
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene, scene.activationState != .unattached else { continue }
            for candidate in windowScene.windows where candidate !== launcherWindow {
                if candidate.isKeyWindow { return candidate }
                if fallback == nil { fallback = candidate }
            }
        }
        if let fallback { return fallback }
        return UIApplication.shared.windows.first { $0 !== launcherWindow }
    }
}

final class HostSettingsViewController: UITableViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = hostText("Settings")
        tableView.backgroundColor = HostStyle.background
        tableView.separatorStyle = .none
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 88
        let heading = HostStyle.stack(spacing: 10)
        heading.addArrangedSubview(HostStyle.label(hostText("MAKE IT YOURS"), size: 12, color: HostStyle.accent,
                                                 weight: .semibold))
        heading.addArrangedSubview(HostStyle.label(hostText("Settings"), size: 32, color: HostStyle.primary,
                                                 weight: .semibold, heading: true))
        heading.addArrangedSubview(HostStyle.label(hostText("A comfortable space to play.")))
        tableView.tableHeaderView = HostStyle.card(heading, color: HostStyle.background, inset: 24)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let header = tableView.tableHeaderView else { return }
        let width = tableView.bounds.width
        let size = header.systemLayoutSizeFitting(
            CGSize(width: width, height: 0), withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel)
        if header.frame.width != width || header.frame.height != size.height {
            header.frame = CGRect(x: 0, y: 0, width: width, height: size.height)
            tableView.tableHeaderView = header
        }
    }

    override func numberOfSections(in tableView: UITableView) -> Int { 1 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        hostText("Appearance")
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        hostText("Bevy RuneWeave\nA home for small worlds and big ideas.")
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let identifier = "DarkModeCell"
        let cell = tableView.dequeueReusableCell(withIdentifier: identifier) ??
            UITableViewCell(style: .subtitle, reuseIdentifier: identifier)
        let toggle = (cell.accessoryView as? UISwitch) ?? UISwitch()
        toggle.removeTarget(nil, action: nil, for: .valueChanged)
        toggle.addTarget(self, action: #selector(darkModeChanged(_:)), for: .valueChanged)
        toggle.isOn = UserDefaults.standard.bool(forKey: hostDarkModeDefaultsKey)
        toggle.onTintColor = HostStyle.accent
        toggle.accessibilityLabel = hostText("Dark mode")
        cell.accessoryView = toggle
        cell.backgroundColor = HostStyle.surface
        cell.textLabel?.text = hostText("Dark mode")
        cell.textLabel?.textColor = HostStyle.primary
        cell.textLabel?.font = .preferredFont(forTextStyle: .headline)
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.text = hostText("A softer glow after hours.")
        cell.detailTextLabel?.textColor = HostStyle.secondary
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .subheadline)
        cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        return cell
    }

    @objc private func darkModeChanged(_ sender: UISwitch) {
        UserDefaults.standard.set(sender.isOn, forKey: hostDarkModeDefaultsKey)
        HostCoordinator.shared.applyInterfaceStyle()
    }
}

final class HostLauncherViewController: UIViewController, UITextFieldDelegate {
    private let store: PackageStore
    private var remoteAssets: [RemoteAsset] = []
    private var remoteButtons: [HostActionButton] = []
    private let remoteAssetsStack = UIStackView()
    private let remoteAssetsStatus = UILabel()
    private let urlField = UITextField()
    private let downloadButton = HostActionButton(type: .custom)
    private let launchButton = HostActionButton(type: .custom)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let statusLabel = UILabel()
    private let installedTitle = HostStyle.label(hostText("Your next adventure awaits"), size: 19,
                                                color: HostStyle.primary, weight: .semibold)
    private let installedDetail = HostStyle.label(hostText("Choose a release below to get started."), size: 14)
    private let statusRow = UIStackView()
    private let scroll = UIScrollView()
    private var busy = false

    init(store: PackageStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = HostStyle.background
        view.tintColor = HostStyle.accent
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        view.addSubview(scroll)
        let canvas = UIView()
        canvas.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(canvas)
        let content = HostStyle.stack(spacing: 0)
        content.translatesAutoresizingMaskIntoConstraints = false
        canvas.addSubview(content)

        let brand = HostStyle.label("RUNEWEAVE  /  iOS", size: 12, color: HostStyle.accent, weight: .semibold)
        add(brand, to: content, spacing: 12)
        let hero = HostStyle.stack(spacing: 12)
        hero.addArrangedSubview(HostStyle.label(hostText("PLAY. CREATE. EXPLORE."), size: 11,
                                              color: UIColor(red: 0.66, green: 0.87, blue: 0.78, alpha: 1),
                                              weight: .semibold))
        hero.addArrangedSubview(HostStyle.label(hostText("A little world.\nEndless possibilities."), size: 30,
                                              color: .white, weight: .semibold, heading: true))
        hero.addArrangedSubview(HostStyle.label(hostText("Discover a game and make it your own."),
                                              color: UIColor(red: 0.76, green: 0.86, blue: 0.82, alpha: 1)))
        add(HostStyle.card(hero, color: UIColor(red: 0.07, green: 0.24, blue: 0.20, alpha: 1), inset: 24),
            to: content, spacing: 24)

        spinner.hidesWhenStopped = true
        spinner.color = HostStyle.accent
        spinner.setContentHuggingPriority(.required, for: .horizontal)
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = HostStyle.secondary
        statusLabel.numberOfLines = 0
        statusRow.axis = .horizontal
        statusRow.alignment = .center
        statusRow.spacing = 12
        statusRow.addArrangedSubview(spinner)
        statusRow.addArrangedSubview(statusLabel)
        statusRow.isHidden = true
        add(statusRow, to: content, spacing: 16)

        add(section(hostText("Your space")), to: content, spacing: 12)
        let installed = HostStyle.stack(spacing: 6)
        installed.addArrangedSubview(installedTitle)
        installed.addArrangedSubview(installedDetail)
        installed.setCustomSpacing(18, after: installedDetail)
        configureButton(launchButton, title: hostText("Start installed game"), symbol: "play",
                        action: #selector(launchInstalled))
        installed.addArrangedSubview(launchButton)
        add(HostStyle.card(installed), to: content, spacing: 28)

        add(section(hostText("Discover")), to: content, spacing: 6)
        remoteAssetsStatus.font = UIFontMetrics.default.scaledFont(for: .systemFont(ofSize: 13))
        remoteAssetsStatus.adjustsFontForContentSizeCategory = true
        remoteAssetsStatus.textColor = HostStyle.secondary
        remoteAssetsStatus.numberOfLines = 0
        add(remoteAssetsStatus, to: content, spacing: 12)
        remoteAssetsStack.axis = .vertical
        remoteAssetsStack.spacing = 10
        add(remoteAssetsStack, to: content, spacing: 28)

        let custom = HostStyle.stack(spacing: 12)
        custom.addArrangedSubview(HostStyle.label(hostText("Have a package link?"), size: 19,
                                                color: HostStyle.primary, weight: .semibold))
        custom.addArrangedSubview(HostStyle.label(hostText("Bring your own game with an HTTPS ZIP link."), size: 14))
        urlField.placeholder = "https://…/game.zip"
        urlField.accessibilityLabel = hostText("HTTPS asset package URL")
        urlField.keyboardType = .URL
        urlField.autocapitalizationType = .none
        urlField.autocorrectionType = .no
        urlField.returnKeyType = .go
        urlField.clearButtonMode = .whileEditing
        urlField.backgroundColor = HostStyle.background
        urlField.textColor = HostStyle.primary
        urlField.font = .preferredFont(forTextStyle: .body)
        urlField.adjustsFontForContentSizeCategory = true
        urlField.layer.cornerRadius = 14
        urlField.delegate = self
        urlField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        urlField.leftViewMode = .always
        urlField.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
        custom.addArrangedSubview(urlField)
        configureButton(downloadButton, title: hostText("Download and start"), symbol: "arrow.down.to.line",
                        primary: true, action: #selector(downloadCustom))
        custom.addArrangedSubview(downloadButton)
        add(HostStyle.card(custom), to: content, spacing: 24)
        let footer = HostStyle.label(hostText("Powered by Bevy RuneWeave"), size: 12)
        footer.textAlignment = .center
        content.addArrangedSubview(footer)

        let preferredWidth = content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            canvas.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            canvas.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            canvas.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            canvas.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            canvas.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            content.centerXAnchor.constraint(equalTo: canvas.centerXAnchor),
            content.leadingAnchor.constraint(greaterThanOrEqualTo: canvas.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(lessThanOrEqualTo: canvas.trailingAnchor, constant: -20),
            content.topAnchor.constraint(equalTo: canvas.topAnchor, constant: 24),
            content.bottomAnchor.constraint(equalTo: canvas.bottomAnchor, constant: -28),
            content.widthAnchor.constraint(lessThanOrEqualToConstant: 640), preferredWidth,
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)),
                                               name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        updateInstalledState()
        reloadRemoteAssets()
    }

    private func section(_ title: String) -> UILabel {
        HostStyle.label(title, size: 21, color: HostStyle.primary, weight: .semibold, heading: true)
    }

    private func add(_ child: UIView, to stack: UIStackView, spacing: CGFloat) {
        stack.addArrangedSubview(child)
        stack.setCustomSpacing(spacing, after: child)
    }

    @objc private func keyboardChanged(_ notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let window = view.window else { return }
        let local = scroll.convert(window.convert(frame, from: window.screen.coordinateSpace), from: window)
        let overlap = scroll.bounds.intersection(local)
        let bottom = overlap.isNull || local.maxY < scroll.bounds.maxY ? 0 : overlap.height
        scroll.contentInset.bottom = bottom
        scroll.verticalScrollIndicatorInsets.bottom = bottom
        if urlField.isFirstResponder {
            scroll.scrollRectToVisible(urlField.convert(urlField.bounds, to: scroll).insetBy(dx: 0, dy: -16),
                                       animated: !UIAccessibility.isReduceMotionEnabled)
        }
    }

    private func configureButton(_ button: HostActionButton, title: String,
                                 symbol: String = "arrow.down.to.line", primary: Bool = false,
                                 action: Selector) {
        button.configure(title: title, symbol: symbol, primary: primary)
        button.addTarget(self, action: action, for: .touchUpInside)
    }

    @objc private func reloadRemoteAssets() {
        remoteAssetsStatus.text = hostText("Finding the latest release…")
        remoteAssetsStack.arrangedSubviews.forEach {
            remoteAssetsStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        remoteButtons.removeAll()
        ReleaseClient.shared.loadLatest { [weak self] result in
            DispatchQueue.main.async { self?.showRemoteAssets(result) }
        }
    }

    private func showRemoteAssets(_ result: Result<RemoteRelease, Error>) {
        switch result {
        case let .success(release):
            remoteAssets = release.assets
            let tag = release.tag == "direct downloads" ? hostText("direct downloads") : release.tag
            remoteAssetsStatus.text = release.assets.isEmpty
                ? hostText("No assets in this release. You can use a package link below.") : hostText("Latest release · {tag}", tag)
            for (index, asset) in release.assets.enumerated() {
                let button = HostActionButton(type: .custom)
                let detail = asset.size > 0 ? hostText("{size} · Download", formattedByteCount(asset.size)) : hostText("Download release asset")
                configureButton(button, title: "\(asset.name)\n\(detail)",
                                action: #selector(downloadPreset(_:)))
                button.isEnabled = !busy
                button.tag = index
                remoteButtons.append(button)
                remoteAssetsStack.addArrangedSubview(button)
            }
        case let .failure(error):
            remoteAssetsStatus.text = error.localizedDescription
            let retry = HostActionButton(type: .custom)
            configureButton(retry, title: hostText("Try again"), action: #selector(reloadRemoteAssets))
            retry.isEnabled = !busy
            remoteButtons.append(retry)
            remoteAssetsStack.addArrangedSubview(retry)
        }
    }

    private func setBusy(_ busy: Bool, status: String) {
        self.busy = busy
        urlField.isEnabled = !busy
        downloadButton.isEnabled = !busy
        launchButton.isEnabled = !busy && (try? store.installedConfig()) != nil
        remoteButtons.forEach { $0.isEnabled = !busy }
        busy ? spinner.startAnimating() : spinner.stopAnimating()
        statusLabel.text = status
        statusRow.isHidden = status.isEmpty
        if busy {
            view.layoutIfNeeded()
            scroll.scrollRectToVisible(statusRow.convert(statusRow.bounds, to: scroll),
                                       animated: !UIAccessibility.isReduceMotionEnabled)
            UIAccessibility.post(notification: .announcement, argument: status)
        }
    }

    private func updateInstalledState() {
        guard let config = try? store.installedConfig() else {
            launchButton.isEnabled = false
            installedTitle.text = hostText("Your next adventure awaits")
            installedDetail.text = hostText("Choose a release below to get started.")
            return
        }
        launchButton.isEnabled = !busy
        installedTitle.text = config.name
        installedDetail.text = hostText("Ready to play · v{version} · {language}", config.version, config.script.language)
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: hostText("Could not start game"), message: error.localizedDescription,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: hostText("OK"), style: .default))
        present(alert, animated: true)
    }

    @objc private func downloadPreset(_ sender: UIButton) {
        guard remoteAssets.indices.contains(sender.tag) else {
            showError(HostFailure(hostText("The selected release asset is no longer available")))
            return
        }
        let asset = remoteAssets[sender.tag]
        urlField.text = asset.url.absoluteString
        download(url: asset.url)
    }

    @objc private func downloadCustom() {
        let raw = urlField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else {
            showError(HostFailure(hostText("Enter a valid HTTPS URL")))
            return
        }
        download(url: url)
    }

    private func download(url: URL) {
        guard !busy else { return }
        view.endEditing(true)
        setBusy(true, status: hostText("Downloading package..."))
        ReleaseClient.shared.download(url) { [weak self] result in
            guard let self else { return }
            let installed = result.flatMap { archive in Result { try self.store.install(archive: archive) } }
            DispatchQueue.main.async {
                switch installed {
                case let .success(config):
                    self.activate(config)
                case let .failure(error):
                    self.setBusy(false, status: "")
                    self.showError(error)
                    self.updateInstalledState()
                }
            }
        }
    }

    @objc private func launchInstalled() {
        do {
            setBusy(true, status: hostText("Starting installed game..."))
            activate(try store.installedConfig())
        } catch {
            setBusy(false, status: "")
            showError(error)
            updateInstalledState()
        }
    }

    private func activate(_ config: EngineConfig) {
        do {
            try HostCoordinator.shared.activate(config: config)
        } catch {
            setBusy(false, status: "")
            showError(error)
            updateInstalledState()
        }
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        downloadCustom()
        return true
    }
}
