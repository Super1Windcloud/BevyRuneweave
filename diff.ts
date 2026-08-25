#!/usr/bin/env npx tsx

import {
    execSync,
    execFileSync,
} from "node:child_process";

import {
    createInterface,
} from "node:readline/promises";

import {
    stderr as progressOutput,
    stdin as input,
    stdout as output,
} from "node:process";

import {
    mkdtempSync,
    rmSync,
} from "node:fs";

import {
    tmpdir,
} from "node:os";

import {
    join,
} from "node:path";


// ============================================================
// 配置
// ============================================================

const ROOT =
    "/Users/super/super/blockman-go-android";

const APP_CONFIG =
    "/Users/super/super/blockman-go-android/Librarys/libBaseRes/src/main/java/com/sandboxol/center/entity/AppConfig.java";

const MASTER_APP_CONFIG_RELATIVE =
    "Librarys/libBaseRes/src/main/java/com/sandboxol/center/entity/AppConfig.java";


// ============================================================
// 需要检查的 public 字段 / 方法
// ============================================================

const methods = `
contains
getAccountSecurityV8BindEmailIntervalDays
getActivityUrl
getActivityVersionCode
getAdBusinessRuleConfig
getAdUnitIds
getAdsConfig
getAirwallexPaymentUrl
getAirwallexPaymentUrlSystemBrowser
getAllowedIpCountries
getAnrStabilityConfig
getAvatarDownloadConfig
getBedWarMapRedirectConfigs
getBedWarNoviceGuideFilterRange
getBedWarNoviceGuideFilterRangeNew
getBedWarNoviceGuideMapMode
getBedWarNoviceNotGuideGameType
getBedWarRefereeMode
getBedWarRefereeModeGameTypes
getBedrocksAutoOpenInterval
getBgGoIndexUrl
getBgGoIndexVipUrl
getBulletinServerAddr
getClapFaceShowRule
getCommunityCdKey
getCountLimit
getCustomSex
getCustomUserId
getDailyShareVersionCode
getDeepLinkConfig
getDeveloperCommunityConfig
getDeviceCapabilityConfig
getDirectlyTriggerThirdPaymentCount
getDiscordUrl
getDownloadConfig
getDownloadGames
getDressFaceParts
getFollowCommunityEntrance
getGameRedPoint
getGetVerticalGameList
getGratitudeUrl
getGuideGameId
getHardMissThirdPaymentAppVersion
getHealModuleHost
getHiddenAppVersionRanges
getHidePointsMallAppVersionRanges
getHomeBanner
getHuaweiEventCountLimit
getImFraudRuleVersion
getImFraudWhitelistUserIds
getImMessageDenyObjectNames
getImageFraudCdInMinute
getInterstitialAdConfig
getLimitWaitTime
getMapPreviewMemoryLimit
getMax
getMaxVipLevelExclusive
getMediaListUrl
getMin
getMinRegisterDays
getMinVipLevel
getMiningMinerBg
getMiningMinerIcon
getMiningOwnerBg
getMiningOwnerIcon
getNewGratitudeUrl
getNewHomePlanA
getNewHomePlanB
getNewHomePlanC
getNewHomePlanD
getOfficialMall
getOfficialWebsite
getPayFailDiscordUrl
getPayFailInvestigationInterval
getPersonalEffectsStoreEntrance
getPingReportInterval
getPointsMall
getPointsMallUrl
getPriority
getReportInterval
getRequiresThirdPayWhite
getRobloxInviteTaskLink
getSchoolSeasonAutoOpenInterval
getSensitiveEntranceRules
getSensitiveWordVersion
getShowBigPartyMinimumVersion
getSizeLimit
getSocialCommunityWelfareEntrance
getSocialHomeBgPic
getSpecialAdsConfig
getSupportThirdPaymentCountryList
getTempMTPBlackList
getTencentcloudPrivacyUrl
getTextFraudCdInMinute
getThinkDataEventCountLimit
getTickInterval
getTpAdForbidNetworkIds
getTribeIntroduction
getUniversalActivityVersionCode
getV2CommonGameList
getVersion
getVideoBanner
getVideoSubmitActivityCode
getVideoSubmitActivityConfig
getVipCustomerDiscordId
getVipCustomerDiscordUrl
getVipCustomerLevel
getVipList
getWebViewWarmupConfig
getWebViewWhiteList
getWhitelistLink
isAccountSecurityV8BindEmailToggle
isAnniversary8Entrance
isAnrWithoutGoogleReport
isChristmas25Entrance
isDisableHuaweiEvent
isDisableIM
isDisableKinesisEvent
isDisplayGameDetailsBiggyBank
isDisplayOldDressUpgradeEntranceInDecoratePage
isDisplayUMPCheckDialog
isEnableBgGoIndex
isEnableLogDebugReportEvent
isEnableMiningEntranceNew
isEnableMyselfSuitGuide
isEnablePayFailDiscord
isEnableRUThirdPayment
isEnableReportFpsAndPing
isEnableUaLanding
isFacebookHelperLoginEntrance
isFriendSend
isGameRomeEntranceNew
isGameRoomAutoDisplayShareDialog
isGameRoomEntrance
isGameRoomUGCEntrance
isImFraudDetectEnable
isNeedBindEmail
isNeedStopServiceAnnouncement
isNeedSystemAnnouncement
isOpenBgGoByWebView
isOpenFamilyCustom
isOpenMTP
isOpenMorePay
isOpenNewRecharge
isOpenRechargeBind
isOpenRechargeForOther
isOpenRemoteConfig
isOpenUpdateSO
isPayFailInvestigationSwitch
isPointsMallEnabled
isPointsMallUrlEnabled
isPointsMallVersionHidden
isPushGatewayEndpointEnabled
isPushGatewayPayloadEnabled
isReportCustomANR2Bugly
isReportTokenEmpty
isShowActivity
isShowAds
isShowCampaign
isShowChatTranslate
isShowChest
isShowCustomRoomInvite
isShowDressRecommend
isShowFriendFollow
isShowFriendMatch
isShowGameGuide
isShowGoldExchange
isShowHallowmasChest
isShowHomeGuideNew
isShowHomeTopBanner
isShowHomestead
isShowMainGuide
isShowMoreGame
isShowPartyInvite
isShowShare
isShowThirdPart
isShowTopActivity
isShowUniversalActivity
isShowUserFamilyEditToggle
isShowUserInfoProps
isSilentDownload
isStartPlatformLobbyEntry
isTriggerAfterGame
isUseMultithreadRenderer
isUseNewSearch
isVerifyLoginShowDownloadButton
resolvePointsMallUrl
setAccountSecurityV8BindEmailIntervalDays
setAccountSecurityV8BindEmailToggle
setActivityUrl
setActivityVersionCode
setAdBusinessRuleConfig
setAdUnitIds
setAdsConfig
setAirwallexPaymentUrl
setAirwallexPaymentUrlSystemBrowser
setAnniversary8Entrance
setAnrStabilityConfig
setAnrWithoutGoogleReport
setAvatarDownloadConfig
setBedWarMapRedirectConfigs
setBedWarNoviceGuideFilterRange
setBedWarNoviceGuideFilterRangeNew
setBedWarNoviceGuideMapMode
setBedWarNoviceNotGuideGameType
setBedWarRefereeMode
setBedWarRefereeModeGameTypes
setBedrocksAutoOpenInterval
setBgGoIndexUrl
setBgGoIndexVipUrl
setBulletinServerAddr
setChristmas25Entrance
setClapFaceShowRule
setClearCache
setCountLimit
setCustomSex
setCustomUserId
setDailyShareVersionCode
setDeepLinkConfig
setDeveloperCommunityConfig
setDeviceCapabilityConfig
setDirectlyTriggerThirdPaymentCount
setDisableHuaweiEvent
setDisableIM
setDisableKinesisEvent
setDiscordUrl
setDisplayGameDetailsBiggyBank
setDisplayOldDressUpgradeEntranceInDecoratePage
setDisplayUMPCheckDialog
setDownloadConfig
setDownloadGames
setDressFaceParts
setEnableBgGoIndex
setEnableLogDebugReportEvent
setEnableMiningEntranceNew
setEnableMyselfSuitGuide
setEnablePayFailDiscord
setEnableRUThirdPayment
setEnableReportFpsAndPing
setFacebookHelperLoginEntrance
setFollowCommunityEntrance
setFriendSend
setGameLoadingBgMap
setGameRedPoint
setGameRomeEntranceNew
setGameRoomAutoDisplayShareDialog
setGameRoomEntrance
setGameRoomUGCEntrance
setGameTypeConfig
setGetVerticalGameList
setGratitudeUrl
setGuideGameId
setHardMissThirdPaymentAppVersion
setHealModuleHost
setHidePointsMallAppVersionRanges
setHomeBanner
setHuaweiEventCountLimit
setInterstitialAdConfig
setLimitWaitTime
setLocalFirebaseTest
setMax
setMediaListUrl
setMin
setMiningMinerBg
setMiningMinerIcon
setMiningOwnerBg
setMiningOwnerIcon
setNeedBindEmail
setNeedStopServiceAnnouncement
setNeedSystemAnnouncement
setNewGratitudeUrl
setNewHomePlanA
setNewHomePlanB
setNewHomePlanC
setNewHomePlanD
setOpenBgGoByWebView
setOpenFamilyCustom
setOpenMTP
setOpenMorePay
setOpenNewRecharge
setOpenRechargeBind
setOpenRechargeForOther
setOpenRemoteConfig
setOpenUpdateSO
setPayFailDiscordUrl
setPayFailInvestigationInterval
setPayFailInvestigationSwitch
setPersonalEffectsStoreEntrance
setPingReportInterval
setPointsMallUrl
setReportCustomANR2Bugly
setReportInterval
setReportTokenEmpty
setRobloxInviteTaskLink
setSchoolSeasonAutoOpenInterval
setSensitiveWordVersion
setShowActivity
setShowAds
setShowBigPartyMinimumVersion
setShowCampaign
setShowChatTranslate
setShowChest
setShowCustomRoomInvite
setShowDressRecommend
setShowFriendFollow
setShowFriendMatch
setShowGameGuide
setShowGoldExchange
setShowHallowmasChest
setShowHomeGuideNew
setShowHomeTopBanner
setShowHomestead
setShowMainGuide
setShowMoreGame
setShowPartyInvite
setShowShare
setShowThirdPart
setShowTopActivity
setShowUniversalActivity
setShowUserFamilyEditToggle
setShowUserInfoProps
setSilentDownload
setSizeLimit
setSocialCommunityWelfareEntrance
setSocialHomeBgPic
setSpecialAdsConfig
setStartPlatformLobbyEntry
setSupportThirdPaymentCountryList
setTempMTPBlackList
setTencentcloudPrivacyUrl
setThinkDataEventCountLimit
setTickInterval
setTpAdForbidNetworkIds
setTribeIntroduction
setTriggerAfterGame
setUniversalActivityVersionCode
setUseMultithreadRenderer
setUseNewSearch
setV2CommonGameList
setVerifyLoginShowDownloadButton
setVideoBanner
setVideoSubmitActivityCode
setVipCustomerDiscordId
setVipCustomerDiscordUrl
setVipCustomerLevel
setVipList
setWebViewWarmupConfig
setWebViewWhiteList
setWhitelistLink
`
    .trim()
    .split(/\s+/)
    .filter(Boolean);


