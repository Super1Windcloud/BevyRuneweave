#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <zlib.h>

#include "game_runtime.h"

static NSString *const HostErrorDomain = @"io.github.super1windcloud.runeweave.host";
static NSString *const BootstrapScriptName = @"host-bootstrap.js";
static NSString *const InstalledMarkerName = @".installed-package";
static const NSUInteger MaxArchiveBytes = 64 * 1024 * 1024;
static const NSUInteger MaxUnpackedBytes = 256 * 1024 * 1024;
static const NSUInteger MaxArchiveEntries = 10000;

static NSError *hostError(NSInteger code, NSString *message) {
    return [NSError errorWithDomain:HostErrorDomain
                               code:code
                           userInfo:@{NSLocalizedDescriptionKey: message}];
}

static uint16_t read16(const uint8_t *bytes) {
    return (uint16_t)(bytes[0] | (bytes[1] << 8));
}

static uint32_t read32(const uint8_t *bytes) {
    return (uint32_t)(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
}

static BOOL safeRelativePath(NSString *path) {
    if (path.length == 0 || path.isAbsolutePath || [path containsString:@"\\"]) {
        return NO;
    }
    NSArray<NSString *> *parts = [path componentsSeparatedByString:@"/"];
    for (NSUInteger index = 0; index < parts.count; index++) {
        NSString *part = parts[index];
        BOOL trailingDirectoryMarker = index == parts.count - 1 && part.length == 0;
        if (!trailingDirectoryMarker && (part.length == 0 || [part isEqualToString:@"."] ||
                                         [part isEqualToString:@".."])) {
            return NO;
        }
    }
    return YES;
}

static NSData *inflateEntry(const uint8_t *bytes, NSUInteger compressedSize,
                            NSUInteger unpackedSize, NSError **error) {
    NSMutableData *output = [NSMutableData dataWithLength:MAX(unpackedSize, (NSUInteger)1)];
    z_stream stream = {0};
    stream.next_in = (Bytef *)bytes;
    stream.avail_in = (uInt)compressedSize;
    stream.next_out = output.mutableBytes;
    stream.avail_out = (uInt)output.length;
    if (inflateInit2(&stream, -MAX_WBITS) != Z_OK) {
        if (error) *error = hostError(30, @"Could not initialize ZIP decompression");
        return nil;
    }
    int status = inflate(&stream, Z_FINISH);
    inflateEnd(&stream);
    if (status != Z_STREAM_END || stream.total_out != unpackedSize) {
        if (error) *error = hostError(31, @"ZIP entry decompression failed");
        return nil;
    }
    output.length = unpackedSize;
    return output;
}

static BOOL extractZip(NSData *archive, NSString *destination, NSError **error) {
    const uint8_t *bytes = archive.bytes;
    NSUInteger length = archive.length;
    if (length < 22) {
        if (error) *error = hostError(32, @"Asset ZIP is truncated");
        return NO;
    }

    NSInteger endOffset = -1;
    NSInteger minimum = MAX((NSInteger)0, (NSInteger)length - 65557);
    for (NSInteger offset = (NSInteger)length - 22; offset >= minimum; offset--) {
        if (read32(bytes + offset) == 0x06054b50) {
            endOffset = offset;
            break;
        }
    }
    if (endOffset < 0) {
        if (error) *error = hostError(33, @"Asset ZIP has no central directory");
        return NO;
    }

    const uint8_t *end = bytes + endOffset;
    NSUInteger entries = read16(end + 10);
    NSUInteger centralSize = read32(end + 12);
    NSUInteger centralOffset = read32(end + 16);
    if (read16(end + 4) != 0 || read16(end + 6) != 0 || entries == 0 ||
        entries > MaxArchiveEntries || centralOffset + centralSize > length) {
        if (error) *error = hostError(34, @"Asset ZIP directory is invalid");
        return NO;
    }

    NSFileManager *files = NSFileManager.defaultManager;
    if (![files createDirectoryAtPath:destination withIntermediateDirectories:YES attributes:nil error:error]) {
        return NO;
    }
    NSUInteger cursor = centralOffset;
    NSUInteger totalUnpacked = 0;
    for (NSUInteger index = 0; index < entries; index++) {
        if (cursor + 46 > length || read32(bytes + cursor) != 0x02014b50) {
            if (error) *error = hostError(35, @"Asset ZIP entry header is invalid");
            return NO;
        }
        const uint8_t *header = bytes + cursor;
        uint16_t flags = read16(header + 8);
        uint16_t method = read16(header + 10);
        uint32_t expectedCrc = read32(header + 16);
        NSUInteger compressedSize = read32(header + 20);
        NSUInteger unpackedSize = read32(header + 24);
        NSUInteger nameLength = read16(header + 28);
        NSUInteger extraLength = read16(header + 30);
        NSUInteger commentLength = read16(header + 32);
        uint32_t externalAttributes = read32(header + 38);
        NSUInteger localOffset = read32(header + 42);
        NSUInteger next = cursor + 46 + nameLength + extraLength + commentLength;
        if (next > length || nameLength == 0 || (flags & 1) != 0 ||
            (method != 0 && method != 8) || compressedSize == UINT32_MAX ||
            unpackedSize == UINT32_MAX) {
            if (error) *error = hostError(36, @"Asset ZIP contains an unsupported entry");
            return NO;
        }

        NSString *name = [[NSString alloc] initWithBytes:header + 46
                                                   length:nameLength
                                                 encoding:NSUTF8StringEncoding];
        uint16_t unixMode = (uint16_t)(externalAttributes >> 16);
        if (name == nil || !safeRelativePath(name) || (unixMode & 0170000) == 0120000) {
            if (error) *error = hostError(37, @"Asset ZIP contains an unsafe entry path");
            return NO;
        }
        totalUnpacked += unpackedSize;
        if (totalUnpacked > MaxUnpackedBytes || localOffset + 30 > length ||
            read32(bytes + localOffset) != 0x04034b50) {
            if (error) *error = hostError(38, @"Asset ZIP exceeds its extraction limits");
            return NO;
        }

        NSString *target = [destination stringByAppendingPathComponent:name];
        if ([name hasSuffix:@"/"]) {
            if (![files createDirectoryAtPath:target withIntermediateDirectories:YES attributes:nil error:error]) {
                return NO;
            }
        } else {
            NSUInteger localNameLength = read16(bytes + localOffset + 26);
            NSUInteger localExtraLength = read16(bytes + localOffset + 28);
            NSUInteger dataOffset = localOffset + 30 + localNameLength + localExtraLength;
            if (dataOffset + compressedSize > length) {
                if (error) *error = hostError(39, @"Asset ZIP entry data is truncated");
                return NO;
            }
            NSData *data;
            if (method == 0) {
                if (compressedSize != unpackedSize) {
                    if (error) *error = hostError(40, @"Stored ZIP entry size is invalid");
                    return NO;
                }
                data = [NSData dataWithBytes:bytes + dataOffset length:unpackedSize];
            } else {
                data = inflateEntry(bytes + dataOffset, compressedSize, unpackedSize, error);
                if (data == nil) return NO;
            }
            uLong actualCrc = crc32(0L, Z_NULL, 0);
            actualCrc = crc32(actualCrc, data.bytes, (uInt)data.length);
            if ((uint32_t)actualCrc != expectedCrc) {
                if (error) *error = hostError(41, @"Asset ZIP entry checksum failed");
                return NO;
            }
            if (![files createDirectoryAtPath:target.stringByDeletingLastPathComponent
                    withIntermediateDirectories:YES attributes:nil error:error] ||
                ![data writeToFile:target options:NSDataWritingAtomic error:error]) {
                return NO;
            }
        }
        cursor = next;
    }
    return YES;
}

static NSDictionary *validateAssets(NSString *assets, NSError **error) {
    NSString *configPath = [assets stringByAppendingPathComponent:@"engineConfig.json"];
    NSData *data = [NSData dataWithContentsOfFile:configPath options:0 error:error];
    if (data == nil) return nil;

    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:error];
    if (![object isKindOfClass:NSDictionary.class]) {
        if (error) *error = hostError(50, @"engineConfig.json must contain an object");
        return nil;
    }
    NSDictionary *config = object;
    if ([config[@"schemaVersion"] integerValue] != 1) {
        if (error) *error = hostError(51, @"Unsupported engineConfig schemaVersion");
        return nil;
    }
    NSString *name = config[@"name"];
    NSString *version = config[@"version"];
    if (![name isKindOfClass:NSString.class] || name.length == 0 ||
        ![version isKindOfClass:NSString.class] || version.length == 0) {
        if (error) *error = hostError(52, @"engineConfig name and version must not be empty");
        return nil;
    }

    NSDictionary *script = config[@"script"];
    NSString *language = script[@"language"];
    NSString *entry = script[@"entry"];
    if (![script isKindOfClass:NSDictionary.class] ||
        ![@[@"js", @"typescript", @"lua"] containsObject:language]) {
        if (error) *error = hostError(53, @"Unsupported script language");
        return nil;
    }
    if (![entry isKindOfClass:NSString.class] || !safeRelativePath(entry) || [entry hasSuffix:@"/"]) {
        if (error) *error = hostError(54, @"script.entry must stay inside assets");
        return nil;
    }
    NSString *extension = entry.pathExtension.lowercaseString;
    BOOL isLua = [language isEqualToString:@"lua"] && [extension isEqualToString:@"lua"];
    BOOL isQuickJs = ([@[@"js", @"typescript"] containsObject:language] &&
                      [@[@"js", @"mjs"] containsObject:extension]);
    if (!isLua && !isQuickJs) {
        if (error) *error = hostError(55, @"script language does not match the entry extension");
        return nil;
    }
    if (![NSFileManager.defaultManager fileExistsAtPath:[assets stringByAppendingPathComponent:entry]]) {
        if (error) *error = hostError(56, [NSString stringWithFormat:@"Script entry does not exist: %@", entry]);
        return nil;
    }
    return config;
}

