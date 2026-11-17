//! The Cargo executable has no app bundle to supply a macOS Dock icon.
pub(crate) fn set() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(main_thread) = MainThreadMarker::new() else {
        eprintln!("Application icon must be set on the main thread");
        return;
    };
    let data = NSData::with_bytes(include_bytes!(
        "../../../assets/branding/bevy_launcher_icon_macos.png"
    ));
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        eprintln!("Cannot decode the embedded application icon");
        return;
    };
    // SAFETY: this startup hook runs on AppKit's main thread. Some guarantees
    // the setter's non-null requirement; NSApplication retains the image.
    unsafe {
        NSApplication::sharedApplication(main_thread).setApplicationIconImage(Some(&image));
    }
}