// 去重
const uniqueMethods = [
    ...new Set(methods),
];


// ============================================================
// 工具
// ============================================================

function escapeRegex(value: string): string {
    return value.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
    );
}


/**
 * 根据 getter / setter / isXxx 推导字段名
 *
 * getActivityUrl
 * setActivityUrl
 * isShowActivity
 *
 * =>
 *
 * activityUrl
 * showActivity
 */
function getFieldName(method: string): string {

    let name = "";

    if (
        method.startsWith("get") ||
        method.startsWith("set")
    ) {
        name = method.slice(3);

    } else if (
        method.startsWith("is")
    ) {
        name = method.slice(2);

    } else {
        return "";
    }

    if (!name) {
        return "";
    }

    return (
        name.charAt(0).toLowerCase() +
        name.slice(1)
    );
}


// ============================================================
// 检查 AppConfig 中是否存在 public 方法
// ============================================================

function hasPublicMethod(
    appConfigFile: string,
    method: string,
): boolean {

    try {

        execFileSync(
            "rg",
            [
                "-n",

                `\\bpublic\\s+[^;{}]+\\b${escapeRegex(method)}\\s*\\(`,

                appConfigFile,
            ],
            {
                encoding: "utf8",

                stdio: [
                    "ignore",
                    "pipe",
                    "ignore",
                ],
            },
        );

        return true;

    } catch (error: any) {

        if (
            error?.status === 1
        ) {
            return false;
        }

        throw error;
    }
}


