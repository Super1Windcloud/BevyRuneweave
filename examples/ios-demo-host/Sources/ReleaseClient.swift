import Foundation

struct RemoteAsset: Decodable, Sendable {
    let name: String
    let url: URL
    let size: Int64
    var presentation: GamePresentation? = nil

    enum CodingKeys: String, CodingKey {
        case name
        case url = "browser_download_url"
        case size
    }
}

struct RemoteRelease {
    let tag: String
    let assets: [RemoteAsset]
}

final class ReleaseClient {
    static let shared = ReleaseClient()

    private struct LatestRelease: Decodable, Sendable {
        let tag: String
        let assets: [RemoteAsset]

        enum CodingKeys: String, CodingKey {
            case tag = "tag_name"
            case assets
        }
    }

    private struct GameCatalog: Decodable, Sendable {
        let schemaVersion: Int
        let games: [String: GamePresentation]
    }

    private let apiRoot = URL(string: "https://api.github.com/repos/Super1Windcloud/BevyRuneweave")!
    private let directDownloads = URL(string: "https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download/")!
    private let catalogName = "game-catalog.json"
    private let session: URLSession

    private init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration)
    }

    func loadLatest(completion: @escaping (Result<RemoteRelease, Error>) -> Void) {
        #if !DEBUG
        loadDirectRelease(completion: completion)
        #else
        request(apiRoot.appendingPathComponent("releases/latest"), as: LatestRelease.self) { result in
            switch result {
            case let .success(latest):
                let assets = latest.assets.filter { $0.name != self.catalogName }.sorted {
                    $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                let catalog = latest.assets.first { $0.name == self.catalogName }?.url
                guard let catalog, catalog.absoluteString.hasPrefix(
                    "https://github.com/Super1Windcloud/BevyRuneweave/releases/download/"
                ) else {
                    completion(.success(RemoteRelease(tag: latest.tag, assets: assets)))
                    return
                }
                self.loadCatalog(catalog) { games in
                    let decorated = assets.map { asset in
                        var game = asset
                        game.presentation = games[asset.name]
                        return game
                    }
                    completion(.success(RemoteRelease(tag: latest.tag, assets: decorated)))
                }
            case let .failure(error):
                NSLog("GitHub release API unavailable, using direct downloads: %@", String(describing: error))
                self.loadDirectRelease(completion: completion)
            }
        }
        #endif
    }

    private func loadCatalog(_ url: URL, completion: @escaping ([String: GamePresentation]) -> Void) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { data, response, error in
            let result = self.validatedData(data: data, response: response, error: error, maximumBytes: 128 * 1024)
            guard let data = try? result.get(),
                  let catalog = try? JSONDecoder().decode(GameCatalog.self, from: data),
                  catalog.schemaVersion == 1 else {
                completion([:])
                return
            }
            completion(catalog.games.filter { name, _ in
                name.range(of: #"\A[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.zip\z"#, options: .regularExpression) != nil
            })
        }.resume()
    }

    /// Reports received and expected bytes on the main queue; expected is zero when unknown.
    func download(_ url: URL, progress: @escaping (Int64, Int64) -> Void,
                  completion: @escaping (Result<Data, Error>) -> Void) {
        var request = URLRequest(url: url)
        request.setValue("BevyRuneweave-iOS-Demo/0.1", forHTTPHeaderField: "User-Agent")
        var observation: NSKeyValueObservation?
        let task = session.dataTask(with: request) { data, response, error in
            observation?.invalidate()
            completion(self.validatedData(data: data, response: response, error: error,
                                          maximumBytes: maxArchiveBytes))
        }
        var lastReport = Date.distantPast
        observation = task.observe(\.countOfBytesReceived) { task, _ in
            let now = Date()
            guard now.timeIntervalSince(lastReport) >= 0.1 else { return }
            lastReport = now
            let received = task.countOfBytesReceived
            let expected = max(0, task.countOfBytesExpectedToReceive)
            DispatchQueue.main.async { progress(received, expected) }
        }
        task.resume()
    }

    private func request<Value: Decodable & Sendable>(_ url: URL, as type: Value.Type,
                                           completion: @escaping (Result<Value, Error>) -> Void) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("BevyRuneweave-iOS-Demo/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        #if DEBUG
        if let token = Bundle.main.object(forInfoDictionaryKey: "RuneweaveGitHubToken") as? String,
           !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        #endif
        session.dataTask(with: request) { data, response, error in
            let result = self.validatedData(data: data, response: response, error: error,
                                            maximumBytes: 2 * 1024 * 1024)
            completion(result.flatMap { bytes in
                Result { try JSONDecoder().decode(type, from: bytes) }
            })
        }.resume()
    }

    func validatedData(data: Data?, response: URLResponse?, error: Error?,
                       maximumBytes: Int) -> Result<Data, Error> {
        if let error { return .failure(error) }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              http.url?.scheme?.lowercased() == "https" else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return .failure(HostFailure(hostText("Remote asset request failed with HTTP {status}", String(status))))
        }
        guard let data, !data.isEmpty else {
            return .failure(HostFailure(hostText("Remote asset response has an invalid size")))
        }
        guard data.count <= maximumBytes else {
            return .failure(HostFailure(hostText("Remote asset is too large ({size}); maximum is {limit}",
                                                 formattedByteCount(Int64(data.count)),
                                                 formattedByteCount(Int64(maximumBytes)))))
        }
        return .success(data)
    }

    private func loadDirectRelease(completion: @escaping (Result<RemoteRelease, Error>) -> Void) {
        loadCatalog(directDownloads.appendingPathComponent(catalogName)) { games in
            let names = games.isEmpty ? [
                "script-squadron-typescript.zip",
                "script-squadron-js.zip",
                "script-squadron-lua.zip",
            ] : games.keys.sorted()
            completion(.success(RemoteRelease(tag: "direct downloads", assets: names.map {
                RemoteAsset(name: $0, url: self.directDownloads.appendingPathComponent($0),
                            size: 0, presentation: games[$0])
            })))
        }
    }
}
