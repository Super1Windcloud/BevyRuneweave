# Bevy Runeweave

**Bevy Runeweave 是一个将多种脚本语言编织进 Bevy ECS 世界的游戏框架。**

`Rune` 代表赋予世界行为的脚本符文，`Weave` 表达脚本、组件与系统在 ECS 中的
组合。框架在 Bevy 之上封装窗口、输入、渲染、资源管理、ECS 脚本 API、热重载和
Rust 宿主能力，并允许使用 Lua 5.5、Luau、JavaScript 或 TypeScript 编写玩法逻辑。
开发者可以直接复用统一的框架运行时与数据驱动模型，按项目选择合适的脚本语言。

仓库内的飞机大战示例名为 **Script Squadron**。同一套游戏分别由四种脚本语言
实现，用于展示多语言接入、独立项目组织、资源隔离、热重载以及 Rust 与脚本之间
的协作方式。

## 框架能力

- **基于 Bevy ECS 封装**：实体由组件数据组合，脚本写入 Component 和 Resource，
  Bevy System 负责查询、处理与渲染。
- **多脚本语言开发**：当前支持 Lua 5.5、Luau、JavaScript 和 TypeScript；JavaScript
  与编译后的 TypeScript 由 QuickJS 执行。
- **玩法逻辑脚本化**：脚本自身同样采用 ECS World、Component、Resource 和 System
  组织移动、射击、敌机生成、碰撞、计分、生命值与重新开始等玩法。
- **项目与资源隔离**：每种脚本语言拥有独立的可执行项目、脚本和资源目录，避免不同
  语言实现之间产生隐式依赖。
- **开发期热重载**：脚本作为 Bevy 资源加载，修改后可自动重新载入，缩短玩法迭代周期。

Bevy Runeweave 的框架主包为 `bevy-runeweave`，Rust crate 为
`bevy_runeweave`，TypeScript 包为 `@superwindcloud/bevy-runeweave`。
Script Squadron 的四个可执行示例分别为 `script-squadron-lua`、
`script-squadron-luau`、`script-squadron-js` 和
`script-squadron-typescript`。

Runeweave 核心提供四种语言一致的 Entity、Component、Resource 与 Query API；
飞机大战宿主只负责窗口、键盘输入，以及将示例组件映射成精灵和 HUD。具体玩法均
分别由 Lua、Luau、JavaScript 和 TypeScript 实现。

## 项目结构

```text
projects/
├── lua/                 # 独立 Lua 5.5.0 可执行项目
│   └── assets/          # shooter.lua + 独立 sprites
├── luau/                # 独立 Luau 可执行项目
│   └── assets/          # shooter.luau + 独立 sprites
├── js/                  # 独立 QuickJS 可执行项目
│   └── assets/          # shooter.js + 独立 sprites
└── ts/                  # TypeScript 7.0.2 + QuickJS 可执行项目
    ├── src/             # TypeScript 游戏源码 + Runeweave API 声明
    └── assets/          # 编译后 shooter.js + 独立 sprites
src/                     # bevy-runeweave 框架核心与共享 Bevy 宿主
├── ecs_api/             # 四语言统一的通用 ECS API
│   ├── bindings/        # Lua/Luau 与 QuickJS/TypeScript 语言适配
│   ├── command.rs       # 可同步读取的快照与 Bevy 写入队列
│   ├── value.rs         # 跨语言结构化值模型
│   └── world.rs         # 通用 Entity、Component、Resource 同步
├── example_host.rs      # Script Squadron 贴图、Transform 与 HUD 映射
├── runtime/             # 应用装配、输入回调、热重载与宿主入口
└── lib.rs               # feature 约束与公开 API 导出
docs/ecs-api.md          # 通用 ECS API 契约与四语言示例
bevy_mod_scripting/      # Lua 5.5、Luau、QuickJS/TypeScript 脚本运行时
include/                 # 可选的原生宿主 C ABI
```

资源被有意复制到每个子项目中。运行时使用子项目传入的绝对资源根目录，
不会从其他语言项目加载脚本或图片。

## 运行

所有命令都收敛在根目录 `justfile`。先查看可用任务：

```bash
just
```

分别启动四个版本：

```bash
just run-lua
just run-luau
just run-js
just run-ts
```

操作方式：方向键或 `WASD` 移动，子弹会按固定冷却自动连续发射，不需要射击按键；
生命值归零后松开并再次按下空格重新开始。击毁敌机获得的积分会持续累加，没有玩法
上限。四个版本使用相同参数和随机种子，便于对比语言实现。

## ECS 数据驱动设计

框架已废弃 Roblox 风格的 `GameApi`、Service 发现和 Workspace 对象模型。脚本不会
获取带方法的游戏对象，也不会通过 Service 命令宿主执行一段预设业务流程；它只描述
世界数据如何变化：创建或销毁 Entity、插入或更新 Component、写入 Resource。

Rust 宿主将这些写入提交到 Bevy World，独立 System 再根据组件和资源变化更新
`Sprite`、`Transform` 与 HUD。玩法数据与呈现逻辑因此解耦，同一种脚本绑定也可以
扩展到新的组件和系统，而不需要继续扩张一个中心化门面。

```text
脚本逻辑 -> ECS 写入队列 -> Component / Resource -> Bevy System -> 渲染与界面
```

