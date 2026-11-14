import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

test("native iOS download validation accepts large games and preserves response and ZIP limits", {
  skip: process.platform !== "darwin" ? "Requires Apple's Foundation and Swift toolchain" : false,
}, () => {
  const outputRoot = join(root, "dist/ios-download-tests");
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, "run-"));
  const driver = join(directory, "main.swift");
  const executable = join(directory, "download-tests");
  // The standalone native test executable needs the same message catalog as the app.
  // Keep assertions in English regardless of the developer machine's preferred language.
  for (const language of ["en", "zh-Hans"]) {
    cpSync(join(root, "examples/ios-demo-host/Resources/en.lproj"), join(directory, `${language}.lproj`), { recursive: true });
  }
  writeFileSync(driver, String.raw`
import Foundation

let client = ReleaseClient.shared
func response(_ status: Int = 200, _ scheme: String = "https") -> HTTPURLResponse {
    HTTPURLResponse(url: URL(string: "\(scheme)://example.test/game.zip")!,
                    statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
}
func validate(_ data: Data?, _ response: URLResponse? = response(),
              _ error: Error? = nil, _ limit: Int = maxArchiveBytes) -> Result<Data, Error> {
    client.validatedData(data: data, response: response, error: error, maximumBytes: limit)
}
func failure(_ result: Result<Data, Error>) -> String {
    if case let .failure(error) = result { return error.localizedDescription }
    fatalError("Expected validation failure")
}
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    print("PASS: \(message)")
}

let largeGame = Data(repeating: 0x5a, count: 65 * 1024 * 1024)
check((try! validate(largeGame).get()).count == largeGame.count, "ZIP larger than the former 64 MiB limit")
check(failure(validate(largeGame, response(), nil, 64 * 1024 * 1024)).contains("too large"), "reproduces the old capacity failure")
let boundary = Data(repeating: 1, count: 1024)
check((try! validate(boundary, response(), nil, boundary.count).get()) == boundary, "exact size limit is accepted")
let oversized = failure(validate(boundary, response(), nil, boundary.count - 1))
check(oversized.contains("too large") && oversized.contains("maximum"), "oversize includes size and limit")
check(failure(validate(nil)).contains("invalid size"), "missing response data is rejected")
check(failure(validate(Data())).contains("invalid size"), "empty response data is rejected")
check(failure(validate(boundary, response(404))).contains("404"), "HTTP errors remain rejected")
check(failure(validate(boundary, response(200, "http"))).contains("HTTP"), "insecure redirects remain rejected")
check(failure(validate(boundary, nil)).contains("HTTP"), "missing HTTP response is rejected")
let networkError = NSError(domain: "download-test", code: 9, userInfo: [NSLocalizedDescriptionKey: "network interrupted"])
check(failure(validate(boundary, response(), networkError)) == "network interrupted", "network errors are preserved")
let metadata = Data(repeating: 1, count: 2 * 1024 * 1024 + 1)
check(failure(validate(metadata, response(), nil, 2 * 1024 * 1024)).contains("too large"), "release metadata retains its 2 MiB limit")
check(maxArchiveBytes == 256 * 1024 * 1024 && maxUnpackedBytes == 256 * 1024 * 1024,
      "archive capacity grows while extraction budget stays bounded")

// A minimal directory claiming an entry larger than the extraction budget must fail
// before allocating or decompressing its declared contents.
var zip = Data(repeating: 0, count: 30)
func append16(_ value: Int, to bytes: inout Data) {
    bytes.append(UInt8(value & 255)); bytes.append(UInt8((value >> 8) & 255))
}
func append32(_ value: Int, to bytes: inout Data) {
    append16(value & 65535, to: &bytes); append16((value >> 16) & 65535, to: &bytes)
}
zip[0] = 0x50; zip[1] = 0x4b; zip[2] = 3; zip[3] = 4
var central = Data()
append32(0x02014b50, to: &central)
central.append(Data(repeating: 0, count: 20))
append32(maxUnpackedBytes + 1, to: &central)
append16(1, to: &central)
central.append(Data(repeating: 0, count: 16))
central.append(0x61)
zip.append(central)
append32(0x06054b50, to: &zip)
append16(0, to: &zip); append16(0, to: &zip)
append16(1, to: &zip); append16(1, to: &zip)
append32(central.count, to: &zip); append32(30, to: &zip); append16(0, to: &zip)
let destination = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("extracted")
do {
    try ZipInstaller.extract(zip, to: destination)
    fatalError("Expected ZIP extraction limit failure")
} catch {
    check(error.localizedDescription.contains("extraction limits"), "ZIP extraction budget remains enforced")
}

if CommandLine.arguments.count > 2 {
    let archive = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
    let accepted = try validate(archive).get()
    let target = destination.appendingPathComponent("release")
    try ZipInstaller.extract(accepted, to: target)
    let config = try validateAssets(at: target)
    check(!config.name.isEmpty, "actual release ZIP validates and extracts with a valid game entry")
    print("Release archive bytes: \(archive.count), game: \(config.name)")
}
`);
  execFileSync("xcrun", [
    "swiftc", "-swift-version", "5",
    "-import-objc-header", join(root, "examples/ios-demo-host/Sources/BevyRuneweaveHost-Bridging-Header.h"),
    "-I", join(root, "include"), "-lz",
    ...["HostSupport.swift", "ReleaseClient.swift", "ZipInstaller.swift"].map((file) =>
      join(root, "examples/ios-demo-host/Sources", file)),
    driver, "-o", executable,
  ], { cwd: root, stdio: "pipe" });
  const args = [directory];
  if (process.env.RUNEWEAVE_IOS_TEST_ARCHIVE) args.push(resolve(process.env.RUNEWEAVE_IOS_TEST_ARCHIVE));
  const output = execFileSync(executable, args, { cwd: root, encoding: "utf8" });
  process.stdout.write(output);
  assert.equal((output.match(/^PASS:/gm) ?? []).length, args.length > 1 ? 14 : 13);
});