// ============================================================
// 全局搜索 getter / setter / Kotlin 属性引用
// ============================================================

function findMethodReferences(
    searchRoot: string,
    method: string,
): string {

    return execFileSync(
        "rg",
        [
            "-n",

            "-C",
            "3",

            // 排除所有 AppConfig.java
            "-g",
            "!**/AppConfig.java",

            // 排除 Markdown 文档
            "-g",
            "!**/*.md",

            "--color=always",

            // 同时匹配 Java 的 method() 和 Kotlin 的 .method 属性语法
            `\\b${escapeRegex(method)}\\b`,

            ".",
        ],
        {
            cwd: searchRoot,

            encoding: "utf8",

            maxBuffer:
                20 * 1024 * 1024,

            stdio: [
                "ignore",
                "pipe",
                "ignore",
            ],
        },
    );
}


// ============================================================
// 全局搜索 private 字段引用
// ============================================================

function findFieldReferences(
    searchRoot: string,
    field: string,
): string {

    return execFileSync(
        "rg",
        [
            "-n",

            "-C",
            "3",

            // 排除所有 AppConfig.java
            "-g",
            "!**/AppConfig.java",

            // 排除 Markdown 文档
            "-g",
            "!**/*.md",

            "--color=always",

            // 匹配字段
            `\\b${escapeRegex(field)}\\b`,

            ".",
        ],
        {
            cwd: searchRoot,

            encoding: "utf8",

            maxBuffer:
                20 * 1024 * 1024,

            stdio: [
                "ignore",
                "pipe",
                "ignore",
            ],
        },
    );
}


