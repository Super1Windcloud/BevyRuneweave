import Foundation

struct RemoteAsset: Decodable, Sendable {
    let name: String
    let url: URL
    let size: Int64

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

    private let apiRoot = URL(string: "https://api.github.com/repos/Super1Windcloud/BevyRuneweave")!
    private let session: URLSession

    private init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration)
    }

    func loadLatest(completion: @escaping (Result<RemoteRelease, Error>) -> Void) {
        #if !DEBUG
        completion(.success(fallbackRelease()))
        return
        #else
        request(apiRoot.appendingPathComponent("releases/latest"), as: LatestRelease.self) { result in
            switch result {
            case let .success(latest):
                completion(.success(RemoteRelease(tag: latest.tag, assets: latest.assets.sorted {
                    $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                })))
            case let .failure(error):
                print("GitHub release API unavailable, using direct downloads: \(error)")
                completion(.success(self.fallbackRelease()))
            }
        }
        #endif
    }

    func download(_ url: URL, completion: @escaping (Result<Data, Error>) -> Void) {
        var request = URLRequest(url: url)
        request.setValue("BevyRuneweave-iOS-Demo/0.1", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { data, response, error in
            completion(self.validatedData(data: data, response: response, error: error,
                                          maximumBytes: maxArchiveBytes))
        }.resume()
    }

    private func request<Value: Decodable & Sendable>(_ url: URL, as type: Value.Type,
                                           completion: @escaping (Result<Value, Error>) -> Void) {
        var request = URLRequest(url: url)
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

    private func validatedData(data: Data?, response: URLResponse?, error: Error?,
                               maximumBytes: Int) -> Result<Data, Error> {
        if let error { return .failure(error) }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              http.url?.scheme?.lowercased() == "https" else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return .failure(HostFailure("Remote asset request failed with HTTP \(status)"))
        }
        guard let data, !data.isEmpty, data.count <= maximumBytes else {
            return .failure(HostFailure("Remote asset response has an invalid size"))
        }
        return .success(data)
    }

    private func fallbackRelease() -> RemoteRelease {
        let root = URL(
            string: "https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download/"
        )!
        let names = [
            "script-squadron-typescript.zip",
            "script-squadron-js.zip",
            "script-squadron-lua.zip",
        ]
        return RemoteRelease(tag: "direct downloads", assets: names.map {
            RemoteAsset(name: $0, url: root.appendingPathComponent($0), size: 0)
        })
    }
}
