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
会用新脚本重新初始化，并在终端打印 `Reloading script after source change`。
`just run-ts` 会同时运行 TypeScript watch compiler，因此修改
`projects/ts/src/shooter.ts` 也会自动编译并触发游戏重载。

## 构建验证

Lua、Luau、JavaScript 和 TypeScript 后端 feature 互斥，需要分别检查，不要使用
`cargo check --workspace`：

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

共享库仍可产出 `rlib`、`cdylib` 和 `staticlib`，C 头文件位于
`include/game_runtime.h`。
