import Foundation

// Honor the system/app language; all Chinese variants use the Simplified Chinese
// catalog and other languages fall back to English. Keep strings in native resources.
private let hostLanguageBundle: Bundle = {
    let language = Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") == true ? "zh-Hans" : "en"
    guard let path = Bundle.main.path(forResource: language, ofType: "lproj"),
          let bundle = Bundle(path: path) else { return .main }
    return bundle
}()

func hostText(_ key: String, _ arguments: String...) -> String {
    let format = hostLanguageBundle.localizedString(forKey: key, value: key, table: nil)
    guard !arguments.isEmpty else { return format }
    return String(format: format, locale: Locale.current, arguments: arguments.map { $0 as NSString })
}

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
    struct Mobile: Decodable {
        let orientation: String?
    }

    struct Script: Decodable {
        let language: String
        let entry: String
    }

    let schemaVersion: Int
    let name: String
    let version: String
    let script: Script
    let mobile: Mobile?
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
    guard config.schemaVersion == 1 else { throw HostFailure(hostText("Unsupported engineConfig schemaVersion")) }
    guard !config.name.isEmpty, !config.version.isEmpty else {
        throw HostFailure(hostText("engineConfig name and version must not be empty"))
    }
    guard ["auto", "portrait", "landscape"].contains(config.mobile?.orientation ?? "auto") else {
        throw HostFailure(hostText("mobile.orientation must be auto, portrait or landscape"))
    }
    guard ["js", "typescript", "lua"].contains(config.script.language) else {
        throw HostFailure(hostText("Unsupported script language"))
    }
    let entry = config.script.entry
    guard safeRelativePath(entry), !entry.hasSuffix("/") else {
        throw HostFailure(hostText("script.entry must stay inside assets"))
    }
    let fileExtension = (entry as NSString).pathExtension.lowercased()
    let isLua = config.script.language == "lua" && fileExtension == "lua"
    let isQuickJS = ["js", "typescript"].contains(config.script.language) &&
        ["js", "mjs"].contains(fileExtension)
    guard isLua || isQuickJS else {
        throw HostFailure(hostText("script language does not match the entry extension"))
    }
    guard FileManager.default.fileExists(atPath: assets.appendingPathComponent(entry).path) else {
        throw HostFailure(hostText("Script entry does not exist: {entry}", entry))
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
