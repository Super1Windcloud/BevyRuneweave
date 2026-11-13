# UI parity ledger

Reference: [Shattered Pixel Dungeon](https://github.com/00-Evan/shattered-pixel-dungeon/tree/57a4e06a4caf162446d1c28caa7983f0493fecf0),
revision `57a4e06a4caf162446d1c28caa7983f0493fecf0`, reviewed 2026-11-12.
This ledger separates source-based implementation from pixel-parity acceptance.
**All original screens are not yet reproduced or accepted as pixel-identical.**

## Implemented presentation

| Surface | Source used | Current implementation / limit |
| --- | --- | --- |
| Title | `scenes/TitleScene.java`, `ui/TitleBackground.java`, `effects/BannerSprites.java` | Original landscape/portrait banner in English, localized text title in Chinese, eight entry buttons, chrome, icons and integer UI zoom. Background uses original layers but a static arrangement; original scrolling, flames and glow remain absent. |
| Hero selection | `scenes/HeroSelectScene.java`, `sprites/HeroSprite.java`, `messages/actors/actors.properties` | Separate full-screen scene, six original hero icons, landscape grid / portrait strip, original splash, left fade and locked-class message windows. Duelist/Cleric remain locked because their gameplay kits are absent. The four playable classes retain truthful port descriptions, rather than claiming unimplemented powers. |
| Status pane | `ui/StatusPane.java` | Original 82×38 and large 160×39 layouts, 128×9 / 50×4 health bars, source hero portrait, XP bar and level. Healing budget, Burning, Ooze, seal shielding/cooldown and the remaining/depleted LockedFloor regeneration window have localized text indicators. Compass, original buff icons/shield bar, DOT overlays and blink animations remain absent. |
| Menu pane | `ui/MenuPane.java` | Source pane, menu/journal artwork, version and depth positions. Journal data/layout is still a subset. |
| Toolbar | `ui/Toolbar.java` | Original 20/18/19-pixel joined slot frames, 4/5/6 visible-slot thresholds and desktop/mobile grouping. The carried spirit bow occupies the first quick slot and opens cancellable targeting. Search enters tile examination, a second click performs a two-turn search, and F exposes the same flow. Descent uses the HUD stairs, E/period or the hero's exit tile. Full quickslot assignment/auto-aim, swap and native long-press remain absent. |
| Backpack | `windows/WndBag.java`, `ui/InventorySlot.java` | Five columns and 25 slots, adaptive layout, quantities and bag tab. Weapon/armor slots reference actual item instances; removed gear remains in the backpack. The equipped cloak occupies the artifact slot and moves into the carried slots when removed, displaying current level/charge. Seven gear definitions, upgrade labels and key/blob descriptions are present. Rings, other artifacts, curses and full bag taxonomy remain pending. |
| Item window | `windows/WndInfoItem.java`, `windows/WndUseItem.java` | Original chrome, icon/title and measured wrapping. Consumables expose their actions; gear exposes actual damage/armor/strength/time values and equip/remove. Spirit bow exposes Shoot and current stats. Staff gear exposes Zap and charges. Cloak details expose level/energy/XP with equip/remove and stealth/stop controls. Sealed armor shows a seal marker, capacity, carried level and free detach; a loose seal opens an armor chooser. Warrior armor replacement asks whether to transfer it before advancing actors. Upgrade scrolls use a paginated chooser, accept an unupgraded loose seal and exclude the bow/cloak. Liquid flame exposes Throw with cancellable targeting. Generic throw/drop/quickslot and wand-imbuing dialogs remain absent. |
| Pause | `windows/WndGame.java` | Original 120-pixel content width, 20-pixel buttons, two-pixel gaps, Settings and Main Menu actions. Challenges are not present in the port. |
| Settings | `windows/WndSettings.java` | Original content widths, six icon tabs, chrome and persisted English/Simplified Chinese selection. Hints affect the HUD; reduced effects disables burst camera shake. Sensitivity is explicitly disabled for absolute tile selection while preserving old settings. Full display, UI, keybinding, audio and broader locale support remain pending; audio controls are noninteractive. |
| Hero info | `windows/WndHero.java` | Stats use actual hero/equipment values, including an accuracy/evasion/attack-time summary. Talent trees and complete original stat tabs remain absent. |
| Results | `effects/BannerSprites.java`, `windows/WndGame.java` | Original banners/chrome and Chinese text banners. Goo death leaves the run playable; the milestone result requires picking up the key, unlocking the exit and explicitly leaving. Results state that prison is unavailable. This is not the upstream Amulet ending. |
| Secondary title pages | `scenes/{Rankings,Journal,About}Scene.java`, title button sources | Original entry names/icons and common window art. Rankings currently shows local aggregates; journal/news/changes/about/support are reduced informational pages. Their full original scenes, services and data are not ported. |
| Other original windows | Upstream `windows/` and game scenes | Shops, full alchemy, quest/NPC dialogs, badges, challenges, keybindings, subclasses/talents, resurrection, full save-slot management and region/interlevel scenes remain to be migrated. |

## Pixel assets and text

`spd-ui-atlas.ts` records source rectangles and nine-patch borders; `prepare-ui-assets.ts`
downloads immutable-revision assets into the existing local cache. Crops and font source hashes
are stored in `assets/licenses/ui-sources.json`. No AI-redrawn UI art is used.

English uses the original `pixel_font.ttf` with smoothing disabled. Chinese text uses bundled
Noto Sans SC 2.004 with its OFL notice and pinned SHA-256 under `assets/licenses/`. Advance widths
for both fonts come from their OpenType `cmap`/`hmtx` tables. Chinese wraps at character boundaries
and overlong Latin tokens are split to fit; font selection also covers the Chinese option while
the interface is in English. This is not proof
that LibGDX and Bevy produce identical glyph baselines or every rendered pixel.

Nine-patch edges explicitly request `imageMode: "stretch"`; automatic aspect fitting would leave
gaps. UI and scene images use nearest sampling. Source icons preserve their own pixel dimensions.

## Runtime and platform contract

- `ui_set_font(id, relativePath)` is defined once in the BMS function registry, validates project
  paths/extensions and ownership, and preserves the selected font on later text updates.
- `ui_set_style` accepts `imageMode: "auto" | "stretch"`; invalid values reject the style before
  mutating layout. The default remains auto, preserving existing callers' behavior.
- `imageTint` applies an RGBA tint to the image itself, preserving transparent pixels. Hero
  selection uses the original 1.0 / 0.6 / 0.1 icon brightness levels, not opaque cover rectangles.
- `scene_set_camera_2d(x, y, viewportHeight)` moves the actual orthographic Bevy camera. Inputs
  must be finite and height positive; unavailable/nonorthographic cameras return false.
- Game tiles remain 16 world units. Resizing and zooming do not rewrite actor positions. Pointer
  coordinates are converted through the same camera scale used to display the level.
- These services use portable Bevy components and project-relative assets. Lua and QuickJS share
  the same registry implementation. The public C ABI and host ownership contracts are unchanged.
- Windows Debug is built and exercised. macOS, Linux, Android, iOS, Release mode, real mobile safe
  areas/touch and platform font rasterization remain unverified for this UI change.

## Visual inspection and acceptance

Mobile adaptation batch, 2026-11-12: fresh unified runtimes and the current bundle were exercised
on Pixel 8 / Android 17 and iPhone 14 Pro / iOS 27.0.1. Native GPU captures cover title, hero
selection, dungeon HUD in portrait/landscape and the pause modal after Home/resume. Real touch
movement and Android Back-to-launcher were exercised. iOS uses full-screen XCTest captures after
stable foreground geometry; app-relative captures can crop against stale AX coordinates after
rotation. Artifacts are under `dist/mobile-adaptation/`. This is narrow mobile acceptance, not
coverage of every item window or matched upstream pixels. Earlier batch-specific NOT_RUN entries
below retain their original scope. The final repeated iOS run passed both native UI tests before
the user's stop request was processed; no further tests were started.

The seal batch passes 162 script tests, Biome and independent TypeScript checks.
Chinese seal armor/affix windows fit portrait and short-landscape doubles; held controls remain
free and cannot repeat actions. Both transfer choices are exercised by gameplay doubles.
The headless macOS QuickJS/Bevy test verifies actual shield absorption, clock fields and free
detach/reaffix through BMS. The original 13×13 seal crop has pinned provenance. New surfaces
have NOT_RUN native screenshot, OS-input, mobile touch/lifecycle or matched upstream visual
acceptance on all five platforms. The seal marker and shield/cooldown text do not reproduce
the original armor overlay, shield bar/icon, flash or sound.

The cloak batch passes 146 script tests, Biome and independent TypeScript checks.
Chinese cloak text and held activation/stop controls fit portrait and short landscape doubles.
The headless macOS QuickJS/Bevy test activates/stops the cloak against actual reflected entities.
The original 9×15 item crop is present, but new cloak surfaces have NOT_RUN native screenshot,
OS-input, real mobile touch or reference-client pixel acceptance on all five platforms.
Original character invisibility rendering, cloak particles and audio remain pending.

The magic-staff batch passes 130 script tests, Biome and independent TypeScript checks.
Portrait/short-landscape doubles verify Chinese staff stats, charge counts, Zap and held-click
cancellation. The headless macOS QuickJS/Bevy test performs a pointer zap and validates actual
damage/charge state. New staff controls and labels have NOT_RUN native screenshot, OS-input,
real touch or reference-client pixel acceptance on all five platforms. Missile flight,
staff particles, sound, imbuing and other wand dialogs remain pending.

The spirit-bow batch passes 115 script tests, Biome and independent TypeScript checks.
Chinese bow details, Shoot/cancel latching, stats and prompts fit portrait and short landscape
in doubles. The headless macOS QuickJS/Bevy test fires four injected pointer shots against
a real actor and retains the bow/gloves. New bow surfaces have NOT_RUN native screenshot,
real touch and reference-client pixel acceptance on all five platforms. The original bow
crop is present; flying spirit arrows, splash effects and shooting animation/audio are pending.

The survival/LockedFloor batch passes 103 script tests, Biome and independent TypeScript checks.
Portrait and short-landscape doubles cover Chinese window counts and the depleted label.
The headless macOS QuickJS/Bevy test checks actual survival components and scheduled eating.
The new labels and threshold messages have NOT_RUN native screenshot/input acceptance on
all five platforms; the original LockedFloor buff icon/description window remains pending.

The timed-effects batch passes 90 script tests, Biome and independent TypeScript checks.
Chinese numeric effects and targeting/cancel controls are covered in portrait and short
landscape doubles. The headless macOS QuickJS/Bevy integration test passes with a reflected
healing entity. This is not screenshot/touch acceptance: new effect labels, target prompts
and fire markers have NOT_RUN native visual/input acceptance on all five platforms.
Fire is represented by a static four-unit orange marker derived from `FlameParticle.java`;
the original particle emitter, character burning animation and buff icon strip remain absent.

The equipment/action-time batch passes 74 script tests, Biome and TypeScript checks. Equipment
detail windows, upgrade pages and actual slot contents have NOT_RUN native screenshot/touch
acceptance on all five platforms. Existing captures do not validate these new surfaces.

The search/Goo-exit interaction batch passes 60 script tests, including hidden-occupant
protection, held-click latching, key/blob collection, exit gates and setting effects. Its
new prompts, HUD hints, descriptions and result layout have NOT_RUN native visual/touch
acceptance on Windows, macOS, Linux, Android and iOS. Captures below predate this batch.

Windows GPU captures live under `dist/asset-downloads/ember-arena/ui-parity/`. Actual title,
hero-selection, HUD and backpack captures are distinct from the read-only fixture captures.
Fixture images verify rendering/layout only, not achievement, item-action or ending completion.

Developer-only inspection: open F12 checks, then press a digit:

| Key | Read-only fixture |
| --- | --- |
| 1 | Title |
| 2 | Hero selection |
| 3 | Gameplay HUD |
| 4 | Backpack |
| 5 | Item details |
| 6 | Pause |
| 7 | Settings; Right arrow cycles the six tabs |
| 8 | Sewer victory presentation |
| 9 | Defeat presentation |
| 0 | Hero info |

F12 returns to the previous game state. Previewing a result never records a victory/loss or
changes actor health. These controls are absent from the original-looking player menus.

No matching upstream executable screenshot suite or automated image-difference acceptance has
been run. Source rectangle/geometry tests, native screenshots and passing interaction tests
must not be described as acceptance of complete one-to-one visual parity.

A v4.0.2 reference JAR was downloaded from the upstream release for comparison. Its isolated
startup was rejected by automatic approval policy (`blocked by policy`, no detailed reason
returned). It was not executed and no reference-client screenshots were accepted as evidence.
