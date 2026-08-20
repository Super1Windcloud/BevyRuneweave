import Foundation

let bootstrapScriptName = "host-bootstrap.js"
let installedMarkerName = ".installed-package"
let hostDarkModeDefaultsKey = "host.darkMode"
let maxArchiveBytes = 64 * 1024 * 1024
let maxUnpackedBytes = 256 * 1024 * 1024
let maxArchiveEntries = 10_000

struct HostFailure: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

struct EngineConfig: Decodable {
    struct Script: Decodable {
        let language: String
        let entry: String
    }

    let schemaVersion: Int
    let name: String
    let version: String
    let script: Script
}

func safeRelativePath(_ path: String, allowTrailingSlash: Bool = false) -> Bool {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\") else { return false }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    for (index, part) in parts.enumerated() {
        if allowTrailingSlash && index == parts.count - 1 && part.isEmpty { continue }
        if part.isEmpty || part == "." || part == ".." { return false }
    }
    return true
}

func validateAssets(at assets: URL) throws -> EngineConfig {
    let configURL = assets.appendingPathComponent("engineConfig.json")
    let config = try JSONDecoder().decode(EngineConfig.self, from: Data(contentsOf: configURL))
    guard config.schemaVersion == 1 else { throw HostFailure("Unsupported engineConfig schemaVersion") }
    guard !config.name.isEmpty, !config.version.isEmpty else {
        throw HostFailure("engineConfig name and version must not be empty")
    }
    guard ["js", "typescript", "lua"].contains(config.script.language) else {
        throw HostFailure("Unsupported script language")
    }
    let entry = config.script.entry
    guard safeRelativePath(entry), !entry.hasSuffix("/") else {
        throw HostFailure("script.entry must stay inside assets")
    }
    let fileExtension = (entry as NSString).pathExtension.lowercased()
    let isLua = config.script.language == "lua" && fileExtension == "lua"
    let isQuickJS = ["js", "typescript"].contains(config.script.language) &&
        ["js", "mjs"].contains(fileExtension)
    guard isLua || isQuickJS else {
        throw HostFailure("script language does not match the entry extension")
    }
    guard FileManager.default.fileExists(atPath: assets.appendingPathComponent(entry).path) else {
        throw HostFailure("Script entry does not exist: \(entry)")
    }
    return config
}

func formattedByteCount(_ bytes: Int64) -> String {
    let formatter = ByteCountFormatter()
    formatter.allowedUnits = [.useKB, .useMB]
    formatter.countStyle = .file
    formatter.includesUnit = true
    formatter.isAdaptive = true
    return formatter.string(fromByteCount: bytes)
}