// ============================================================
// 判断文件存在
// ============================================================

function fileExists(
    file: string,
): boolean {

    try {

        execFileSync(
            "test",
            [
                "-f",
                file,
            ],
            {
                stdio: "ignore",
            },
        );

        return true;

    } catch {

        return false;
    }
}


// ============================================================
// readline
// ============================================================

const rl = createInterface({
    input,
    output,
});

const nonInteractive =
    process.argv.includes(
        "--non-interactive",
    );


// ============================================================
// 开始选择
// ============================================================

let mode: "1" | "2";

if (nonInteractive) {

    mode = "2";

} else {

    console.clear();

    console.log(
        "AppConfig Public API 全局引用检查",
    );

    console.log(
        "════════════════════════════════════════════════",
    );

    console.log("");

    console.log(
        "请选择搜索模式：",
    );

    console.log("");

    console.log(
        "  1. 使用 master worktree",
    );

    console.log(
        "     → AppConfig 使用 master 版本",
    );

    console.log(
        "     → 全工程使用 master 版本",
    );

    console.log("");

    console.log(
        "  2. 直接使用 AppConfig file path",
    );

    console.log(
        "     → AppConfig 使用当前工作区版本",
    );

    console.log(
        "     → 全工程使用当前工作区",
    );

    console.log("");

    while (true) {

        const answer =
            (
                await rl.question(
                    "请选择 [1/2]: ",
                )
            ).trim();

        if (
            answer === "1" ||
            answer === "2"
        ) {

            mode = answer;

            break;
        }

        console.log(
            "请输入 1 或 2",
        );
    }
}


// ============================================================
// 准备搜索环境
// ============================================================

let searchRoot: string;

let currentAppConfigFile: string;

let masterRoot: string | null = null;


if (mode === "1") {

    // ========================================================
    // master
    // ========================================================

    masterRoot = mkdtempSync(
        join(
            tmpdir(),
            "blockman-go-master-",
        ),
    );

    searchRoot = masterRoot;

    currentAppConfigFile = join(
        masterRoot,
        MASTER_APP_CONFIG_RELATIVE,
    );

    console.log("");

    console.log(
        "正在导出 master...",
    );

    console.log(
        `临时目录：${masterRoot}`,
    );

    try {

        execSync(
            `git archive master | tar -x -C "${masterRoot}"`,
            {
                cwd: ROOT,
                stdio: "ignore",
            },
        );

    } catch (error) {

        console.error(
            "\n❌ 无法导出 master",
        );

        console.error(error);

        rmSync(
            masterRoot,
            {
                recursive: true,
                force: true,
            },
        );

        rl.close();

        process.exit(1);
    }

    console.log(
        "✅ master 导出完成",
    );

} else {

    // ========================================================
    // 当前工作区
    // ========================================================

    searchRoot = ROOT;

    currentAppConfigFile =
        APP_CONFIG;

    console.log("");

    console.log(
        "使用当前工作区 AppConfig：",
    );

    console.log(
        currentAppConfigFile,
    );
}


// ============================================================
// AppConfig 是否存在
// ============================================================

