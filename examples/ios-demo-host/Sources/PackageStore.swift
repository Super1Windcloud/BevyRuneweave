import Foundation

final class PackageStore {
    let installedAssets: URL
    private let files = FileManager.default

    init() throws {
        let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
        let root = support.appendingPathComponent("BevyRuneweave", isDirectory: true)
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        installedAssets = root.appendingPathComponent("runtime-assets", isDirectory: true)
    }

    func installedConfig() throws -> EngineConfig {
        let marker = installedAssets.appendingPathComponent(installedMarkerName)
        guard files.fileExists(atPath: marker.path) else { throw HostFailure("No game package is installed") }
        return try validateAssets(at: installedAssets)
    }

    func installBundledAssetsIfNeeded() throws {
        if (try? validateAssets(at: installedAssets)) != nil {
            try copyBootstrapScript()
            return
        }
        guard let bundled = Bundle.main.resourceURL?.appendingPathComponent("assets", isDirectory: true) else {
            throw HostFailure("The bundled assets directory is missing")
        }
        _ = try validateAssets(at: bundled)
        let staging = installedAssets.deletingLastPathComponent()
            .appendingPathComponent("assets.staging", isDirectory: true)
        try? files.removeItem(at: staging)
        try? files.removeItem(at: installedAssets)
        do {
            try files.copyItem(at: bundled, to: staging)
            _ = try validateAssets(at: staging)
            try files.moveItem(at: staging, to: installedAssets)
            try copyBootstrapScript()
        } catch {
            try? files.removeItem(at: staging)
            throw error
        }
    }

    func install(archive: Data) throws -> EngineConfig {
        let root = installedAssets.deletingLastPathComponent()
        let staging = root.appendingPathComponent("assets.staging", isDirectory: true)
        let backup = root.appendingPathComponent("assets.backup", isDirectory: true)
        try? files.removeItem(at: staging)
        try? files.removeItem(at: backup)
        do {
            try ZipInstaller.extract(archive, to: staging)
            _ = try validateAssets(at: staging)
        } catch {
            try? files.removeItem(at: staging)
            throw error
        }

        if files.fileExists(atPath: installedAssets.path) {
            try files.moveItem(at: installedAssets, to: backup)
        }
        do {
            try files.moveItem(at: staging, to: installedAssets)
            try copyBootstrapScript()
            try Data("installed\n".utf8).write(
                to: installedAssets.appendingPathComponent(installedMarkerName),
                options: .atomic
            )
            let config = try validateAssets(at: installedAssets)
            try? files.removeItem(at: backup)
            return config
        } catch {
            try? files.removeItem(at: installedAssets)
            if files.fileExists(atPath: backup.path) {
                try? files.moveItem(at: backup, to: installedAssets)
            }
            throw error
        }
    }

    private func copyBootstrapScript() throws {
        guard let source = Bundle.main.resourceURL?
            .appendingPathComponent("assets", isDirectory: true)
            .appendingPathComponent(bootstrapScriptName), files.fileExists(atPath: source.path) else {
            throw HostFailure("The bundled host bootstrap script is missing")
        }
        let target = installedAssets.appendingPathComponent(bootstrapScriptName)
        try? files.removeItem(at: target)
        try files.copyItem(at: source, to: target)
    }
}