static NSData *fetchData(NSURL *url, NSDictionary<NSString *, NSString *> *headers,
                         NSUInteger maximumBytes, NSError **error) {
    if (![url.scheme.lowercaseString isEqualToString:@"https"]) {
        if (error) *error = hostError(60, @"Remote asset URL must use HTTPS");
        return nil;
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.timeoutInterval = 8;
    request.cachePolicy = NSURLRequestReloadRevalidatingCacheData;
    for (NSString *header in headers) [request setValue:headers[header] forHTTPHeaderField:header];

    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.timeoutIntervalForRequest = 8;
    configuration.timeoutIntervalForResource = 12;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
    dispatch_semaphore_t completed = dispatch_semaphore_create(0);
    __block NSData *result = nil;
    __block NSError *requestError = nil;
    __block NSHTTPURLResponse *httpResponse = nil;
    NSURLSessionDataTask *task = [session dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *taskError) {
            result = data;
            requestError = taskError;
            if ([response isKindOfClass:NSHTTPURLResponse.class]) httpResponse = (NSHTTPURLResponse *)response;
            dispatch_semaphore_signal(completed);
        }];
    [task resume];
    if (dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 13 * NSEC_PER_SEC)) != 0) {
        [task cancel];
        requestError = hostError(61, @"Remote asset request timed out");
    }
    [session finishTasksAndInvalidate];
    if (requestError != nil) {
        if (error) *error = requestError;
        return nil;
    }
    if (httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 ||
        ![httpResponse.URL.scheme.lowercaseString isEqualToString:@"https"]) {
        if (error) *error = hostError(62, [NSString stringWithFormat:@"Remote asset request failed with HTTP %ld",
                                         (long)httpResponse.statusCode]);
        return nil;
    }
    if (result.length == 0 || result.length > maximumBytes) {
        if (error) *error = hostError(63, @"Remote asset response has an invalid size");
        return nil;
    }
    return result;
}