if (
    !fileExists(
        currentAppConfigFile,
    )
) {

    console.error("");

    console.error(
        "❌ AppConfig.java 不存在：",
    );

    console.error(
        currentAppConfigFile,
    );

    if (masterRoot) {

        rmSync(
            masterRoot,
            {
                recursive: true,
                force: true,
            },
        );
    }

    rl.close();

    process.exit(1);
}


// ============================================================
// 开始
// ============================================================

console.log("");

console.log(
    `共 ${uniqueMethods.length} 个 API`,
);

console.log("");

if (!nonInteractive) {

    await rl.question(
        "按 Enter 开始检查...",
    );
}


// ============================================================
// 统计
// ============================================================

let foundCount = 0;

let notFoundCount = 0;

let autoSkippedCount = 0;

let manualSkippedCount = 0;

const foundMethods: string[] = [];

const notFoundMethods: string[] = [];

const notFoundFields = new Set<string>();

const autoSkippedMethods: string[] = [];

const manualSkippedMethods: string[] = [];

let interrupted = false;


// ============================================================
// 主循环
// ============================================================

try {

    for (
        let i = 0;
        i < uniqueMethods.length;
        i++
    ) {

        const method =
            uniqueMethods[i];

        if (nonInteractive) {

            const progress =
                `处理进度：${i + 1} / ${uniqueMethods.length}  ${method}`;

            if (progressOutput.isTTY) {

                progressOutput.clearLine(0);
                progressOutput.cursorTo(0);
                progressOutput.write(progress);

            } else {

                progressOutput.write(
                    `${progress}\n`,
                );
            }

        } else {

            console.clear();

            console.log(
                "AppConfig Public API 全局引用检查",
            );

            console.log(
                "════════════════════════════════════════════════",
            );

            console.log(
                `模式：${
                    mode === "1"
                        ? "master worktree"
                        : "当前工作区"
                }`,
            );

            console.log(
                `进度：${i + 1} / ${uniqueMethods.length}`,
            );

            console.log(
                `方法：${method}`,
            );

            console.log(
                "────────────────────────────────────────────────",
            );
        }


        // ====================================================
        // 第一层：
        // 当前 AppConfig 是否还有这个方法
        // ====================================================

        const methodExists =
            hasPublicMethod(
                currentAppConfigFile,
                method,
            );


        if (!methodExists) {

            autoSkippedCount++;

            autoSkippedMethods.push(
                method,
            );

            if (!nonInteractive) {

                console.log("");

                console.log(
                    "⏭ 当前 AppConfig 已不存在该方法",
                );

                console.log(
                    "   自动跳过，不执行全局搜索",
                );
            }

            continue;
        }


        // ====================================================
        // 第二层：
        // 搜索 getter / setter / Kotlin 属性外部引用
        // ====================================================

        let methodFound =
            false;

        let methodResult =
            "";


        try {

            methodResult =
                findMethodReferences(
                    searchRoot,
                    method,
                );

            methodFound = true;

        } catch (error: any) {

            if (
                error?.status !== 1
            ) {

                console.log("");

                console.log(
                    "💥 方法/属性搜索失败",
                );

                console.log(
                    error?.stderr?.toString() ||
                    error?.message ||
                    error,
                );

                continue;
            }
        }


        // ====================================================
        // 方法或属性引用找到了
        // ====================================================

        if (methodFound) {

            foundCount++;

            foundMethods.push(
                method,
            );

            if (!nonInteractive) {

                console.log("");

                console.log(
                "❌ 找到方法/属性引用：",
                );

                console.log("");

                console.log(
                    methodResult,
                );
            }

        } else {

            // =================================================
            // 第三层：
            // 方法或属性引用没找到
            //
            // 搜索对应 private 字段
            // =================================================

            const field =
                getFieldName(
                    method,
                );


            let fieldFound =
                false;

            let fieldResult =
                "";


            if (field) {

                try {

                    fieldResult =
                        findFieldReferences(
                            searchRoot,
                            field,
                        );

                    fieldFound = true;

                } catch (error: any) {

                    if (
                        error?.status !== 1
                    ) {

                        console.log("");

                        console.log(
                            "💥 private 字段搜索失败",
                        );

                        console.log(
                            error?.stderr?.toString() ||
                            error?.message ||
                            error,
                        );

                        continue;
                    }
                }
            }


            // =================================================
            // 方法或属性引用没找到
            // private 字段也没找到
            // =================================================

            if (!fieldFound) {

                notFoundCount++;

                notFoundMethods.push(
                    method,
                );

                if (field) {

                    notFoundFields.add(
                        field,
                    );
                }

                if (!nonInteractive) {

                    console.log("");

                    console.log(
                        "方法/属性：未找到外部引用",
                    );

                    console.log(
                        `private 字段：${
                            field || "(无法推导)"
                        }`,
                    );

                    console.log(
                        "private 字段：未找到外部引用",
                    );

                    console.log("");

                    console.log(
                        "✅ 未找到引用",
                    );
                }

            } else {

                // =============================================
                // private 字段存在外部引用
                // =============================================

                foundCount++;

                foundMethods.push(
                    method,
                );

                if (!nonInteractive) {

                    console.log("");

                    console.log(
                        "⚠️ 方法/属性未找到外部引用",
                    );

                    console.log(
                        `但 private 字段 ${field} 找到了外部引用：`,
                    );

                    console.log("");

                    console.log(
                        fieldResult,
                    );
                }
            }
        }


        // ====================================================
        // 交互
        // ====================================================

        if (nonInteractive) {

            continue;
        }

        const action =
            await rl.question(
                "\n[Enter] 下一项  [s] 跳过  [q] 退出：",
            );

        const normalized =
            action
                .trim()
                .toLowerCase();


        if (
            normalized === "s"
        ) {

            manualSkippedCount++;

            manualSkippedMethods.push(
                method,
            );

            continue;
        }


        if (
            normalized === "q"
        ) {

            interrupted = true;

            console.log(
                "\n已退出",
            );

            break;
        }
    }

} finally {

    if (
        nonInteractive &&
        progressOutput.isTTY
    ) {

        progressOutput.write("\n");
    }

    rl.close();

    // ========================================================
    // 删除 master 临时目录
    // ========================================================

    if (masterRoot) {

        rmSync(
            masterRoot,
            {
                recursive: true,
                force: true,
            },
        );
    }
}


