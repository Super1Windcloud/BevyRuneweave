# STK Car

基于 RuneWeave / QuickJS 的独立 TypeScript 3D 赛车项目，复用 SuperTuxKart 的灯塔赛道和 Tux 资源。
游戏规则、输入、相机跟随、界面和资源转换工具使用 TypeScript；原生层只补充共享 BMS 透视相机接口。

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
新包使用 `scene_set_camera_3d`，Android/iOS 宿主必须先重建并安装包含该接口的统一原生运行库。
只更新游戏 ZIP 不会更新已安装的 `.so` / XCFramework。

## 操作

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 驾驶 | WASD / 方向键，S 倒车 | 左侧摇杆，按住自动给油、向下拉倒车；也可按油门 |
| 氮气 | Shift | 氮气按钮 |
| 漂移 | 空格，持续转向后松开触发短时加速 | 漂移按钮配合摇杆 |
| 放置香蕉 | E，需要先拾取礼盒 | 道具按钮 |
| 回到赛道 | R | 救援按钮 |
| 暂停 / 继续 | P / Esc | 暂停按钮 |
| 开始 / 再来一局 | Enter | 开始 / 再来一局按钮 |

界面默认跟随系统语言：中文系统显示简体中文，其余显示英文。移动端限定横屏并避开安全区。
切后台会暂停，返回后手动继续。最佳整场成绩按游戏名隔离保存。

## 当前范围与原版差异

已实现一条灯塔赛道、Tux 车辆与独立车轮、三名沿原版 driveline 行驶的 AI 对手、三圈比赛、
计时排名、氮气拾取与消耗、简化漂移加速、礼盒与香蕉、离道减速与救援、暂停、结算和本地最佳成绩。
物理使用 120 Hz 固定步长，画面插值；HUD 保留节点并按需更新，不按帧重建。

这是首个可玩移植版本，尚未完成 SuperTuxKart 的完整复刻：

- 目前四辆车均使用 Tux 模型；尚无选车、选赛道、难度和生涯界面。
- 碰撞和地面高度依据赛道 driveline，尚未接入原版 Bullet 三角网格物理、跳跃、翻车与完整碰撞响应。
- 模型导出静态直行姿势，只转换基础颜色与常见透明材质；未转换骨骼动画、第二层贴图、原版光照/水面/草地/天空特效及所有 LOD/library 场景物件。
- 道具仅实现香蕉陷阱；尚无完整武器、声音音乐、联网、分屏、成就、教程或录像系统。
- 脚本模拟、资源结构和 Rust 编译验证与桌面画面、移动真机、帧率验收分别记录，不以编译通过代替运行验收。

## 资源来源

官方资源：https://github.com/supertuxkart/stk-assets-mobile/releases/tag/git 。
SPM 格式依据本地 `stk-code/src/graphics/sp_mesh_loader.cpp`，转换将 Z 轴取反并翻转三角形绕序，
保留顶点色、法线、主 UV 和主贴图，SPMA 保留文件内已存储的直行姿势。
模型与贴图保持原作者和原许可证；具体条款见包内 `licenses/`，转换行为与源文件 SHA-256 见来源清单。
字体使用 STK 附带的文泉驿微米黑，其许可证同样随包提供。