static NSArray<NSDictionary<NSString *, NSString *> *> *availableAssets(void) {
    static NSArray<NSDictionary<NSString *, NSString *> *> *assets;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        assets = @[
            @{@"name": @"TypeScript",
              @"url": @"https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download/script-squadron-typescript.zip"},
            @{@"name": @"JavaScript",
              @"url": @"https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download/script-squadron-js.zip"},
            @{@"name": @"Lua",
              @"url": @"https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download/script-squadron-lua.zip"},
        ];
    });
    return assets;
}

static NSString *installedAssetsPath(NSError **error) {
    NSURL *support = [NSFileManager.defaultManager URLForDirectory:NSApplicationSupportDirectory
                                                          inDomain:NSUserDomainMask
                                                 appropriateForURL:nil
                                                            create:YES
                                                             error:error];
    if (support == nil) return nil;
    NSString *root = [support.path stringByAppendingPathComponent:@"BevyRuneweave"];
    if (![NSFileManager.defaultManager createDirectoryAtPath:root
                                  withIntermediateDirectories:YES attributes:nil error:error]) {
        return nil;
    }
    return [root stringByAppendingPathComponent:@"runtime-assets"];
}

static BOOL copyBootstrapScript(NSString *assets, NSError **error) {
    NSFileManager *files = NSFileManager.defaultManager;
    NSString *source = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:
        [@"assets" stringByAppendingPathComponent:BootstrapScriptName]];
    NSString *target = [assets stringByAppendingPathComponent:BootstrapScriptName];
    if (![files fileExistsAtPath:source]) {
        if (error) *error = hostError(64, @"The bundled host bootstrap script is missing");
        return NO;
    }
    [files removeItemAtPath:target error:nil];
    return [files copyItemAtPath:source toPath:target error:error];
}

