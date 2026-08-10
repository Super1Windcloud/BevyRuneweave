# Runtime 重新构建规则

本文用于判断一次修改是否需要重新运行 Runeweave runtime 构建，以及应该重新生成
runtime、脚本资源还是宿主安装包。

## 产物边界

仓库包含三类相互独立的发布产物：

| 产物 | 主要内容 | 默认输出 |
| --- | --- | --- |
| Runtime | Lua 5.5、QuickJS、BMS 反射 API、Bevy runtime、C ABI | `dist/runtimes/<platform>/<target>/` |
| Assets | Lua/JavaScript/编译后的 TypeScript、图片、`engineConfig.json` | `dist/releases/<tag>/` |
| Host/Installer | desktop launcher、Android/iOS host、NSIS、DMG | `dist/installers/` 或平台构建目录 |

判断原则：修改是否会进入 native runtime library，或者改变 runtime package 内的头文件和
构建信息。若不会，则不应仅因为脚本或宿主变化而重新构建 runtime。

## 必须重新构建 Runtime

下列修改会影响 native runtime library：

- `src/runtime/**`：应用装配、脚本加载、热重载、窗口与运行时配置。
- `src/script_api/**`：BMS 函数注册、真实 Bevy Component/Resource、输入与网络服务。
- `src/lib.rs`：runtime 对外导出和模块装配。
- `bevy_mod_scripting/**`：BMS 反射/函数注册、WorldGuard、Lua 5.5、QuickJS、回调生命周期和脚本资源加载器。
- `crates/runtime-cdylib/**` 或 `crates/runtime-staticlib/**`：C ABI 动态库或静态库入口。
- 会影响上述 crate 的 `Cargo.toml`、`Cargo.lock`、features、`build.rs` 或 native dependency。
- 通过 `include_bytes!` 等方式编译进 runtime 的资源，例如默认窗口图标。
- Rust 侧 C ABI 函数、参数、返回值或导出符号发生变化。
- 构建目标、ABI、feature、Debug/Release profile 发生变化。

只需构建实际交付或测试的平台。例如只验证 macOS Debug 时运行：

```bash
just build-runtime-macos
```

发布 macOS Release 时运行：

```bash
just build-runtime-macos --release
```

如果同一 runtime 改动需要交付所有平台，则分别运行：

```bash
just build-runtime-windows --release
just build-runtime-macos --release
just build-runtime-linux --release
just build-runtime-android --release
just build-runtime-ios --release
```

Android runtime 只支持并默认构建 `arm64-v8a` 和 `x86_64`。`ANDROID_ABIS` 可以选择其中
一个或两个，但不能重新启用 `armeabi-v7a` 或 `x86`。

## 只需重新生成 Runtime Package

以下修改可能不改变 native library，但需要重新运行 `build-runtime` 来刷新归档内容：

- `include/game_runtime.h` 的声明、注释或版本信息发生变化。
- `scripts/build-runtime.ts` 的目录结构、命名、metadata 或复制规则发生变化。
- `build-info.txt` 内容或 runtime 输出策略发生变化。

如果 C 头文件的函数声明与 ABI 同时变化，则不仅需要重新构建 runtime，还必须重新编译
所有使用该 ABI 的 host。

## 不需要重新构建 Runtime

### 游戏脚本与资源

以下内容由 runtime 在启动或热重载时读取，不会编入 native library：

- `projects/**/game/src/**` 下的 TypeScript 源码。
- `projects/**/game/assets/**` 下的 Lua、JavaScript、图片和其他游戏资源。
- `engineConfig.json`、`module.json` 和 TypeScript API 类型声明。
- `templates/game-project/**` 和 `scripts/create-game-project.ts`。

这些改动只需重新构建 TypeScript 或重新生成资源包：

```bash
just ts-build
just package-assets-typescript 0.0.1
just package-assets-js 0.0.1
just package-assets-lua 0.0.1
```

`package-assets-typescript` 会先编译 TypeScript。Lua Release 资源会经过 `luamin`，但这些
处理均不会改变 runtime library。

### Host 与安装包

以下内容通常只要求重新构建对应 host 或安装包：

- `examples/desktop-demo-host/**` 的 UI、下载、目录打开和 launcher 行为。
- Android host 的 Kotlin、Gradle、Manifest 和普通 Android resources。
- iOS host 的 Swift、Xcode project 和普通 iOS resources。
- NSIS、DMG 脚本及只用于应用包的图标或 metadata。

desktop 完整安装包命令会按当前实现自动重新构建 runtime 和 launcher：

```bash
just package-windows-installer --release
just package-macos-dmg --release
```

若只修改 desktop launcher 并进行本地验证，可以直接构建
`examples/desktop-demo-host`，无需主动运行 `build-runtime`。完整 installer 命令仍会为了
生成自洽安装包而重新执行 runtime 构建。

## 混合修改判断流程

按以下顺序判断：

1. 是否修改了 Rust runtime、脚本后端、ECS bindings、native dependency 或 ABI？
   是则重新构建目标平台的 runtime。
2. 是否只修改了 C header 或 runtime 打包逻辑？是则重新生成 runtime package；ABI 变化
   时同时重建 host。
3. 是否只修改了游戏脚本、图片或 `engineConfig.json`？是则只重新构建/打包 assets。
4. 是否只修改了 launcher、移动 host 或 installer？是则只重新构建相应 host/installer。
5. 同时命中多类时，分别更新对应产物，不用把 assets 修改错误地归因到 runtime。

## Profile 与输出覆盖

所有 runtime recipe 默认使用 Debug；只有显式传入 `--release` 才构建 Release。

```bash
just build-runtime-linux
just build-runtime-linux --release
```

同一平台和 target 的 Debug、Release package 使用同一个
`dist/runtimes/<platform>/<target>/` 目标目录。后执行的构建会替换该目录，所以发布前应检查
`build-info.txt` 中的 `profile`、`target` 和 `platform`。

## 常见示例

| 修改 | Runtime | Assets | Host/Installer |
| --- | --- | --- | --- |
| 修改 `shooter.ts` 游戏逻辑 | 否 | 是 | 否 |
| 修改 Lua/JS 脚本或 sprite | 否 | 是 | 否 |
| 修改 `engineConfig.json` | 否 | 是 | 否 |
| 新增 Lua/QuickJS ECS API | 是 | 同步脚本/API 声明后需要 | 仅 ABI 变化时需要 |
| 修改 `src/script_api` 场景渲染实现 | 是 | 否 | 重新分发 runtime 时需要 |
| 修改 desktop launcher 按钮 | 否 | 否 | 是 |
| 修改 `game_runtime.h` 注释 | 重新生成 package | 否 | 否 |
| 修改 C ABI 函数签名 | 是 | 否 | 是 |
| Debug 改为 Release | 是 | 否 | 按交付目标决定 |
