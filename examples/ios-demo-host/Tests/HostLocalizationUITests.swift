import XCTest
import UIKit

final class HostLocalizationUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.super1windcloud.runeweave.demo")

    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        app.terminate()
    }

    private func launch(_ language: String) {
        app.launchArguments = ["-AppleLanguages", "(\(language))"]
        app.launch()
    }

    private func capture(_ name: String) {
        // App screenshots are cropped against AX window coordinates, which can
        // retain a portrait origin after rotation on newer iOS releases.
        let screenshot = XCUIScreen.main.screenshot()
        print("Capture \(name): screen=\(screenshot.image.size), app=\(app.frame)")
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitForStableForeground(landscape: Bool) {
        var previous = CGRect.zero
        var changed = Date()
        let stable = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
            let frame = app.frame
            if frame != previous { previous = frame; changed = Date() }
            return app.state == .runningForeground && (frame.width > frame.height) == landscape
                && Date().timeIntervalSince(changed) >= 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [stable], timeout: 20), .completed)
    }

    func testEnglishChineseAndUnsupportedLanguageFallback() {
        for (language, home, settings, appearance) in [
            ("en", "Home", "Settings", "Dark mode"),
            ("zh-Hans", "首页", "设置", "深色模式"),
            ("fr", "Home", "Settings", "Dark mode")
        ] {
            launch(language)
            XCTAssertTrue(app.buttons[settings].firstMatch.waitForExistence(timeout: 30))
            capture("ios-host-\(language)")
            app.buttons[settings].firstMatch.tap()
            XCTAssertTrue(app.staticTexts[appearance].firstMatch.exists)
            capture("ios-settings-\(language)")
            app.buttons[home].firstMatch.tap()
            app.terminate()
        }
    }

    // Requires network access to the latest GitHub release.
    func testDiscoverListsEveryReleaseAsset() {
        launch("zh-Hans")
        let latest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "最新版本")).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: 30))
        let assets = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ".zip"))
        print("Discover assets: \(assets.count), window=\(app.windows.firstMatch.frame)")
        capture("ios-discover-top")
        for index in 0..<assets.count {
            let asset = assets.element(boundBy: index)
            for _ in 0..<8 where !asset.isHittable { app.swipeUp() }
            print("Discover asset \(index): \(asset.label.replacingOccurrences(of: "\n", with: " | ")) frame=\(asset.frame) hittable=\(asset.isHittable)")
            XCTAssertTrue(asset.isHittable, asset.label)
        }
        capture("ios-discover-bottom")
    }

    // Requires the current Ember Arena assets to be installed in the host's
    // private package store. This exercises the real embedded runtime, not a stub.
    func testInstalledGameTouchRotationAndBackgroundResume() {
        launch("zh-Hans")
        let start = app.buttons["启动已安装游戏"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 30))
        XCTAssertTrue(start.isEnabled)
        start.tap()
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: start)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 15), .completed)
        waitForStableForeground(landscape: true)
        capture("ios-game-title")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.515)).tap()
        capture("ios-game-heroes")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.90)).tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.58, dy: 0.525)).tap()
        capture("ios-game-landscape-start")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForStableForeground(landscape: true)
        capture("ios-game-landscape")
        XCUIDevice.shared.orientation = .portrait
        waitForStableForeground(landscape: true)
        capture("ios-game-portrait-rejected")
        XCUIDevice.shared.press(.home)
        app.activate()
        waitForStableForeground(landscape: true)
        capture("ios-game-resumed")
        XCTAssertEqual(app.state, .runningForeground)
    }
}