static NSDictionary *installedGameConfig(NSString *assets, NSError **error) {
    NSString *marker = [assets stringByAppendingPathComponent:InstalledMarkerName];
    if (![NSFileManager.defaultManager fileExistsAtPath:marker]) {
        if (error) *error = hostError(65, @"No game package is installed");
        return nil;
    }
    return validateAssets(assets, error);
}

static BOOL installArchive(NSData *archive, NSString *installed, NSError **error) {
    NSFileManager *files = NSFileManager.defaultManager;
    NSString *root = installed.stringByDeletingLastPathComponent;
    NSString *staging = [root stringByAppendingPathComponent:@"assets.staging"];
    NSString *backup = [root stringByAppendingPathComponent:@"assets.backup"];
    [files removeItemAtPath:staging error:nil];
    [files removeItemAtPath:backup error:nil];
    if (!extractZip(archive, staging, error) || validateAssets(staging, error) == nil) {
        [files removeItemAtPath:staging error:nil];
        return NO;
    }
    if ([files fileExistsAtPath:installed] && ![files moveItemAtPath:installed toPath:backup error:error]) {
        [files removeItemAtPath:staging error:nil];
        return NO;
    }
    if (![files moveItemAtPath:staging toPath:installed error:error]) {
        if ([files fileExistsAtPath:backup]) [files moveItemAtPath:backup toPath:installed error:nil];
        return NO;
    }
    NSString *marker = [installed stringByAppendingPathComponent:InstalledMarkerName];
    if (!copyBootstrapScript(installed, error) ||
        ![@"installed\n" writeToFile:marker atomically:YES encoding:NSUTF8StringEncoding error:error]) {
        [files removeItemAtPath:installed error:nil];
        if ([files fileExistsAtPath:backup]) [files moveItemAtPath:backup toPath:installed error:nil];
        return NO;
    }
    [files removeItemAtPath:backup error:nil];
    return YES;
}

static BOOL installBundledAssetsIfNeeded(NSString *installed, NSError **error) {
    if (validateAssets(installed, nil) != nil) return copyBootstrapScript(installed, error);
    NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"assets"];
    if (validateAssets(bundled, error) == nil) return NO;

    NSFileManager *files = NSFileManager.defaultManager;
    NSString *staging = [installed.stringByDeletingLastPathComponent
        stringByAppendingPathComponent:@"assets.staging"];
    [files removeItemAtPath:staging error:nil];
    [files removeItemAtPath:installed error:nil];
    if (![files copyItemAtPath:bundled toPath:staging error:error] ||
        validateAssets(staging, error) == nil ||
        ![files moveItemAtPath:staging toPath:installed error:error]) {
        [files removeItemAtPath:staging error:nil];
        return NO;
    }
    return copyBootstrapScript(installed, error);
}

