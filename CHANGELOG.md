# 更新日志 (Changelog)

本文件用于记录本项目底层 Bevy 运行时及引擎依赖的同步更新历史。

## [Bevy 0.19.1] - 2026-09-28

### 底层 Bevy 运行时同步更新
- **版本升级**：将底层 Bevy 引擎版本由 `0.19.0` 升级至 `0.19.1`。
- **上游版本发布**：[Bevy v0.19.1](https://github.com/bevyengine/bevy/releases/tag/v0.19.1)
- **代码对比与变更**：[`v0.19.0...v0.19.1`](https://github.com/bevyengine/bevy/compare/v0.19.0...v0.19.1)
- **上游发布说明**：
  > A full diff of what's in this release can be seen here: https://github.com/bevyengine/bevy/compare/v0.19.0...v0.19.1
- **已同步更新的项目配置**：
  - `Cargo.toml`：`bevy` 依赖升级至 `0.19.1`（工作区 `bevy_*` 子模块依赖：`0.19`）
  - `crates/runtime-cdylib/Cargo.toml`：`bevy` 依赖升级至 `0.19.1`
  - `examples/android-demo-host/runtime/Cargo.toml`：`bevy` 依赖升级至 `0.19.1`
  - `Cargo.lock` 与 `examples/android-demo-host/runtime/Cargo.lock`：锁文件依赖版本同步锁定
- **自动化验证**：`just check` 校验通过（Lua、JavaScript 与 TypeScript 各项目编译及类型检查均正常）。