游戏脚本内部也遵循相同的数据驱动模型，而不是使用包含位置、速度和行为的 Player、
Bullet、Enemy 对象数组：

- `World` 使用以 Entity ID 为 key 的稀疏组件存储，分别保存 Transform、Velocity、
  Collider、Sprite，并用 Player、Bullet、Enemy 标签组件表达查询条件。
- `Resources` 保存持续累加且不封顶的分数、生命值、随机种子、生成冷却、自动射击
  冷却和受击冷却等全局状态。敌机飞出边界只会被销毁，不会自动扣除生命；玩家碰撞
  才会受伤，并有短暂无敌间隔防止连续扣血。
- Movement、Weapon、EnemySpawn、Bounds、Collision 等 System 按固定 schedule 查询并
  更新组件，不把行为方法挂载到 Entity 上。
- System 只标记待销毁 Entity，遍历结束后统一 flush 结构变更，避免在查询期间修改
  组件集合；RenderSync System 最后把脚本组件数据提交给宿主 ECS。

脚本侧使用稳定字符串作为跨语言 Entity key；它只用于定位 Bevy Entity，不代表带有
行为和生命周期方法的对象。四种语言共享以下通用 API：

```text
ecs_world_clear()
ecs_entity_spawn / ecs_entity_exists / ecs_entity_despawn
ecs_component_insert / ecs_component_get / ecs_component_has / ecs_component_remove
ecs_query
ecs_resource_set / ecs_resource_get / ecs_resource_remove
```

例如，一个可渲染实体由 `ecs_entity_spawn` 创建，再分别插入 `sprite` 和 `transform`
组件。Runeweave 不认识这些业务名称；Script Squadron 宿主 System 查询结构化组件并
映射成 Bevy `Sprite` 和 `Transform`。新增能力时不再修改四份语言绑定，而是新增组件、
资源和消费它们的 Bevy System。完整契约见 [`docs/ecs-api.md`](docs/ecs-api.md)。

脚本文件支持 Bevy 资源热重载。修改当前项目 `assets` 下的脚本后，游戏状态
会用新脚本重新初始化，并在终端打印 `Reloading script after source change`。
`just run-ts` 会同时运行 TypeScript watch compiler，因此修改
`projects/ts/src/shooter.ts` 也会自动编译并触发游戏重载。

## 构建验证

所有应用和 `bevy_mod_scripting` crate 都属于同一个 Cargo workspace，共享根
`Cargo.lock`、依赖版本和格式化配置。Lua 与 Luau 后端 feature 互斥，因此检查时
仍需分别选择后端，不要使用会统一成员 feature 的 `cargo check --workspace`：

运行 `just check` 分别检查四个项目，运行 `just test` 使用对应脚本引擎执行
玩法测试；`just verify` 会执行格式检查、项目检查和全部玩法测试。

修改 TypeScript 后先重新生成它自己的运行资产：

```bash
just ts-install
just ts-build
```

`package-lock.json` 固定 TypeScript 7.0.2；编译后的 `assets/shooter.js` 已纳入
项目，因此只运行游戏时不需要全局安装 `tsc`。

发布构建使用 `just build`，也可以用 `just build-lua`、`just build-luau`、
`just build-js` 或 `just build-ts` 单独构建。

## 跨平台运行时

`scripts/build-runtime.sh` 将 C ABI 运行时、头文件和对应语言的游戏资源一起归档到
`dist/runtimes/<platform>/<language>/`。每种语言会独立构建，避免 Lua 5.5 与 Luau
后端的互斥 feature 被 Cargo 合并。

```bash
# 构建某个平台的全部语言运行时
just build-runtime-macos
just build-runtime-windows
just build-runtime-linux
just build-runtime-android
just build-runtime-ios

# 只构建一个语言，或通过统一入口指定平台
just build-runtime-android js
just build-runtime linux typescript
```

Windows 和 Linux 在对应宿主机上可直接构建；从其他系统交叉构建时需安装 Zig 与
`cargo-zigbuild`，Windows 上运行脚本需要 Git Bash。Android 需要 `cargo-ndk`、
Android NDK 和
`ANDROID_NDK_HOME`，默认构建 `arm64-v8a`、`armeabi-v7a`、`x86_64`，最低 API 为
26。iOS 只能在安装 Xcode 的 macOS 上构建，默认生成包含 arm64 真机和 Apple Silicon
模拟器 slice 的 `BevyRuneweave.xcframework`。可通过脚本帮助中列出的环境变量覆盖
目标架构和输出目录：

```bash
scripts/build-runtime.sh --help
ANDROID_ABIS=arm64-v8a just build-runtime-android luau
IOS_SIMULATOR_TARGETS=aarch64-apple-ios-sim,x86_64-apple-ios just build-runtime-ios js
```

框架主库产出供 Rust 项目使用的 `rlib`；`crates/runtime-cdylib` 为 Windows、macOS、
Linux 和 Android 各生成一个动态库，`crates/runtime-staticlib` 仅用于组成 iOS
XCFramework。宿主使用的 C 头文件位于 `include/game_runtime.h`。

Rust 宿主窗口默认嵌入 Bevy 官方图标。运行时窗口图标在 Windows 和 Linux/X11
生效；macOS Dock 图标以及 Android/iOS 应用图标仍应由宿主应用包配置。