static UIWindow *HostLauncherWindow;

static UIColor *hostColor(CGFloat red, CGFloat green, CGFloat blue) {
    return [UIColor colorWithRed:red / 255.0 green:green / 255.0 blue:blue / 255.0 alpha:1.0];
}

static UIWindow *bevyWindow(void) {
    UIWindow *fallback = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class] ||
            scene.activationState == UISceneActivationStateUnattached) continue;
        for (UIWindow *candidate in ((UIWindowScene *)scene).windows) {
            if (candidate == HostLauncherWindow) continue;
            if (candidate.isKeyWindow) return candidate;
            if (fallback == nil) fallback = candidate;
        }
    }
    if (fallback != nil) return fallback;
    for (UIWindow *candidate in UIApplication.sharedApplication.windows) {
        if (candidate != HostLauncherWindow) return candidate;
    }
    return nil;
}

@interface HostLauncherViewController : UIViewController <UITextFieldDelegate>

@property(nonatomic, copy) NSString *installed;
@property(nonatomic, strong) UITextField *urlField;
@property(nonatomic, strong) UIButton *downloadButton;
@property(nonatomic, strong) UIButton *launchButton;
@property(nonatomic, strong) NSMutableArray<UIButton *> *remoteButtons;
@property(nonatomic, strong) UIActivityIndicatorView *spinner;
@property(nonatomic, strong) UILabel *statusLabel;

- (instancetype)initWithInstalledPath:(NSString *)installed;

@end

@implementation HostLauncherViewController

- (instancetype)initWithInstalledPath:(NSString *)installed {
    self = [super initWithNibName:nil bundle:nil];
    if (self != nil) {
        _installed = [installed copy];
        _remoteButtons = [NSMutableArray array];
    }
    return self;
}

- (UILabel *)labelWithText:(NSString *)text size:(CGFloat)size color:(UIColor *)color {
    UILabel *label = [[UILabel alloc] init];
    label.text = text;
    label.font = [UIFont systemFontOfSize:size];
    label.textColor = color;
    label.numberOfLines = 0;
    return label;
}

