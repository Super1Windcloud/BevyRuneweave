import UIKit

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

            let launcher = HostLauncherViewController(store: store)
            launcher.tabBarItem = UITabBarItem(title: "Home", image: UIImage(systemName: "house"), tag: 0)
            let settings = HostSettingsViewController(style: .insetGrouped)
            settings.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gearshape"), tag: 1)
            let tabs = UITabBarController()
            tabs.viewControllers = [launcher, settings]

            let root = UIViewController()
            root.view.backgroundColor = .systemBackground
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
        guard result == 0 else { throw HostFailure("The runtime could not activate the selected script") }
        let runtime = runtimeWindow()
        launcherWindow?.isHidden = true
        launcherWindow?.rootViewController = nil
        launcherWindow = nil
        runtime?.makeKeyAndVisible()
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
        title = "Settings"
        tableView.backgroundColor = .systemGroupedBackground
        let heading = UILabel(frame: CGRect(x: 24, y: 0, width: UIScreen.main.bounds.width - 48, height: 72))
        heading.text = "Settings"
        heading.font = .systemFont(ofSize: 28, weight: .semibold)
        heading.textColor = .label
        tableView.tableHeaderView = heading
    }

    override func numberOfSections(in tableView: UITableView) -> Int { 1 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        "Appearance"
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let identifier = "DarkModeCell"
        let cell = tableView.dequeueReusableCell(withIdentifier: identifier) ??
            UITableViewCell(style: .default, reuseIdentifier: identifier)
        let toggle = (cell.accessoryView as? UISwitch) ?? UISwitch()
        toggle.removeTarget(nil, action: nil, for: .valueChanged)
        toggle.addTarget(self, action: #selector(darkModeChanged(_:)), for: .valueChanged)
        toggle.isOn = UserDefaults.standard.bool(forKey: hostDarkModeDefaultsKey)
        cell.accessoryView = toggle
        cell.textLabel?.text = "Dark mode"
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
    private var remoteButtons: [UIButton] = []
    private let remoteAssetsStack = UIStackView()
    private let remoteAssetsStatus = UILabel()
    private let urlField = UITextField()
    private let downloadButton = UIButton(type: .system)
    private let launchButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let statusLabel = UILabel()

    init(store: PackageStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        let content = UIStackView()
        content.translatesAutoresizingMaskIntoConstraints = false
        content.axis = .vertical
        content.spacing = 10
        scroll.addSubview(content)

        let title = label("Bevy RuneWeave", size: 28, color: .label)
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        content.addArrangedSubview(title)
        let subtitle = label("iOS host", size: 15, color: .secondaryLabel)
        content.addArrangedSubview(subtitle)
        content.setCustomSpacing(28, after: subtitle)
        let section = label("GitHub release assets", size: 16, color: .label)
        section.font = .systemFont(ofSize: 16, weight: .medium)
        content.addArrangedSubview(section)

        remoteAssetsStatus.font = .systemFont(ofSize: 14)
        remoteAssetsStatus.textColor = .secondaryLabel
        remoteAssetsStatus.numberOfLines = 0
        content.addArrangedSubview(remoteAssetsStatus)
        remoteAssetsStack.axis = .vertical
        remoteAssetsStack.spacing = 10
        content.addArrangedSubview(remoteAssetsStack)

        urlField.placeholder = "HTTPS asset package URL"
        urlField.keyboardType = .URL
        urlField.autocapitalizationType = .none
        urlField.autocorrectionType = .no
        urlField.returnKeyType = .go
        urlField.clearButtonMode = .whileEditing
        urlField.backgroundColor = .secondarySystemBackground
        urlField.textColor = .label
        urlField.layer.cornerRadius = 6
        urlField.delegate = self
        urlField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        urlField.leftViewMode = .always
        urlField.heightAnchor.constraint(equalToConstant: 52).isActive = true
        content.addArrangedSubview(urlField)

        configureButton(downloadButton, title: "Download and start", action: #selector(downloadCustom))
        downloadButton.backgroundColor = .systemBlue
        downloadButton.setTitleColor(.white, for: .normal)
        content.addArrangedSubview(downloadButton)
        configureButton(launchButton, title: "Start installed game", action: #selector(launchInstalled))
        content.addArrangedSubview(launchButton)

        spinner.hidesWhenStopped = true
        spinner.heightAnchor.constraint(equalToConstant: 42).isActive = true
        content.addArrangedSubview(spinner)
        statusLabel.font = .systemFont(ofSize: 14)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        content.addArrangedSubview(statusLabel)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 48),
            content.bottomAnchor.constraint(lessThanOrEqualTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
        ])
        updateInstalledState()
        reloadRemoteAssets()
    }

    private func label(_ text: String, size: CGFloat, color: UIColor) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size)
        label.textColor = color
        label.numberOfLines = 0
        return label
    }

    private func configureButton(_ button: UIButton, title: String, action: Selector) {
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        button.titleLabel?.numberOfLines = 2
        button.titleLabel?.textAlignment = .center
        button.backgroundColor = .secondarySystemBackground
        button.layer.cornerRadius = 6
        button.addTarget(self, action: action, for: .touchUpInside)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true
    }

    @objc private func reloadRemoteAssets() {
        remoteAssetsStatus.text = "Loading latest release..."
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
            remoteAssetsStatus.text = release.assets.isEmpty
                ? "Latest release has no assets" : "Latest release \(release.tag)"
            for (index, asset) in release.assets.enumerated() {
                let button = UIButton(type: .system)
                let detail = asset.size > 0 ? " (\(formattedByteCount(asset.size)))" : ""
                configureButton(button, title: "Download \(asset.name)\(detail)",
                                action: #selector(downloadPreset(_:)))
                button.tag = index
                remoteButtons.append(button)
                remoteAssetsStack.addArrangedSubview(button)
            }
        case let .failure(error):
            remoteAssetsStatus.text = error.localizedDescription
            let retry = UIButton(type: .system)
            configureButton(retry, title: "Refresh", action: #selector(reloadRemoteAssets))
            remoteAssetsStack.addArrangedSubview(retry)
        }
    }

    private func setBusy(_ busy: Bool, status: String) {
        urlField.isEnabled = !busy
        downloadButton.isEnabled = !busy
        launchButton.isEnabled = !busy && (try? store.installedConfig()) != nil
        remoteButtons.forEach { $0.isEnabled = !busy }
        busy ? spinner.startAnimating() : spinner.stopAnimating()
        statusLabel.text = status
    }

    private func updateInstalledState() {
        guard let config = try? store.installedConfig() else {
            launchButton.isEnabled = false
            statusLabel.text = "No game package installed"
            return
        }
        launchButton.isEnabled = true
        statusLabel.text = "Installed: \(config.name) \(config.version)"
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: "Could not start game", message: error.localizedDescription,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    @objc private func downloadPreset(_ sender: UIButton) {
        guard remoteAssets.indices.contains(sender.tag) else {
            showError(HostFailure("The selected release asset is no longer available"))
            return
        }
        let asset = remoteAssets[sender.tag]
        urlField.text = asset.url.absoluteString
        download(url: asset.url)
    }

    @objc private func downloadCustom() {
        let raw = urlField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else {
            showError(HostFailure("Enter a valid HTTPS URL"))
            return
        }
        download(url: url)
    }

    private func download(url: URL) {
        view.endEditing(true)
        setBusy(true, status: "Downloading package...")
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
            setBusy(true, status: "Starting installed game...")
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
