import Darwin
import Foundation

private func runtimeExitCallback() {
    HostCoordinator.shared.returnToLauncher()
}

private func runHost() -> Int32 {
    do {
        let store = try PackageStore()
        try store.installBundledAssetsIfNeeded()
        _ = try validateAssets(at: store.installedAssets)
        HostCoordinator.shared.configure(store: store)
        game_runtime_set_exit_callback(runtimeExitCallback)
        HostCoordinator.shared.presentLauncher()
        return store.installedAssets.path.withCString { assets in
            bootstrapScriptName.withCString { script in
                game_runtime_run_with_assets(assets, script)
            }
        }
    } catch {
        NSLog("Bevy RuneWeave host: %@", error.localizedDescription)
        return 10
    }
}

exit(runHost())