- (UIButton *)buttonWithTitle:(NSString *)title action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    [button setTitle:title forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:16 weight:UIFontWeightSemibold];
    button.backgroundColor = UIColor.whiteColor;
    button.layer.cornerRadius = 6;
    button.layer.borderWidth = 1;
    button.layer.borderColor = hostColor(211, 216, 221).CGColor;
    [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    [button.heightAnchor constraintEqualToConstant:50].active = YES;
    return button;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = hostColor(244, 245, 247);

    UIScrollView *scroll = [[UIScrollView alloc] init];
    scroll.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:scroll];

    UIStackView *content = [[UIStackView alloc] init];
    content.translatesAutoresizingMaskIntoConstraints = NO;
    content.axis = UILayoutConstraintAxisVertical;
    content.spacing = 10;
    [scroll addSubview:content];

    UILabel *title = [self labelWithText:@"Bevy RuneWeave" size:28 color:hostColor(28, 32, 36)];
    title.font = [UIFont systemFontOfSize:28 weight:UIFontWeightSemibold];
    [content addArrangedSubview:title];

    UILabel *subtitle = [self labelWithText:@"iOS host" size:15 color:hostColor(83, 90, 98)];
    [content addArrangedSubview:subtitle];
    [content setCustomSpacing:28 afterView:subtitle];

    UILabel *section = [self labelWithText:@"GitHub release assets" size:16 color:hostColor(28, 32, 36)];
    section.font = [UIFont systemFontOfSize:16 weight:UIFontWeightMedium];
    [content addArrangedSubview:section];

    for (NSUInteger index = 0; index < availableAssets().count; index++) {
        NSDictionary<NSString *, NSString *> *asset = availableAssets()[index];
        UIButton *button = [self buttonWithTitle:[@"Download " stringByAppendingString:asset[@"name"]]
                                          action:@selector(downloadPreset:)];
        button.tag = (NSInteger)index;
        [self.remoteButtons addObject:button];
        [content addArrangedSubview:button];
    }

    self.urlField = [[UITextField alloc] init];
    self.urlField.translatesAutoresizingMaskIntoConstraints = NO;
    self.urlField.placeholder = @"HTTPS asset package URL";
    self.urlField.keyboardType = UIKeyboardTypeURL;
    self.urlField.autocapitalizationType = UITextAutocapitalizationTypeNone;
    self.urlField.autocorrectionType = UITextAutocorrectionTypeNo;
    self.urlField.returnKeyType = UIReturnKeyGo;
    self.urlField.clearButtonMode = UITextFieldViewModeWhileEditing;
    self.urlField.backgroundColor = UIColor.whiteColor;
    self.urlField.layer.cornerRadius = 6;
    self.urlField.layer.borderWidth = 1;
    self.urlField.layer.borderColor = hostColor(211, 216, 221).CGColor;
    self.urlField.delegate = self;
    UIView *leftPadding = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 12, 1)];
    self.urlField.leftView = leftPadding;
    self.urlField.leftViewMode = UITextFieldViewModeAlways;
    [self.urlField.heightAnchor constraintEqualToConstant:52].active = YES;
    [content addArrangedSubview:self.urlField];

    self.downloadButton = [self buttonWithTitle:@"Download and start" action:@selector(downloadCustom)];
    self.downloadButton.backgroundColor = hostColor(35, 105, 194);
    [self.downloadButton setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    self.downloadButton.layer.borderWidth = 0;
    [content addArrangedSubview:self.downloadButton];

    self.launchButton = [self buttonWithTitle:@"Start installed game" action:@selector(launchInstalled)];
    [content addArrangedSubview:self.launchButton];

    self.spinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium];
    self.spinner.hidesWhenStopped = YES;
    [self.spinner.heightAnchor constraintEqualToConstant:42].active = YES;
    [content addArrangedSubview:self.spinner];

    self.statusLabel = [self labelWithText:@"" size:14 color:hostColor(73, 80, 87)];
    self.statusLabel.textAlignment = NSTextAlignmentCenter;
    [content addArrangedSubview:self.statusLabel];

    UILayoutGuide *frame = scroll.frameLayoutGuide;
    UILayoutGuide *layout = scroll.contentLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [scroll.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [scroll.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [scroll.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [scroll.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [content.leadingAnchor constraintEqualToAnchor:layout.leadingAnchor constant:24],
        [content.trailingAnchor constraintEqualToAnchor:layout.trailingAnchor constant:-24],
        [content.topAnchor constraintEqualToAnchor:layout.topAnchor constant:48],
        [content.bottomAnchor constraintLessThanOrEqualToAnchor:layout.bottomAnchor constant:-24],
        [content.widthAnchor constraintEqualToAnchor:frame.widthAnchor constant:-48],
    ]];
    [self updateInstalledState];
}

- (void)setBusy:(BOOL)busy status:(NSString *)status {
    self.urlField.enabled = !busy;
    self.downloadButton.enabled = !busy;
    self.launchButton.enabled = !busy && installedGameConfig(self.installed, nil) != nil;
    for (UIButton *button in self.remoteButtons) button.enabled = !busy;
    if (busy) [self.spinner startAnimating]; else [self.spinner stopAnimating];
    self.statusLabel.text = status;
}

- (void)updateInstalledState {
    NSDictionary *config = installedGameConfig(self.installed, nil);
    self.launchButton.enabled = config != nil;
    if (config == nil) {
        self.statusLabel.text = @"No game package installed";
        return;
    }
    self.statusLabel.text = [NSString stringWithFormat:@"Installed: %@ %@",
        config[@"name"], config[@"version"]];
}

- (void)showError:(NSString *)message {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Could not start game"
        message:message preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)activateConfig:(NSDictionary *)config {
    NSString *entry = config[@"script"][@"entry"];
    if (entry.length == 0 || game_runtime_switch_script(entry.UTF8String) != 0) {
        [self setBusy:NO status:@""];
        [self showError:@"The runtime could not activate the selected script"];
        [self updateInstalledState];
        return;
    }
    UIWindow *runtimeWindow = bevyWindow();
    HostLauncherWindow.hidden = YES;
    HostLauncherWindow.rootViewController = nil;
    HostLauncherWindow = nil;
    [runtimeWindow makeKeyAndVisible];
}

- (void)downloadPreset:(UIButton *)sender {
    NSDictionary<NSString *, NSString *> *asset = availableAssets()[(NSUInteger)sender.tag];
    self.urlField.text = asset[@"url"];
    [self downloadURL:[NSURL URLWithString:asset[@"url"]]];
}

- (void)downloadCustom {
    NSString *raw = [self.urlField.text stringByTrimmingCharactersInSet:
        NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSURL *url = [NSURL URLWithString:raw];
    if (url == nil || ![url.scheme.lowercaseString isEqualToString:@"https"]) {
        [self showError:@"Enter a valid HTTPS URL"];
        return;
    }
    [self downloadURL:url];
}

- (void)downloadURL:(NSURL *)url {
    [self.view endEditing:YES];
    [self setBusy:YES status:@"Downloading package..."];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSError *error = nil;
        NSData *archive = fetchData(url, @{@"User-Agent": @"bevy-runeweave-ios-host"},
                                    MaxArchiveBytes, &error);
        NSDictionary *config = archive == nil ? nil :
            (installArchive(archive, self.installed, &error) ?
                installedGameConfig(self.installed, &error) : nil);
        dispatch_async(dispatch_get_main_queue(), ^{
            if (config != nil) {
                [self activateConfig:config];
            } else {
                [self setBusy:NO status:@""];
                [self showError:error.localizedDescription ?: @"Installation failed"];
                [self updateInstalledState];
            }
        });
    });
}

