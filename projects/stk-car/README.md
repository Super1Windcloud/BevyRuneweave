# STK Car

基于 RuneWeave / QuickJS 的独立 TypeScript 3D 赛车项目，复用 SuperTuxKart 的灯塔赛道和 Tux 资源。
游戏规则、输入、相机跟随、界面和资源转换工具使用 TypeScript；原生层提供共享 BMS 相机、环境和 UI 交互接口。
当前优先对齐 PC 单人竞速：主菜单 → 选车 → 难度/模式 → 赛道 → 圈数/AI/反向设置 → 比赛 → 暂停/结算。

## 启动

从仓库根目录执行，复用根目录的 `node_modules` 和 `target/`：

```sh
just prepare-stk-car /Users/super/demo/stk-assets /Users/super/demo/stk-code
just run-stk-car
```

路径是本机示例；也可运行 `npm --prefix projects/stk-car run prepare:assets -- --source=<stk-assets绝对路径> --code=<stk-code绝对路径>`。
资源由本地官方资源包转换，不会将整个 706 MiB 资源目录复制到项目。
转换后的 GLB、字体、图片及游戏 JS 已忽略，首次使用或克隆后先执行资源准备。
源文件指纹保存在 `modules/stk-car/game/assets/licenses/source-manifest.json`。

```sh
npm --prefix projects/stk-car run check
npm --prefix projects/stk-car run typecheck
npm --prefix projects/stk-car test
npm --prefix projects/stk-car run package
```

`check` 使用 Biome；类型检查单独执行。`package` 生成 `dist/stk-car/stk-car.zip` 和 SHA-256，
ZIP 内使用宿主支持的 `assets/engineConfig.json` 结构；不会上传或修改远程 Release。
新包使用 `scene_set_camera_3d`、`scene_set_environment` 和 `ui_button_hovered`，运行时必须与当前源码匹配。
本轮优先 PC；Android/iOS 宿主后续需要重建并安装包含这些接口的统一原生运行库。
只更新游戏 ZIP 不会更新已安装的 `.so` / XCFramework。

## 操作

| 操作 | PC 键盘（对照原版默认值） | 保留的触屏分支 |
| --- | --- | --- |
| 驾驶 | ↑ 加速，↓ 先刹车再倒车，← → 转向；选项可启用 WASD | 左侧摇杆及油门/刹车 |
| 氮气 | N | 氮气按钮 |
| 漂移 | V，持续漂移后松开获得加速 | 漂移按钮配合摇杆 |
| 使用道具 | 空格；普通赛放香蕉，计时赛消耗加速道具 | 道具按钮 |
| 回到赛道 | Backspace | 救援按钮 |
| 回看 | 按住 B | 无单独按钮 |
| 暂停 / 返回 | Esc | 暂停按钮 |
| 菜单选择 / 确认 | 方向键或 Tab / Enter；鼠标悬停、点击 | 点击按钮 |

界面默认跟随系统语言：中文系统显示简体中文，其余显示英文。PC 隐藏摇杆和触屏技能按钮。
保留的移动分支限定横屏并避开安全区，本轮不进行移动端验收。
切后台会暂停，返回后手动继续。最佳整场成绩按游戏名隔离保存。

## 首版验证记录（上一轮）

| 项目 | 结果 |
| --- | --- |
| Biome、游戏与工具 TypeScript 类型检查 | PASS |
| 游戏、触屏、语言、资源与脚本生命周期测试 | PASS，10 项 |
| BMS 相机输入防御与 Lua / QuickJS 注册测试 | PASS，2 项 |
| macOS 项目 `cargo check -p stk-car-ts --offline` | PASS |
| Android arm64 统一 cdylib 编译检查 | PASS，通过 `cargo ndk -t arm64-v8a -P 26 check -p bevy-runeweave-runtime-cdylib --lib --offline`；设置本机 `ANDROID_NDK_HOME` |
| iOS arm64 共享运行库编译检查 | PASS，`cargo check -p bevy-runeweave --lib --target aarch64-apple-ios --offline` |
| macOS 原生加载 | PASS，模型、中文界面、键盘开始比赛；截图保存在本机 `dist/stk-car/desktop-preview.png` |
| 资源 ZIP | PASS，30 个文件，CRC、入口和横屏配置检查通过 |
| Windows / Linux 编译与运行 | NOT_RUN，本次未建立跨平台构建缓存 |
| Android / iOS 新运行库打包、安装及真机输入 | NOT_RUN |
| 完整原生比赛、实际帧率、完整移动端视觉验收 | NOT_RUN；三圈比赛已通过脚本模拟 |

