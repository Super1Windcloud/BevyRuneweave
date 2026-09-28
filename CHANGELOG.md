# 更新日志 (Changelog)

本文件用于记录本项目底层 Bevy 运行时及引擎依赖的同步更新历史。

## [Bevy 0.19.1] - 2026-09-28

### 底层 Bevy 运行时同步更新
- **版本升级**：将底层 Bevy 引擎版本由 `0.19.0` 升级至 `0.19.1`。
- **上游版本发布**：[Bevy v0.19.1](https://github.com/bevyengine/bevy/releases/tag/v0.19.1)
- **代码对比与变更**：[`v0.19.0...v0.19.1`](https://github.com/bevyengine/bevy/compare/v0.19.0...v0.19.1)
- **已同步更新的项目配置**：
  - `Cargo.toml`：`bevy` 依赖升级至 `0.19.1`（工作区 `bevy_*` 子模块依赖：`0.19`）
  - `crates/runtime-cdylib/Cargo.toml`：`bevy` 依赖升级至 `0.19.1`
  - `examples/android-demo-host/runtime/Cargo.toml`：`bevy` 依赖升级至 `0.19.1`
  - `Cargo.lock` 与 `examples/android-demo-host/runtime/Cargo.lock`：锁文件依赖版本同步锁定
- **自动化验证**：`just check` 校验通过（Lua、JavaScript 与 TypeScript 各项目编译及类型检查均正常）。

### Bevy 引擎内部更新详情 (共 58 项变更)
#### 渲染与着色器 (Rendering & Shaders)
- fixed far plane intersection test for fogvolumes ([#24220](https://github.com/bevyengine/bevy/pull/24220))
- fixed spotlight shadow issue due to incorrect basis reconstruction ([#24238](https://github.com/bevyengine/bevy/pull/24238))
- Add missing import for light probe const `..._LIGHTMAPPED_MESH_DIFFUSE` in irradiance_volume.wgsl ([#24714](https://github.com/bevyengine/bevy/pull/24714))
- Fix sorted batching without indirect drawing ([#24708](https://github.com/bevyengine/bevy/pull/24708))
- Prevent panic in `check_dir_light_mesh_visibility` ([#24807](https://github.com/bevyengine/bevy/pull/24807))
- Solari: Fix normal maps and support two-channel maps ([#24880](https://github.com/bevyengine/bevy/pull/24880))
- Solari: Fix removed RaytracingMesh3d component ([#24764](https://github.com/bevyengine/bevy/pull/24764))
- fix: fps_overlay graph shader reads one element past its storage buffer ([#24914](https://github.com/bevyengine/bevy/pull/24914))
- Fix split screen + transparent material rendering ([#24861](https://github.com/bevyengine/bevy/pull/24861))
- Fix shadow panic when a camera is despawned before extraction ([#24877](https://github.com/bevyengine/bevy/pull/24877))
- Ensure RenderLayers is a Component on every ExtractedLight and its ShadowView/ExtractedView ([#24797](https://github.com/bevyengine/bevy/pull/24797))
- Clamp `SpotLight.outer_angle` to pi/2-epsilon at extraction time ([#24734](https://github.com/bevyengine/bevy/pull/24734))
- Fix mismatch in UI color conversions ([#24886](https://github.com/bevyengine/bevy/pull/24886))
- Fix crash when adding ContactShadows to a camera at runtime ([#24977](https://github.com/bevyengine/bevy/pull/24977))
- Fix atmosphere rendering in rotated and Z-up worlds ([#24998](https://github.com/bevyengine/bevy/pull/24998))
- Don't batch depth only prepasses when using custom vertex and fragment shaders ([#24843](https://github.com/bevyengine/bevy/pull/24843))
- Transform Gizmo Rendering Bug: Incorect placement when rendering to a camera with custom viewport. ([#25106](https://github.com/bevyengine/bevy/pull/25106))
- Fix uninitialized-drawable pink screen on iOS ([#25176](https://github.com/bevyengine/bevy/pull/25176))
- Fix deferred lighting out of sync shader defs ([#25254](https://github.com/bevyengine/bevy/pull/25254))
- Fix: overlapping light probes overwrite (instead of accumulate) diffuse IBL ([#25268](https://github.com/bevyengine/bevy/pull/25268))
- Fix mesh re-allocation logic ([#25259](https://github.com/bevyengine/bevy/pull/25259))
- Properly layer emission under clearcoat ([#25256](https://github.com/bevyengine/bevy/pull/25256))
- Fix shader out of bounds accesses ([#25252](https://github.com/bevyengine/bevy/pull/25252))
- Fix 2D flicker by always dequeueing retained phase items ([#25163](https://github.com/bevyengine/bevy/pull/25163)) ([#25253](https://github.com/bevyengine/bevy/pull/25253))
- Fix incorrect `textureGather` argument in SSAO ([#25338](https://github.com/bevyengine/bevy/pull/25338))
- Fix normalization in SSAO calculation ([#25334](https://github.com/bevyengine/bevy/pull/25334))

#### UI 与文本排版 (UI & Text)
- Another text measurement fix ([#24669](https://github.com/bevyengine/bevy/pull/24669))
- Text performance regression fix ([#24663](https://github.com/bevyengine/bevy/pull/24663))
- Fix wrong border radius corners on diagnostics overlay ([#24713](https://github.com/bevyengine/bevy/pull/24713))
- bevy_text: give swash a stable font id ([#24710](https://github.com/bevyengine/bevy/pull/24710))
- implement `Clone` for `IsDefaultUiCamera` ([#24729](https://github.com/bevyengine/bevy/pull/24729))
- Always centered radio marks ([#24749](https://github.com/bevyengine/bevy/pull/24749))
- Wrong UI camera fix ([#24982](https://github.com/bevyengine/bevy/pull/24982))
- Don't cull rotated UI text glyphs ([#24999](https://github.com/bevyengine/bevy/pull/24999))
- Fix: Steam OSK shifted text input ([#25068](https://github.com/bevyengine/bevy/pull/25068))

#### ECS 架构与场景系统 (ECS, Scenes & Observers)
- bevy_scene: don't use std Result ([#24666](https://github.com/bevyengine/bevy/pull/24666))
- Fix bsn nested entity references ([#24742](https://github.com/bevyengine/bevy/pull/24742))
- :bug: Fixes BSN support for fully qualified component paths ([#24817](https://github.com/bevyengine/bevy/pull/24817))
- Try despawning the related Observer from ObservedBy. ([#24813](https://github.com/bevyengine/bevy/pull/24813))
- Fix observers not removing themselves from ObservedBy. ([#24802](https://github.com/bevyengine/bevy/pull/24802))
- Move bsn! macro docs back into macro crate, avoiding re-re-export issues ([#24828](https://github.com/bevyengine/bevy/pull/24828))
- Fix lifetime issues for native subexpressions in bsn! enum variants ([#24876](https://github.com/bevyengine/bevy/pull/24876))
- Fix SubApp::add_message does not schedule `message_update_system` ([#24866](https://github.com/bevyengine/bevy/pull/24866))
- Fix bugs with remote entity allocation ([#24972](https://github.com/bevyengine/bevy/pull/24972))

#### 平台与窗口输入 (Platform, Window & Input)
- Fix handling of `WindowResolution` change ([#24746](https://github.com/bevyengine/bevy/pull/24746))
- Don't panic when a wasm asset response body fails to read ([#25209](https://github.com/bevyengine/bevy/pull/25209))
- Use `None` instead of `Confined` fallback for `CursorGrabMode` ([#25273](https://github.com/bevyengine/bevy/pull/25273))
- add "wayland-data-control" feature to arboard, if "wayland" feature set ([#25361](https://github.com/bevyengine/bevy/pull/25361))

#### 资源与音视频 (Assets & Audio)
- Fix HandleTemplate::Value not adding the asset directly. ([#24885](https://github.com/bevyengine/bevy/pull/24885))
- Fix MP4 Audio Playback Failure in Bevy 0.19.0 ([#24879](https://github.com/bevyengine/bevy/pull/24879))

#### 通用修复与优化 (General Fixes & Optimizations)
- `clip_check_recursive` fix ([#24684](https://github.com/bevyengine/bevy/pull/24684))
- Fix Visibility component having no effect on infinite grid ([#24723](https://github.com/bevyengine/bevy/pull/24723))
- fix: add missing png feature to bevy_feathers feature ([#24727](https://github.com/bevyengine/bevy/pull/24727))
- `ImageMeasure` border-box sizing fix ([#24674](https://github.com/bevyengine/bevy/pull/24674))
- Clear stale components when `FullscreenMaterial` is removed ([#24907](https://github.com/bevyengine/bevy/pull/24907))
- Fix `binding_arrays_are_usable` check ([#25261](https://github.com/bevyengine/bevy/pull/25261))
- Fix documented despawn lifecycle event order ([#25367](https://github.com/bevyengine/bevy/pull/25367))