- (void)launchInstalled {
    NSError *error = nil;
    NSDictionary *config = installedGameConfig(self.installed, &error);
    if (config == nil) {
        [self showError:error.localizedDescription];
        [self updateInstalledState];
        return;
    }
    [self setBusy:YES status:@"Starting installed game..."];
    [self activateConfig:config];
}

- (BOOL)textFieldShouldReturn:(UITextField *)textField {
    [textField resignFirstResponder];
    [self downloadCustom];
    return YES;
}

@end

static void presentHostLauncher(NSString *installed, NSUInteger attempts) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        UIWindow *runtimeWindow = bevyWindow();
        if (runtimeWindow == nil) {
            if (attempts > 0) presentHostLauncher(installed, attempts - 1);
            return;
        }
        HostLauncherViewController *controller =
            [[HostLauncherViewController alloc] initWithInstalledPath:installed];
        if (@available(iOS 13.0, *)) {
            HostLauncherWindow = [[UIWindow alloc] initWithWindowScene:runtimeWindow.windowScene];
        } else {
            HostLauncherWindow = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
        }
        HostLauncherWindow.rootViewController = controller;
        HostLauncherWindow.windowLevel = UIWindowLevelAlert + 1;
        [HostLauncherWindow makeKeyAndVisible];
    });
}

static int fail(NSString *message, int code) {
    NSLog(@"Bevy RuneWeave host: %@", message);
    return code;
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        (void)argc;
        (void)argv;

        NSError *error = nil;
        NSString *installed = installedAssetsPath(&error);
        if (installed == nil || !installBundledAssetsIfNeeded(installed, &error)) {
            return fail(error.localizedDescription ?: @"No valid game assets are installed", 10);
        }
        if (validateAssets(installed, &error) == nil) return fail(error.localizedDescription, 11);

        presentHostLauncher(installed, 40);
        return game_runtime_run_with_assets(installed.fileSystemRepresentation,
                                            BootstrapScriptName.fileSystemRepresentation);
    }
}