## PC 对齐与上一轮验证

- 使用原版 `main_menu.stkgui`、`karts.stkgui`、`race_setup.stkgui`、`track_info.stkgui` 和暂停菜单作为流程依据，复用原版 logo、模糊背景、难度/模式/功能图标；菜单支持键盘、鼠标悬停和点击。
- 可以选择 Tux、Pidgin、Wilber、Suzanne；焦点切换会更新旋转的 3D 赛车预览。对手使用不同模型和各自的车轮，车轮按各车速度滚动。
- PC 比赛 HUD 使用左侧名次列表、左下路线小地图与车手图标、右下车速/氮气、右上圈数、计时与道具状态。
- `scene.xml` 层级遍历导入 164 个模型实例，包括全部 70 个 library 实例和 115 个 LOD 实例（与 library 统计有重叠），18 种源模型、96,541 个三角形。LOD 使用最高细节模型，不把模板位置当作实例位置。
- 静态世界矩阵正确组合父子平移、旋转和非等比缩放，补齐原版天空盒；环境接口应用源文件中的太阳/环境色及 20–160 米、最大透明度 0.5 的雾。光强转换为 Bevy 单位，不表示两种渲染器逐像素相同。
- 默认圈数恢复原版灯塔的 4 圈，可设为 1–20 圈、0–3 名 AI、反向赛道和四档难度。计时赛移除礼盒和 AI，保留氮气瓶，按圈数发放 zipper 加速道具。
- 操作依据 `stk-code/src/input/keyboard_config.cpp:56`；基础速度、难度/车型倍率、氮气容量 20、小瓶 1/大瓶 3、漂移加速阈值 1/3 秒参考 `data/kart_characteristics.xml`。刹车过零后倒车，抢跑有惩罚，正确起步有奖励。
- 成绩按模式、圈数、方向和难度隔离；比赛设置保存到独立键，旧存档不被覆盖。
- 资源包使用显式文件清单，排除上一轮残留的模型和转换中间文件。

本轮：Biome、游戏/工具类型检查、16 项游戏/资源/PC 流程测试通过；共享运行时 API 测试 30 项通过、1 项性能基准按默认忽略。
macOS 编译及脚本加载通过。原生画面、完整鼠标/键盘操作和 FPS 验收为 **BLOCKED**：本机 `CGSSessionScreenIsLocked=1`、非控制台会话，WindowServer 拒绝窗口截图。
`dist/stk-car/desktop-preview.png` 是上一轮截图，不能作为本轮新 UI/场景的视觉证据。
本轮未重打 Android/iOS 包，未运行 Windows/Linux 目标，不据 macOS 结果推断它们通过。

## 车辆尺寸与性能优化

- 追尾相机基础距离由 6.5 米缩短到 3.8 米，视角由 75° 收窄到 55°；位置跟随延迟限制在 0.75 米，避免加速后车辆再次缩小。选车预览同步拉近，不改变车辆模型、碰撞尺寸和赛道比例。
- 静态地图按材质和 64 米空间分区合批，绘制 primitive 从 285 减少到 159；保留全部 96,541 个三角形、法线、顶点色、UV 和透明物体的独立排序，并限制每批不超过 65,535 个顶点。
- 场景/UI 查询复用 Bevy `QueryState` 元数据，实体、组件及脚本归属仍从真实 World 读取；相同相机参数不触发无效变更。PC 比赛跳过菜单轮询，窗口尺寸改为每 100 毫秒检查，移动端仍每帧检查。
- 开发构建为 ECS/PBR/渲染核心以及 Metal 的 wgpu/Objective-C 调用链启用局部编译优化，保留调试断言和 ABI 校验，复用根目录 `target/`；首次切换需重编译关联依赖，游戏代码继续增量构建。
- PC 默认显示 FPS、脚本耗时和帧间隔 P95，F3 可切换。FPS 来自真实脚本回调的墙钟间隔，不使用被运行时截断的游戏 delta，也不代表独立 GPU 计时。
- STK 的桌面窗口设置 `vsync: false`，避免本机 Metal 呈现等待造成的帧间隔累积；其他游戏保留原有默认值，移动端不使用此桌面偏好。STK 3D 画面使用 FXAA，减少 Retina 分辨率下的多重采样开销；未配置渲染选项的游戏仍默认 4× MSAA。

