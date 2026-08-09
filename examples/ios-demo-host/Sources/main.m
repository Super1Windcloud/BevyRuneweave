#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <zlib.h>

#include "game_runtime.h"

static NSString *const HostErrorDomain = @"io.github.super1windcloud.runeweave.host";
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
    return [root stringByAppendingPathComponent:@"assets"];
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
    [files removeItemAtPath:backup error:nil];
    return YES;
}

static BOOL installBundledAssetsIfNeeded(NSString *installed, NSError **error) {
    if (validateAssets(installed, nil) != nil) return YES;
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
    return YES;
}

static UIViewController *topViewController(void) {
    UIWindow *window = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class] ||
            scene.activationState == UISceneActivationStateUnattached) continue;
        for (UIWindow *candidate in ((UIWindowScene *)scene).windows) {
            if (candidate.isKeyWindow) {
                window = candidate;
                break;
            }
            if (window == nil) window = candidate;
        }
        if (window != nil) break;
    }
    UIViewController *controller = window.rootViewController;
    while (controller.presentedViewController != nil) controller = controller.presentedViewController;
    return controller;
}

static void showErrorAlert(NSString *message) {
    UIViewController *controller = topViewController();
    if (controller == nil) return;
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Download failed"
        message:message preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [controller presentViewController:alert animated:YES completion:nil];
}

static void downloadAndActivate(NSDictionary<NSString *, NSString *> *asset, NSString *installed) {
    UIViewController *controller = topViewController();
    if (controller == nil) return;
    UIAlertController *progress = [UIAlertController alertControllerWithTitle:@"Downloading"
        message:[NSString stringWithFormat:@"Loading %@ assets from GitHub...", asset[@"name"]]
        preferredStyle:UIAlertControllerStyleAlert];
    [controller presentViewController:progress animated:YES completion:^{
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSError *error = nil;
            NSURL *url = [NSURL URLWithString:asset[@"url"]];
            NSData *archive = fetchData(url, @{@"User-Agent": @"bevy-runeweave-ios-host"},
                                        MaxArchiveBytes, &error);
            NSDictionary *config = archive == nil ? nil :
                (installArchive(archive, installed, &error) ? validateAssets(installed, &error) : nil);
            NSString *entry = config[@"script"][@"entry"];
            int switchResult = entry == nil ? 1 : game_runtime_switch_script(entry.UTF8String);
            dispatch_async(dispatch_get_main_queue(), ^{
                [progress dismissViewControllerAnimated:YES completion:^{
                    if (error != nil) {
                        showErrorAlert(error.localizedDescription);
                    } else if (switchResult != 0) {
                        showErrorAlert(@"The runtime could not activate the selected script");
                    }
                }];
            });
        });
    }];
}

static void presentAssetPicker(NSString *installed, NSUInteger attempts) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        UIViewController *controller = topViewController();
        if (controller == nil) {
            if (attempts > 0) presentAssetPicker(installed, attempts - 1);
            return;
        }
        UIAlertController *picker = [UIAlertController alertControllerWithTitle:@"GitHub assets"
            message:@"Choose a resource package to download and start"
            preferredStyle:UIAlertControllerStyleAlert];
        for (NSDictionary<NSString *, NSString *> *asset in availableAssets()) {
            [picker addAction:[UIAlertAction actionWithTitle:asset[@"name"]
                style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC),
                                   dispatch_get_main_queue(), ^{
                        downloadAndActivate(asset, installed);
                    });
                }]];
        }
        [picker addAction:[UIAlertAction actionWithTitle:@"Start installed game"
            style:UIAlertActionStyleCancel handler:nil]];
        [controller presentViewController:picker animated:YES completion:nil];
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
        NSDictionary *config = validateAssets(installed, &error);
        if (config == nil) return fail(error.localizedDescription, 11);

        NSString *entry = config[@"script"][@"entry"];
        presentAssetPicker(installed, 20);
        return game_runtime_run_with_assets(installed.fileSystemRepresentation,
                                            entry.fileSystemRepresentation);
    }
}