// ============================================================
// 最终结果
// ============================================================

if (!nonInteractive) {

    console.clear();
}

console.log(
    "AppConfig Public API 全局引用检查结果",
);

console.log(
    "════════════════════════════════════════════════",
);

console.log(
    `模式：${
        mode === "1"
            ? "master worktree"
            : "当前工作区"
    }`,
);

console.log(
    `总 API：${uniqueMethods.length}`,
);

console.log(
    `❌ 存在外部引用：${foundCount}`,
);

console.log(
    `✅ 未找到外部引用：${notFoundCount}`,
);

console.log(
    `⏭ AppConfig 已删除，自动跳过：${autoSkippedCount}`,
);

console.log(
    `⏭ 手动跳过：${manualSkippedCount}`,
);


// ============================================================
// 有引用
// ============================================================

if (
    !nonInteractive &&
    foundMethods.length > 0
) {

    console.log("");

    console.log(
        "❌ 存在外部引用：",
    );

    for (
        const method of foundMethods
        ) {

        console.log(
            `  ${method}`,
        );
    }
}


// ============================================================
// 无引用
// ============================================================

if (
    notFoundMethods.length > 0
) {

    console.log("");

    console.log(
        "✅ 未找到外部引用的方法：",
    );

    for (
        const method of notFoundMethods
        ) {

        console.log(
            `  ${method}`,
        );
    }
}


if (
    notFoundFields.size > 0
) {

    console.log("");

    console.log(
        "✅ 未找到外部引用的字段：",
    );

    for (
        const field of notFoundFields
    ) {

        console.log(
            `  ${field}`,
        );
    }
}


// ============================================================
// 自动跳过
// ============================================================

if (
    autoSkippedMethods.length > 0
) {

    console.log("");

    console.log(
        "⏭ 当前 AppConfig 已删除，自动跳过：",
    );

    for (
        const method of autoSkippedMethods
        ) {

        console.log(
            `  ${method}`,
        );
    }
}


// ============================================================
// 手动跳过
// ============================================================

if (
    manualSkippedMethods.length > 0
) {

    console.log("");

    console.log(
        "⏭ 手动跳过：",
    );

    for (
        const method of manualSkippedMethods
        ) {

        console.log(
            `  ${method}`,
        );
    }
}


// ============================================================

if (interrupted) {

    console.log("");

    console.log(
        "⚠️ 本次检查中途退出",
    );
}

console.log("");
console.log("检查完成。");