验证记录与截图保存在本机 `dist/stk-car/performance/`。本轮优先 macOS 原生前台验收，Windows/Linux/Android/iOS 未重新构建或运行。

本轮最终验证：Biome、TypeScript、21 项游戏/资源测试、35 项共享 API 测试和 14 项运行时测试通过；性能基准测试按默认忽略 1 项。
Apple M5、1280×720 逻辑窗口、单进程前台约 30 秒采样，平均脚本回调帧率由 34.45 提升到 50.67 FPS，脚本耗时由 6.43 降到 2.07 毫秒；仍未稳定 60 FPS。
前台状态逐秒确认，包含 6 秒加速操作；这是当前桌面环境的交互对比，不是独立 GPU 或隔离基准测试。统计见 `dist/stk-car/performance/comparison.json`。
音频除解码与队列检查外，已通过仅捕获本游戏进程的系统音频流确认非零输出；最终资源包 116 个文件、29.26 MiB，CRC 与 SHA-256 校验通过。

## 原版菜单与音频

主菜单按提供的原版 PC 截图调整：灰白棋盘背景、居中大 Logo、故事/单人/分屏/在线/附加组件五个入口、右上本地玩家栏及底部八个工具图标。
使用原版普通/选中图标及底栏图片，支持鼠标、键盘导航和工具提示。故事、分屏、联机、附加组件、成就及大奖赛编辑器仍为说明入口，不表示这些模式已经移植；最高成绩入口沿用当前单人赛道记录。

主菜单使用 `main_theme.music` 指定的 `menutheme.ogg`，灯塔使用 `track.xml` 指定的 `klabauter_dance.music`，结果页根据胜负选择主题曲。
接入菜单切换/确认、倒计时/起跑、循环引擎（车速控制音调）、氮气、漂移、拾取和碰撞/完赛音效。
选项页可分别调整、静音音乐和音效，音量随比赛设置保存。暂停/切后台停止播放，菜单音乐回到前台恢复；比赛仍需手动继续。
音乐、音效、元数据、作者及许可证加入资源清单和 ZIP。音频接口通过 BMS 统一注册，只有替换游戏 ZIP 不能为旧原生运行库添加播放能力。

## 当前范围与原版差异

已实现一条灯塔赛道、四种赛车与独立车轮、沿原版 driveline 行驶的 AI 对手、可配置圈数比赛、
计时排名、氮气拾取与消耗、简化漂移加速、礼盒与香蕉、离道减速与救援、暂停、结算和本地最佳成绩。
物理使用 120 Hz 固定步长，画面插值；HUD 保留节点并按需更新，不按帧重建。

这是首个可玩移植版本，尚未完成 SuperTuxKart 的完整复刻：

- 目前只接入灯塔赛道和四种车型，最多三名 AI；未实现完整赛道/车型目录、生涯、大奖赛、解锁和多用户档案。
- 碰撞和地面高度依据赛道 driveline，尚未接入原版 Bullet 三角网格物理、跳跃、翻车与完整碰撞响应。
- 模型导出静态直行姿势，只转换基础颜色与常见透明材质；场景动画、骨骼动画、第二层贴图、动态 LOD 切换、原版光照/水面/风吹草地、降雨闪电、局部灯光和后处理仍有差异。library/LOD 静态实例与天空盒已经导入。
- 普通赛道具只实现香蕉陷阱，计时赛实现按圈数发放的 zipper；尚无完整武器、联网、分屏、成就、可玩教程或录像系统。基础菜单/比赛音乐和音效已接入，仍缺少原版完整空间声场、所有车型独立引擎与角色语音。
- 脚本模拟、资源结构和 Rust 编译验证与桌面画面、移动真机、帧率验收分别记录，不以编译通过代替运行验收。

## 资源来源

官方资源：https://github.com/supertuxkart/stk-assets-mobile/releases/tag/git 。
SPM 格式依据本地 `stk-code/src/graphics/sp_mesh_loader.cpp`，转换将 Z 轴取反并翻转三角形绕序，
保留顶点色、法线、主 UV 和主贴图，SPMA 保留文件内已存储的直行姿势。
模型与贴图保持原作者和原许可证；具体条款见包内 `licenses/`，转换行为与源文件 SHA-256 见来源清单。
字体使用 STK 附带的文泉驿微米黑，其许可证同样随包提供。
