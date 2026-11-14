#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

@interface PromeFTPUpdateDelegate : NSObject <SPUUpdaterDelegate>
@property(nonatomic) BOOL busy;
@property(nonatomic, copy) void (^pendingInstall)(void);
@end

@implementation PromeFTPUpdateDelegate
- (BOOL)updater:(SPUUpdater *)updater
    shouldPostponeRelaunchForUpdate:(SUAppcastItem *)item
    untilInvokingBlock:(void (^)(void))install {
    if (!self.busy) return NO;
    self.pendingInstall = install;
    return YES;
}

- (BOOL)updater:(SPUUpdater *)updater
    willInstallUpdateOnQuit:(SUAppcastItem *)item
    immediateInstallationBlock:(void (^)(void))install {
    if (!self.busy) return NO;
    self.pendingInstall = install;
    return YES;
}

- (void)setBusy:(BOOL)busy {
    _busy = busy;
    if (busy || self.pendingInstall == nil) return;
    void (^install)(void) = self.pendingInstall;
    self.pendingInstall = nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.busy) self.pendingInstall = install;
        else install();
    });
}
@end

static PromeFTPUpdateDelegate *delegate;
static SPUStandardUpdaterController *controller;

static napi_value boolean(napi_env env, BOOL value) {
    napi_value result;
    napi_get_boolean(env, value, &result);
    return result;
}
static bool argument(napi_env env, napi_callback_info info) {
    napi_value value;
    size_t count = 1;
    bool result = false;
    if (napi_get_cb_info(env, info, &count, &value, nullptr, nullptr) == napi_ok && count == 1) {
        napi_get_value_bool(env, value, &result);
    }
    return result;
}

static napi_value start(napi_env env, napi_callback_info info) {
    if (controller == nil) {
        delegate = [PromeFTPUpdateDelegate new];
        controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO
            updaterDelegate:delegate userDriverDelegate:nil];
        [controller startUpdater];
    }
    return boolean(env, YES);
}
static napi_value check(napi_env env, napi_callback_info info) {
    if (delegate.busy || !controller.updater.canCheckForUpdates) return boolean(env, NO);
    [controller checkForUpdates:nil];
    return boolean(env, YES);
}
static napi_value automatic(napi_env env, napi_callback_info info) {
    return boolean(env, controller.updater.automaticallyChecksForUpdates &&
        controller.updater.automaticallyDownloadsUpdates);
}
static napi_value setAutomatic(napi_env env, napi_callback_info info) {
    BOOL enabled = argument(env, info);
    if (enabled) {
        controller.updater.automaticallyChecksForUpdates = YES;
        controller.updater.automaticallyDownloadsUpdates = YES;
        if (!delegate.busy && controller.updater.canCheckForUpdates) [controller.updater checkForUpdatesInBackground];
    } else {
        controller.updater.automaticallyDownloadsUpdates = NO;
        controller.updater.automaticallyChecksForUpdates = NO;
    }
    return boolean(env, enabled);
}
static napi_value setBusy(napi_env env, napi_callback_info info) {
    delegate.busy = argument(env, info);
    return boolean(env, delegate.busy);
}

static napi_value fontFamilies(napi_env env, napi_callback_info info) {
    NSArray<NSString *> *names = NSFontManager.sharedFontManager.availableFontFamilies;
    napi_value result;
    napi_create_array_with_length(env, names.count, &result);
    for (NSUInteger i = 0; i < names.count; i++) {
        napi_value name;
        napi_create_string_utf8(env, names[i].UTF8String, NAPI_AUTO_LENGTH, &name);
        napi_set_element(env, result, (uint32_t)i, name);
    }
    return result;
}

static napi_value lastUpdateCheck(napi_env env, napi_callback_info info) {
    NSDate *date = controller.updater.lastUpdateCheckDate;
    napi_value result;
    if (date) napi_create_double(env, date.timeIntervalSince1970 * 1000, &result);
    else napi_get_null(env, &result);
    return result;
}

NAPI_MODULE_INIT() {
    napi_property_descriptor properties[] = {
        {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"check", nullptr, check, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"automatic", nullptr, automatic, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setAutomatic", nullptr, setAutomatic, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"lastUpdateCheck", nullptr, lastUpdateCheck, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"fontFamilies", nullptr, fontFamilies, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setBusy", nullptr, setBusy, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}
