# Lua、Luau、JavaScript 和 TypeScript 飞机大战

这是一个 Bevy 0.19 脚本游戏示例。Rust 共享宿主只负责窗口、键盘输入、
精灵渲染和脚本 API；移动、射击、敌机生成、碰撞、计分、生命值和重新开始
均分别由 Lua、Luau、JavaScript 和 TypeScript 实现。

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
    ├── src/shooter.ts   # TypeScript 游戏源码
    └── assets/          # 编译后 shooter.js + 独立 sprites
src/                     # 四个项目共用的 Bevy 宿主库
include/                 # 可选的原生宿主 C ABI
```

资源被有意复制到每个子项目中。运行时使用子项目传入的绝对资源根目录，
不会从其他语言项目加载脚本或图片。

## 运行

在仓库根目录分别执行：

```bash
cargo run -p plane-war-lua
cargo run -p plane-war-luau
cargo run -p plane-war-js
cargo run -p plane-war-typescript
```

操作方式：方向键或 `WASD` 移动，按住空格连续射击；生命值归零后松开并
再次按下空格重新开始。四个版本使用相同参数和随机种子，便于对比语言实现。

## 脚本 API

每个脚本都通过以下宿主函数操作画面：

```text
clear_game()
spawn_sprite(kind, id, x, y)
set_position(id, x, y)
despawn_sprite(id)
set_hud(score, lives, message)
on_update(delta_seconds, input_x, input_y, firing)
```

脚本文件支持 Bevy 资源热重载。修改当前项目 `assets` 下的脚本后，游戏状态
会用新脚本重新初始化。

## 构建验证

Lua、Luau 和 QuickJS 后端 feature 互斥，需要分别检查，不要使用
`cargo check --workspace`：

```bash
cargo check -p plane-war-luau
cargo check -p plane-war-lua
cargo check -p plane-war-js
cargo check -p plane-war-typescript
```

修改 TypeScript 后先重新生成它自己的运行资产：

```bash
cd projects/ts
npm install
npm run build
```

`package-lock.json` 固定 TypeScript 7.0.2；编译后的 `assets/shooter.js` 已纳入
项目，因此只运行游戏时不需要全局安装 `tsc`。

共享库仍可产出 `rlib`、`cdylib` 和 `staticlib`，C 头文件位于
`include/game_runtime.h`。
