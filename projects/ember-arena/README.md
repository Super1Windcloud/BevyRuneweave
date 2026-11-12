# Ember Arena — Shattered Pixel Dungeon port

An in-progress TypeScript/Bevy port of
[Shattered Pixel Dungeon](https://github.com/00-Evan/shattered-pixel-dungeon).
The current milestone is a playable five-depth sewer expedition. It is **not yet a complete
one-to-one port**. [PARITY.md](PARITY.md) records the implemented subset, upstream references,
known differences and the next content to migrate.

The UI is being aligned independently against the pinned upstream revision. See
[UI_PARITY.md](UI_PARITY.md) for original source anchors, current screen coverage and the
remaining visual/content differences. Original chrome, icons, font, title/hero scenes,
five-column inventory and item-action windows replace the previous generic panels.
This is not yet a claim that every original screen is pixel-identical.

## Run and verify

From the repository root:

```bash
just run-ember-arena
just run-ember-arena --release
just test-ember-arena
npm --prefix projects/ember-arena run watch
```

The Rust launcher builds the TypeScript bundle before starting. Cargo builds reuse the
repository `target/`; root tooling supplies the TypeScript dependencies.

The desktop window starts at **800×600 logical pixels**, centered on the primary monitor.
`assets/engineConfig.json` declares that size before native window creation; script load/reload
does not resize an already visible window. Manual resizing and the Display tab's landscape/
portrait controls remain available. Android and iOS keep their native fullscreen geometry.
This startup behavior requires a runtime rebuilt with support for `engineConfig.window`.

## Current gameplay

- Native top-down 2D sprites use the original hero, monster, item and sewer tile atlases.
  Frame sizes follow upstream `HeroSprite`, mob sprites and `DungeonTileSheet`; the previous
  2.5D standee models remain available as assets but are not used in this mode.
- The world retains fixed 16-unit tiles. A real orthographic camera follows the hero and uses
  integer UI zoom; resizing does not move or rescale actors in the authoritative Bevy world.
- A seeded 25×25 floor contains nine rooms, connecting corridors, doors, water and stairs.
  This generator guarantees connectivity; it does not reproduce upstream's room generator.
- Movement and combat are turn based. Standing idle does not move monsters, consume food,
  or advance dungeon depth. Walls and occupied cells stop movement. Bumping a monster attacks it;
  opening a closed door takes a turn before entering its tile.
- Walls and closed doors block sight. Explored terrain remains dimly visible; monsters and
  dropped items outside the current field of view remain hidden. Mapping reveals terrain only.
- Rats have 8 HP, gnolls 12, crabs 15 and normal Goo 100. Gnolls fight in melee; crabs move
  twice as fast. Goo heals in water, becomes more dangerous below half health, charges a
  short-range attack, and can inflict ooze that washes off in water.
- Heroes start with 20 HP and 10 strength. Kills grant experience; leveling adds 5 maximum HP.
  The four selectable classes currently differ in basic weapon damage and initial supplies;
  their complete equipment, ranged attacks, talents and artifacts remain pending.
- Hunger begins at 300 turns and starvation at 450. A ration satisfies 300 hunger and takes
  three turns. Waiting does not instantly heal; basic regeneration is gradual and stops
  during starvation. Several potion/scroll effects remain simplified; see the parity table.
- Depth changes require standing on downward stairs and explicitly descending. Health and
  supplies carry forward. Defeating Goo completes the **sewer milestone** and records the
  Skeleton Key; it does not award the Amulet of Yendor or claim the full game is complete.

| Input | Action |
| --- | --- |
| WASD / arrows | One tile step; bump a monster to attack |
| Click / tap an explored tile | Walk a known route; stop if hurt or a new monster appears |
| Space / WAIT | Wait one turn |
| E / period / DESCEND | Use downward stairs |
| I / B / BAG | Open or close the inventory |
| 1–7 | Healing, flame, invisibility, strength, upgrade, mapping, food |
| Escape | Pause/resume or close the current menu |

The title opens a separate six-icon hero selection screen; the four implemented classes are
playable, while Duelist/Cleric show their upstream unlock-message presentation. Selecting a
backpack slot opens an item-detail window before Drink/Read/Eat is confirmed.
Inventory browsing and pausing cost no turns. Successfully using an item returns to play and
allows monster responses. Empty item slots and blocked moves cost no turns. Keyboard holds
repeat at a bounded rate; clicks never path through unexplored terrain.

## Languages

Open **Settings → Language** and choose **English** or **简体中文**. The default is English.
The choice applies immediately and is saved with the profile. Switching during an expedition
preserves actors, inventory and turns, and also retranslates existing combat logs and notices.
Menus, hero/item details, HUD states, results, settings, informational pages and diagnostic captions
support both languages. Runtime phase IDs, HTTP methods, status tokens and raw error codes remain
stable. Chinese title/result captions replace the English bitmap lettering; English retains the
original artwork.

Version-1 profiles without a language field continue in English. Unknown language values fall back
to English while retaining statistics. Incompatible saves remain protected; language switching
still works for the session. **Clear data** resets settings, including the language, to defaults.

English uses the original pixel font. Chinese and the Chinese language-choice label use bundled
Noto Sans SC 2.004 (SIL OFL 1.1), including measured Chinese/Latin advances and character wrapping.
The original 8.3 MB font is bundled without modification, so rendering needs no system CJK font
or network access. Its pinned source, SHA-256 and license are in `assets/licenses/font-sources.json`
and `assets/licenses/NotoSansSC-OFL.txt`.

```bash
npm --prefix projects/ember-arena run prepare:fonts
```

This command reuses `dist/asset-downloads/ember-arena/`, validates the pinned font/license hashes,
and regenerates the font metrics. Full asset preparation also runs this step. Adding translations
requires regenerating metrics; tests verify that every catalog glyph exists in the bundled font.

## Architecture

Gameplay, floor generation, input and UI flow live in TypeScript. Reflected `ScriptActor`
components and real Bevy `Transform` components remain authoritative for actor health,
positions, awareness and combat state. References are reacquired within script callbacks.
TypeScript retains only terrain, exploration, inventory, progression and presentation metadata;
there is no second actor/ECS store and no new language-specific business global.

The retained native UI uses the existing BMS registry. The runtime explicitly selects the active
2D/3D camera as its default UI camera, because Bevy's automatic selection can choose an inactive
higher-order camera and hide menus. This uses portable Bevy components without a C ABI change.

Settings and completed-run records use structured BMS storage results. Existing incompatible
saves are preserved until a confirmed reset. In-progress runs/floor backtracking are not saved.
The optional diagnostic sends fixed GET/POST echo requests to httpbin.org, without player data.
Audio and native physics remain API gaps; full Lua gameplay is not implemented.

## Assets and attribution

Original Pixel Dungeon / Shattered Pixel Dungeon art is credited to Oleg Dolya (Watabou) and
Evan Debenham (00-Evan). Existing notices live under `game/assets/licenses/`.
Legacy KayKit assets retain their own attribution. Do not remove those notices.

```bash
npm --prefix projects/ember-arena run prepare:assets
```

The preparation script reuses `dist/asset-downloads/ember-arena/` and emits PNG crops and GLBs.
Generated crops include source URLs and SHA-256 checksums in `licenses/sources.json`. Original
downloads are cached from upstream `master`, not an immutable release; checksums describe the
local generated artifacts. The game runs offline after preparation.

## Verification boundaries

### Window startup verification on 2026-11-12 (macOS Debug)

- Script tests: **49 passed**. Runtime library tests: **40 passed, 1 performance test ignored**.
  Coverage includes initial project dimensions, legacy defaults, invalid settings, no resize during
  script load/reload, manual orientation actions and the actual QuickJS game bundle.
- With the current **800×600** configuration, native window geometry was sampled **178 times**
  from its first visible appearance over five seconds. Every sample retained the same 800×632
  outer frame at (320, 134) on the 1440×932 primary display. The runtime requests primary-monitor
  centering before creation; the OS accounts for window decorations and available screen space.
  Evidence is under `target/ember-arena-window-native/window-samples-800x600.json`.
- The macOS unified Debug runtime package was rebuilt under
  `dist/runtimes/macos/aarch64-apple-darwin/`; the iOS runtime library passed a cross-target Cargo
  check. Windows, Linux and Android builds/runs, iOS native execution and Release were **NOT_RUN**.

### Localization verification on 2026-11-12 (macOS Debug)

- `npm --prefix projects/ember-arena test`: **48 passed**, including catalog/parameter coverage,
  legacy profiles, persistent language selection, live log translation, unchanged gameplay state,
  Chinese font glyph coverage/provenance, portrait wrapping and the reflected `String` global.
- `cargo test --locked --offline -p bevy-runeweave --lib quickjs_arena_runs_with_real_actor_components_and_ui`:
  **1 passed**, executing the actual bundle through QuickJS and real Bevy components.
- `cargo run --locked --offline -p ember-arena-ts`: built and ran using the repository cache.
  The native fixture uses `RUNEWEAVE_DATA_DIR` under `target/ember-arena-i18n-native`, preserving
  regular player saves. Window-directed keyboard events verified hero selection, starting the
  expedition and opening the backpack. Chinese title, hero, HUD, inventory, item-detail preview
  and language-settings preview screenshots are under that directory's `screenshots/` folder.
- `npm --prefix projects/ember-arena run prepare:fonts`, root tooling typecheck and
  `git diff --check`: passed. Font preparation validates pinned bytes before generating metrics.
- Native text renders Chinese successfully. The current Bevy/ICU stack still logs
  `No segmentation model for language: ja`; this change uses measured script-side wrapping
  and does not replace the runtime's segmentation provider.
- Windows, Linux, Android, iOS and Release rendering were **NOT_RUN** for this localization change.

### Existing gameplay and UI evidence

`npm --prefix projects/ember-arena test` typechecks, rebuilds the bundle, and runs deterministic
tests with platform doubles. Tests cover floor connectivity across 200 seed/depth combinations,
doors and visibility, idle/turn behavior, five-depth transitions, combat, mapping, hunger,
portrait input, resizing, asset provenance, settings, reset and error recovery.

`cargo test --locked --offline -p bevy-runeweave --lib` includes execution of the actual game
bundle through QuickJS and real Bevy components, Lua/QuickJS actor and storage parity,
camera selection, and portable path validation. Simulation results do not prove GPU rendering,
mobile input/lifecycle, performance or full upstream behavior.

Windows Debug native screenshots/logs for this milestone are stored under
`dist/asset-downloads/ember-arena/native-turn-based-*`. macOS, Linux, Android, iOS and Release
execution remain unverified for this change. The historical macOS arena verification from
2026-10-30 predates the turn-based port and does not validate this milestone.

### Verified on 2026-11-11 (Windows Debug)

- `npm --prefix projects/ember-arena test`: **27 passed**, including UI remount/held-pointer
  regressions. Asset preparation succeeded using the existing local download cache.
- `cargo test --locked --offline -p bevy-runeweave --lib`: **37 passed, 1 performance test ignored**.
  The actual QuickJS game test also opens the compact backpack and verifies page 2 in real Bevy UI.
- `cargo build --locked --offline -p ember-arena-ts`: succeeded using the repository `target/`.
- `npm run typecheck:scripts`, `cargo fmt --check` and `git diff --check`: passed.
- The native executable rendered through Vulkan on an NVIDIA RTX 3060 Laptop GPU. Window-directed
  keyboard input verified starting, stepping, opening a door and opening the backpack. A real
  OS mouse click verified compact backpack pagination after resizing to an 800×400 client area.
  Screenshots include `native-turn-based-door.png` and `native-turn-based-compact-backpack-page2.png`.
- For the background native launch, the resolved Node installation directory was prepended to
  the child process's `PATH` to bypass a mise `npm.cmd` shim resolution failure. No persistent
  machine configuration was changed. GPU startup logged a missing Epic overlay-layer manifest;
  rendering still initialized and the screenshots above were captured successfully.

### UI alignment verification on 2026-11-12 (Windows Debug)

- `npm --prefix projects/ember-arena test`: **36 passed**. The inventory regression now verifies
  a five-column grid and item confirmation, replacing the earlier compact-page layout.
- `cargo test --locked --offline -p bevy-runeweave --lib`: **38 passed, 1 performance test ignored**.
  Lua/QuickJS parity covers font selection/preservation, image mode/tint and real camera control.
- `cargo build --locked --offline -p ember-arena-ts`, root tooling checks, the shared TypeScript
  SDK check, Rust formatting and whitespace checks passed.
- Original UI atlases/font are pinned to revision `57a4e06a4caf162446d1c28caa7983f0493fecf0`.
  Source coordinates, generated crop dimensions/checksums and core screen geometry are tested.
- Native title, six-class selection, HUD and backpack renders were inspected. Read-only F12
  fixtures cover the existing item, pause, settings, result and hero-info presentations.
  Evidence is under `dist/asset-downloads/ember-arena/ui-parity/`; fixture captures are rendering
  evidence, not proof of item actions or a completed run. Foreground OS mouse control was
  unavailable in this run; window-directed keyboard events drove the native captures.
- A matching upstream executable pixel-diff run was not completed. Full original settings,
  secondary scenes/data, animation and other differences remain explicitly tracked in
  [UI_PARITY.md](UI_PARITY.md). The original source-to-source layout work must not be reported
  as full one-to-one UI acceptance. Other platform execution remains unverified.
