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
npm --prefix projects/ember-arena run check
npm --prefix projects/ember-arena run typecheck
npm --prefix projects/ember-arena run watch
```

The Rust launcher builds the TypeScript bundle before starting. Cargo builds reuse the
repository `target/`; root tooling supplies the TypeScript dependencies.
`check` uses root-installed Biome 2.6.7 for fast parsing and correctness/suspicious lint rules.
Generated JavaScript, assets, caches and lockfiles are outside that scan. Formatting and import
rewrites are disabled to preserve the existing style. Full compiler checks remain available
through `typecheck`; `test` runs Biome, rebuilds the bundle and runs all TypeScript test files.

The desktop window starts at **800×600 logical pixels**, centered on the primary monitor.
`assets/engineConfig.json` declares that size before native window creation; script load/reload
does not resize an already visible window. Manual resizing and the Display tab's landscape/
portrait controls remain available. Android and iOS keep their native fullscreen geometry.
This startup behavior requires a runtime rebuilt with support for `engineConfig.window`.
The application icon is the original Shattered Pixel Dungeon desktop icon, bundled at
`assets/branding/shattered-pixel-dungeon.png`. Its pinned revision and checksum are recorded in
`assets/licenses/icon-source.json`; both Cargo launches and the desktop launcher use it offline.

## Current gameplay

- Native top-down 2D sprites use the original hero, monster, item and sewer tile atlases.
  Frame sizes follow upstream `HeroSprite`, mob sprites and `DungeonTileSheet`; the previous
  2.5D standee models remain available as assets but are not used in this mode.
- The world retains fixed 16-unit tiles. A real orthographic camera follows the hero and uses
  integer UI zoom; resizing does not move or rescale actors in the authoritative Bevy world.
- A seeded 25×25 floor contains nine rooms, connecting corridors, doors, water and stairs.
  An optional concealed shortcut adds a searchable secret door without blocking the main route.
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
  The four starting melee weapons and cloth armor are real equipment with the original base
  ranges: worn shortsword 1–10, staff 1–6, dagger 1–8, gloves 1–5. Gloves attack in 0.5 ticks;
  dagger surprise rolls use the upper quarter of their damage range. Cloak, seal, talents
  and original starting-supply parity remain pending.
- The Mage's staff contains an identified magic-missile wand with four starting charges.
  Choose Zap from its gear window, click its first quick slot or press Z. A confirmed cast
  spends one charge and one tick; magic damage is 2–8 at +0 and bypasses ordinary armor and
  attack accuracy. Unlike a thrown potion or arrow, the bolt continues beyond an empty aim
  cell until it hits a character or obstacle. Self-targeting and cancellation are free;
  an empty successful cast still consumes a charge and breaks invisibility. The staff stays
  usable in melee and may be zapped while unequipped but carried.
- Staff charges/partial charge/deadlines live in an actual reflected charger entity. Its
  missing-charge recharge curve uses `10 + 40 * 0.75^missing` and f32 accumulation; wall-clock
  idle time and menus do not charge it. Starvation alone does not disable charging, while an
  exhausted LockedFloor window does. Staff upgrades improve magic damage/capacity and restore
  one charge; the maximum is ten. Other wands/imbuing, advanced modifiers, flight and audio
  remain pending.
- The Huntress carries a spirit bow in her backpack and first quick slot. Open its item window
  and choose Shoot, click the quick slot, or press 8 to aim at a visible tile. Cancelling is free;
  arrows stop at the first character or obstacle and the bow is never consumed. At hero level
  one its base damage is 1–6 with strength requirement 10; at level five it is 2–8 and requires
  strength 9. Growth follows hero level, so upgrade scrolls cannot select the bow. Adjacent
  targets halve accuracy while distant targets receive a 1.5 multiplier. Base shooting takes
  one tick without replacing the gloves' half-tick melee. A target attack breaks invisibility;
  empty/self shots spend one tick without harming the hero or dispelling invisibility.
  Arrow flight/sound and advanced bow modifiers remain pending.
- Heroes, mobs and the supported effects use independent fractional timestamps in real reflected
  components, with f32 precision matching both Bevy and the original Java Actor. Hero wins
  timestamp ties; healing/regeneration precede fire, then mobs, then ordinary buffs. Hunger,
  regeneration and LockedFloor each have their own deadlines and reflected accumulators.
  Crab movement costs 0.5 ticks and attacks cost 1. The complete original Actor framework
  and exact same-priority tie ordering are not yet migrated.
- Backpack equipment slots open actual item details. Equip/unequip costs one tick; replacing
  an occupied slot also spends the old item's unequip tick. Weapon damage/accuracy/attack time
  and armor reduction/evasion/movement depend on the equipped items and strength requirements.
  Leather armor and shortsword pickups are added to the custom floor-2–4 loot fixtures; their
  generation distribution is not upstream-equivalent.
- Upgrade scrolls select a carried weapon or armor, including unequipped items. Opening or
  cancelling the chooser costs nothing. Confirming consumes one scroll and one tick, improving
  that particular item's stats. Required strength drops at +1/+3/+6/+10 as in the original.
- Hunger begins at 300 and starvation at 450. Crossing into starvation deals one damage;
  later ticks accumulate maximum HP/1000, dealing damage only when the remainder exceeds one.
  A ration satisfies 300 hunger and takes three turns without resetting that remainder.
  Natural regeneration accumulates 0.1 HP per eligible wounded tick and pauses its accumulator
  at full health or while starving. Several advanced item/status modifiers remain pending.
- Healing potions grant a diminishing budget: at 20 maximum HP the first ticks heal 8, 6,
  then 4. Reapplying keeps the larger budget, including its existing tick phase; it does not
  cure ooze or burning. Invisibility has an independent twenty-tick expiry. Goo ooze lasts
  twenty ticks and washes off in water; a fresh application can hurt once before washing off.
- Liquid flame opens a free, cancellable tile selector. Confirming a visible target spends
  one potion and one tick; the projectile stops at the first character or obstacle and seeds
  a 3×3 fire field. Fire decays, spreads to adjacent doors and ignites occupants with an
  eight-tick Burning effect. Water extinguishes an active burn. Fire is shown with a static
  source-color marker; original particles, inventory/heap burning and other terrain effects
  remain pending.
- Depth changes require standing on downward stairs and explicitly descending. Health and
  supplies carry forward. Defeating Goo drops a real Worn Key and 2–4 blobs of goo, without
  ending the run. Collect the key, use the stairs to unlock the exit (one turn), then use
  them again to complete the **sewer milestone**. The result explicitly states that prison
  content is unavailable; this does not award the Amulet or complete the original game.
- Search first enters a turn-free examine mode. Tap known terrain to inspect it without
  revealing hidden occupants; tap Search again to search nearby visible tiles. Searching
  spends two turns and six hunger units outside a sealed boss fight. Starting Rogue search
  range is two tiles; the other classes search one tile. Traps, passive detection and search
  talents remain pending. Goo seals the encounter after noticing or being attacked, pausing
  hunger until its defeat. Natural regeneration remains enabled for an initial fifty-tick
  window; damage to Goo restores 1.5 times the damage as ticks, capped at fifty. Once depleted,
  regeneration pauses until more damage restores time. The HUD shows the remaining window or
  "Regen off". Healing potions still work, and Goo's death immediately removes the lock.

| Input | Action |
| --- | --- |
| WASD / arrows | One tile step; bump a monster to attack |
| Click / tap an explored tile | Walk a known route; stop if hurt or a new monster appears |
| Space / WAIT | Wait one turn |
| E / period / DESCEND | Use downward stairs |
| F / Search icon | Examine a tile; press again to search nearby |
| I / B / BAG | Open or close the inventory |
| 1–7 | Healing, flame, invisibility, strength, upgrade, mapping, food |
| 8 | Aim the carried spirit bow |
| Z | Aim a carried magic-missile staff |
| Escape | Pause/resume or close the current menu |

The title opens a separate six-icon hero selection screen; the four implemented classes are
playable, while Duelist/Cleric show their upstream unlock-message presentation. Selecting a
backpack slot opens an item-detail window before Drink/Throw/Shoot/Zap/Read/Eat is confirmed.
Inventory browsing and pausing cost no turns. Successfully using an item returns to play and
allows monster responses. Empty item slots and blocked moves cost no turns. Keyboard holds
repeat at a bounded rate; clicks never path through unexplored terrain.
The HUD stairs icon also descends. Hints now control the HUD guide, and Reduced effects
disables Goo's burst camera shake without moving actors. Pointer sensitivity remains stored
for compatibility but its control is disabled: absolute tile selection uses exact coordinates.
Blobs of goo can be collected and inspected; alchemy and selling are not implemented yet.

## Languages

Open **Settings → Language** and choose **English** or **简体中文**. By default the game follows
the system language at startup/reload: Chinese locales use Simplified Chinese, all others use English.
The choice applies immediately and is saved with the profile. Switching during an expedition
preserves actors, inventory and turns, and also retranslates existing combat logs and notices.
Menus, hero/item details, HUD states, results, settings, informational pages and diagnostic captions
support both languages. Runtime phase IDs, HTTP methods, status tokens and raw error codes remain
stable. Chinese title/result captions replace the English bitmap lettering; English retains the
original artwork.

Version-1 profiles without a language field also follow the system. Profiles with an existing
explicit language keep that choice; a manual selection disables automatic language changes.
Unknown explicit language values fall back to English while retaining statistics. Incompatible
saves remain protected; language switching still works for the session. **Clear data** resets
settings and restores system-language following. This requires a runtime with the BMS `app_locale`
function; older runtime packages safely fall back to English.

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
Supported buffs and fire cells are also real script-owned entities: reflected fields hold
remaining budget/duration, effect parameters and action deadlines, and entity IDs encode
buff targets. Fire spread uses transient query results for one evolution step, not a second
persistent actor store. Player buffs survive descent; old-floor environmental effects do not.
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
Both original images and generated crops include source URLs and SHA-256 checksums in
`licenses/sources.json`. Downloads and cache keys use immutable revision
`57a4e06a4caf162446d1c28caa7983f0493fecf0`, shared with UI/icon preparation. Existing source
hashes are checked before reusing that revision's cached bytes. The game runs offline after
preparation. The old misnamed `skeleton_key.png` crop is replaced by `worn_key.png`.

## Verification boundaries

### Magic-missile staff and charging on 2026-11-12

- Upstream master still resolves to `57a4e06a4caf162446d1c28caa7983f0493fecf0`. Base
  MagesStaff/Wand/WandOfMagicMissile and Ballistica.MAGIC_BOLT rules drive this batch.
- **130 tests pass**: twenty-five source-rule tests and 105 gameplay/UI/asset tests. New
  coverage checks initial charges, magic damage/capacity, f32 charging, full/depleted states,
  fractional phase, extended rays and map edges, free self/cancel/unseen targets, empty casts,
  armor-independent hits, invisibility, carried/unequipped use, upgrade restoration, starvation,
  lock depletion/reactivation, cross-floor component identity, death cleanup and Chinese UI.
- Biome, independent TypeScript checks, bundle/font generation, Rust formatting and whitespace
  checks pass. `npm run check` continues to use Biome. No runtime API or public ABI changed.
- `cargo test --locked --offline -p bevy-runeweave --no-default-features --features typescript
  --lib quickjs_arena_runs_with_real_actor_components_and_ui -- --nocapture`: **1 passed**
  on macOS Debug. The actual bundle selects the Mage and performs a zap through injected Bevy
  pointer input. It checks actual target damage, charge consumption, partial recharge and
  independent charger/hero deadlines, in addition to earlier native regression paths.
- Rust changes are confined to test assertions. Other wand effects, imbuing, curses, talents,
  subclasses and recharge modifiers are pending. New staff controls/charge labels have
  **NOT_RUN** native GPU, OS-input, touch/lifecycle and reference-client pixel acceptance
  on Windows, macOS, Linux, Android and iOS. The headless test covers the narrow path above.

### Spirit-bow targeting and combat on 2026-11-12

- Upstream master still resolves to `57a4e06a4caf162446d1c28caa7983f0493fecf0`. Base
  SpiritBow/SpiritArrow, MissileWeapon, Weapon and Hero/HeroClass rules drive this batch;
  advanced modifiers and original starting-inventory parity remain separate work.
- **115 tests pass**: twenty source-rule tests and 95 gameplay/UI/asset tests. New coverage
  checks hero-level damage/strength/accuracy/delay, actual Huntress ownership and item action,
  free cancel/unseen targets, switching between bow/flame, repeated first-character hits,
  unlimited arrows, independent glove melee, empty/self shots, invisibility, scroll exclusion,
  unequipped melee, real XP growth, descent/restart and Chinese portrait/short-landscape UI.
- Biome, independent TypeScript checks, bundle/asset/font generation, Rust formatting and
  whitespace checks pass. The original 16×16 bow crop and its hash are in the pinned manifest.
- `cargo test --locked --offline -p bevy-runeweave --no-default-features --features typescript
  --lib quickjs_arena_runs_with_real_actor_components_and_ui -- --nocapture`: **1 passed**
  on macOS Debug. The actual bundle selects the Huntress, aims from the quick slot, and fires
  four injected Bevy pointer clicks at a real target. Assertions check damage, one-tick shooting,
  stationary hero position and the retained bow/gloves. The input fixture now releases held
  movement/mouse state explicitly; clearing transition events alone leaves buttons held.
- Rust changes are test-only. Runtime interfaces and the public ABI are unchanged. This
  headless integration evidence does not establish native GPU rendering, OS input, audio,
  mobile touch/lifecycle or reference-client pixel parity: these are **NOT_RUN for this batch**
  on Windows, macOS, Linux, Android and iOS.

### Hunger, regeneration and LockedFloor on 2026-11-12

- Upstream master still resolves to `57a4e06a4caf162446d1c28caa7983f0493fecf0` (`git ls-remote`).
  This batch uses its base Hunger/Regeneration/LockedFloor rules, Food/search costs and Goo
  damage/unseal behavior. Challenge, talent, artifact and trinket modifiers remain pending.
- **103 tests pass**: sixteen source-rule tests and 87 gameplay/UI/asset tests. New coverage
  checks f32 starvation thresholds and overflow, food/search remainder and phase preservation,
  eligible-only regeneration, heal-before-DOT priority, fractional clocks, idle/menu freeze,
  cross-floor component identity, the fifty-tick lock, damage extension/cap and boss-death
  unsealing. Starvation death/restart and Chinese live/depleted window labels are covered.
- Biome, independent TypeScript checks, bundle/font generation, Rust formatting and whitespace
  checks pass. `npm run check` still invokes Biome; compiler type checks remain separate.
- `cargo test --locked --offline -p bevy-runeweave --no-default-features --features typescript
  --lib quickjs_arena_runs_with_real_actor_components_and_ui -- --nocapture`: **1 passed**
  on macOS Debug. The existing test now verifies actual hunger/regeneration components,
  hunger advancement and food's three scheduled ticks through real QuickJS/BMS calls.
  Rust changes are confined to test assertions; runtime APIs and public ABI are unchanged.
- The full new survival/Boss scheduler suite uses platform doubles. Native GPU rendering,
  real input/lifecycle, touch and reference-client pixel comparison are **NOT_RUN for this
  batch** on Windows, macOS, Linux, Android and iOS. Headless native evidence is limited to
  the interactions explicitly checked above.

### Timed effects and liquid-flame targeting on 2026-11-12

- **90 tests pass**: eleven source-rule tests plus 79 gameplay/UI/asset tests. Coverage includes
  diminishing healing, maximum-budget reapplication, fractional effect phase, heal-before-DOT
  priority, twenty-tick ooze, fresh/active water interactions, targeting cancellation, projectile
  interception, real effect/fire entities, spread, idle freeze, descent and death/restart cleanup.
  Chinese effect amounts and target controls are checked in portrait and short landscape.
- `npm run check` remains Biome (about 40–70 ms locally for 32 files). Independent
  `npm run typecheck` and bundle generation pass. Asset preparation regenerates the static
  fire marker/provenance and Chinese font metrics using the pinned source/cache.
- `cargo test --locked --offline -p bevy-runeweave --no-default-features --features typescript
  --lib quickjs_arena_runs_with_real_actor_components_and_ui -- --nocapture`: **1 passed**
  on macOS Debug. This runs the actual bundle in QuickJS against real Bevy/BMS components;
  the entity diagnostic now verifies creation, parameters and one tick of a healing buff.
- No Rust implementation, shared BMS interface or public ABI changed. GPU rendering,
  native input/lifecycle, real mobile touch and reference-client pixel comparison are
  **NOT_RUN for this batch** on Windows, macOS, Linux, Android and iOS. The headless test
  validates a narrow native path, not the entire effect scheduler or complete original game.

### Equipment, action time and Biome batch on 2026-11-12

- **74 tests pass**: six source-rule tests plus 68 gameplay/UI/asset tests. New coverage checks
  actual equipment pickup, inspect/remove/equip, upgrade cancel/selection, heavy-armor movement,
  dagger damage, half-tick gloves, crab event timing and f32 rounding. Existing sewer-exit,
  search, locale and save-error regressions still pass.
- Biome fast checks and independent TypeScript compiler checks pass. Biome reports roughly
  50–80 ms for the 29-file scan on this machine; this is a local observation, not a portable
  performance guarantee. Temporary valid/syntax-error/duplicate-key files verified the check
  accepts valid input and rejects both error classes, and were removed after verification.
- Seven equipment sprite crops and Chinese metrics were regenerated through asset preparation;
  crop hashes are included in the pinned manifest. No Rust, BMS registry or public ABI changed.
- Windows/macOS/Linux/Android/iOS native execution, real touch/lifecycle, screenshots and
  matching reference-client pixel comparison are **NOT_RUN for this batch**. Script doubles
  model f32 reflection but cannot establish native rendering or complete original-game parity.

### Search and Goo exit interaction batch on 2026-11-12

- TypeScript game/tooling checks and bundle generation pass; **60 script tests pass**.
  Added coverage includes examine/cancel without time, hidden-occupant protection, search
  time/hunger/range, secret-door connectivity, real key/blob drops and pickup, boss/key exit
  gates, one-time milestone accounting, live hints, reduced camera motion and legacy settings.
- All 33 original image hashes and generated sprite hashes match the pinned source manifest.
  A deliberately corrupted cached warrior image was rejected by preparation; original cache
  bytes were restored afterward.
- Tests use platform doubles. No Rust/runtime interface changed. Windows, macOS, Linux,
  Android and iOS native interaction, touch/long-press, GPU rendering and reference-client
  pixel comparison were **NOT_RUN for this batch**. Older native evidence below belongs to
  its named changes and does not validate these new interactions.

### System language and application icon verification on 2026-11-12 (macOS Debug)

- Script tests: **52 passed**. Runtime tests: **41 passed, 1 performance test ignored**.
  Coverage includes system-language defaults, manual overrides, legacy saves, resetting defaults,
  pinned icon checksums, configured icon precedence and the registered Lua/QuickJS locale API.
- The rebuilt unified macOS runtime ran through the desktop launcher's `--run-game` path with
  isolated assets/saves under `target/ember-arena-icon-locale-native`. The native system preference
  was `zh-Hans-CN`; a fresh profile displayed the Chinese menu. The activated-window screenshot
  is `system-language-menu-active.png`. The host-prepared icon matches the upstream PNG byte for
  byte, and `dock-icons.png` confirms the original green chest in the live Dock. The expected icon
  SHA-256 and window geometry are in `verification.json`.
- The iOS runtime library passed a cross-target Cargo check. Windows, Linux and Android builds/
  native runs, iOS native execution and Release were **NOT_RUN**. The C ABI is unchanged.
- The existing Bevy/Parley/ICU4X CJK segmentation diagnostic remains reproducible during native
  Chinese text layout; this change does not patch or suppress that upstream issue.

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

`npm --prefix projects/ember-arena test` runs Biome, rebuilds the bundle, and runs deterministic
tests with platform doubles. Tests cover floor connectivity across 200 seed/depth combinations,
doors and visibility, idle/turn behavior, five-depth transitions, combat, mapping, hunger,
portrait input, resizing, asset provenance, settings, reset and error recovery.
Run `npm --prefix projects/ember-arena run typecheck` separately for compiler type checking.

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
