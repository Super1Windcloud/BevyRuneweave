#import <Foundation/Foundation.h>

#include "game_runtime.h"

static int fail(NSString *message, int code) {
    NSLog(@"Bevy RuneWeave host: %@", message);
    return code;
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        (void)argc;
        (void)argv;

        NSString *assets = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"assets"];
        NSString *configPath = [assets stringByAppendingPathComponent:@"engineConfig.json"];
        NSData *data = [NSData dataWithContentsOfFile:configPath];
        if (data == nil) {
            return fail(@"engineConfig.json is missing", 10);
        }

        NSError *error = nil;
        NSDictionary *config = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
        if (![config isKindOfClass:NSDictionary.class]) {
            return fail(error.localizedDescription ?: @"engineConfig.json is invalid", 11);
        }
        if ([config[@"schemaVersion"] integerValue] != 1) {
            return fail(@"unsupported engineConfig schemaVersion", 12);
        }

        NSDictionary *script = config[@"script"];
        NSString *language = script[@"language"];
        NSString *entry = script[@"entry"];
        NSString *expectedLanguage = [NSBundle mainBundle].infoDictionary[@"RuneweaveLanguage"];
        if (![language isEqualToString:expectedLanguage]) {
            return fail(@"asset language does not match the linked runtime", 13);
        }
        if (![entry isKindOfClass:NSString.class] || entry.length == 0 || entry.isAbsolutePath ||
            [entry.pathComponents containsObject:@".."]) {
            return fail(@"script.entry must stay inside assets", 14);
        }
        if (![[NSFileManager defaultManager] fileExistsAtPath:[assets stringByAppendingPathComponent:entry]]) {
            return fail(@"script entry does not exist", 15);
        }

        return game_runtime_run_with_assets(assets.fileSystemRepresentation,
                                            entry.fileSystemRepresentation);
    }
}
