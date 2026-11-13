# Shattered Pixel Dungeon parity tracking

Reference: [00-Evan/shattered-pixel-dungeon, v4.0.2](https://github.com/00-Evan/shattered-pixel-dungeon/tree/57a4e06a4caf162446d1c28caa7983f0493fecf0),
revision `57a4e06a4caf162446d1c28caa7983f0493fecf0`, reviewed 2026-11-12.
This is a port in progress, not a claim of full game or visual parity. The upstream Java
game remains the behavior reference. Original art, UI and icon preparation share this
immutable revision; source and crop checksums are recorded in the asset manifests.

## Current sewer milestone

Mobile adaptation update (2026-11-12): Android arm64 and iOS device Debug builds and actual
launch/touch/rotation/background-pause paths were exercised with rebuilt runtimes. Optional BMS
`on_suspend()` cancels queued game input and pauses the in-process run; process-death save/load
remains absent. Script tests now pass 164 cases and unified runtime tests pass 42 (one ignored).
These checks and the three launchers' Chinese/English localization do not satisfy full-game,
all-platform or original-client pixel acceptance. See the current mobile evidence in README.md
and UI_PARITY.md; older batch-specific validation below is historical.

| Area | Implemented | Remaining difference |
| --- | --- | --- |
| Time | Fractional action times in reflected f32 components; independent healing/regeneration/fire/mob/buff deadlines with source priorities 0/-1/-10/-20/-30; hunger and LockedFloor have their own actors; idle frames do not advance actors | Exact same-priority actor ordering and the rest of the Actor framework remain pending |
| Terrain | Rooms, corridors, doors, water, entrance/exit | Custom 25×25 connected-room generator, not upstream builders/painters |
| Movement | Grid steps, bump melee, blocking, door action, known-tile click routes, real orthographic camera follow/zoom | Exact diagonal corner rules, auto-explore, running, upstream camera smoothing/deadzone and manual zoom controls pending |
| Sight | Wall/door occlusion, explored memory, hidden mobs/loot | Bresenham rays, not upstream shadow casting; no lighting/grass/blindness system |
| Search/examine | Turn-free tile examination; visible secret-door discovery; two-tick/six-hunger intentional search; Rogue radius 2, others 1 | Custom optional secret shortcut; no traps, passive discovery, talents or native long-press |
| Stairs | Explicit descent through five floors; supplies/HP and passive accumulators retained; Goo sealing creates a timed LockedFloor buff; key pickup and one-turn exit unlock | No return upstairs, floor persistence or prison transition; stronger-boss challenge variants pending |
| Rendering | Correctly cropped native 2D hero, mob, item and sewer sprites | Static frames; no original sprite animations, stitched raised walls, particle effects or exact UI layout |
| Native UI | Original atlas chrome/font, title and hero-selection scenes, joined toolbars, five-column backpack, item windows and tabbed settings | See [UI_PARITY.md](UI_PARITY.md); all original scenes/content and pixel-difference acceptance remain incomplete |
| Heroes | Four starting melee weapons and cloth armor are real carried items; original base damage ranges, half-tick gloves and dagger surprise range; Huntress carries a spirit bow; Mage has a charged magic-missile staff; Rogue wears a usable cloak; Warrior has a seal affixed to cloth armor; 20 starting HP, 10 strength | Full starting supplies, other classes/subclasses/talents pending |
| Broken seal / Warrior shield | Real item and independently scheduled buff; positive non-hunger damage at/crossing half HP activates before absorption; capacity 3 + 2×armor tier, 150-tick cooldown, five ticks without visible enemies remove shielding and refund its initial fraction; hunger bypasses shielding, depleted LockedFloor pauses cooldown; free detach/affix and a single transferable upgrade, including a once-upgradable loose seal; replacing Warrior armor prompts before actor advancement | Base identified uncursed armor only; no Iron Will, Hold Fast, Combo, glyph/curse transfer, magic immunity, other shield priorities, original shield bar/icon/flash or sound; visibility uses the port's current FOV |
| Cloak of Shadows | Rogue starts equipped with three charges and the original 9×15 item crop; item/quick-slot/C activation costs one tick, manual stop is free; four stealth ticks per charge, independent potion stacking, attack/zap dispel, use-XP levels and recharge; unequipping cancels stealth and stops its passive clock | Base identified uncursed cloak only; no Light Cloak/Protective Shadows talents, Assassin preparation, curses, magic immunity, energy rings, external artifact charge effects, original particles or sound |
| Mage staff | Item/quick-slot/Z targeting, four initial charges, one-tick casts, magic damage 2–8 at +0, extended magic-bolt collision; real independent charger with staff recharge curve, upgrade damage/capacity/+1 charge, unequipped and cross-floor charging; empty casts dispel invisibility | Only base identified magic-missile wand; current-FOV aim, no other wands/imbuing, MagicCharge sharing, cursed zaps, talents/subclasses, rings, recharging buffs, missile animation or sound |
| Spirit bow | Huntress starts with the original bow crop and first quick slot; free aim/cancel, first-impact projectiles, unlimited arrows, level-based damage/strength, adjacent/ranged accuracy and one-tick base shooting; target attacks dispel invisibility; gloves retain melee behavior | Current-FOV targeting only; no flying-arrow animation/sound, sniper specials, enchantments, rings, talents, augmentation or generic quickslot reassignment |
| Rats/Gnolls/Crabs | Upstream base stats; melee gnolls; crab movement costs 0.5 ticks while attacks cost 1, with independent reflected action deadlines | Simplified sleeping/hunting/door behavior and custom loot distributions |
| Goo | 100 HP, water healing, half-health enhancement, two-stage charge, range-2 burst, twenty-tick ooze with source sewer damage/water rules; real Worn Key and 2–4 blob drops; optional burst camera shake | Custom floor; simplified charge cancellation and hit processing, no boss badge/score rules |
| Progression | Kill XP, +5 maximum HP per level; selected weapon/armor drive accuracy, damage, reduction, evasion and time, including strength penalties | Rings, enchantments, curses, talents, challenge modifiers and ascension pending |
| Hunger | Hungry at 300, starving at 450 with one immediate damage; further damage accumulates HT/1000 per tick using f32 and a strict >1 threshold; food/search preserve actor phase and damage remainder; sealed floors pause hunger | WellFed, Shadows, Salt Cube, food talents, cursed Horn and challenge modifiers pending |
| Regeneration/LockedFloor | Independent regeneration accumulates 0.1 HP on eligible wounded ticks before mobs/DOT; full health/starvation pause the accumulator; normal Goo lock grants 50 ticks, damage restores 1.5× dealt damage capped at 50; boss death immediately removes the lock | Chalice, rings, trinkets, stronger-boss variants and other passive charging effects pending |
| Healing | One-turn potion applies a diminishing `(int)(0.8f*HT+14)` budget at 25% per tick; maximum-budget reapplication, priority before damage; does not cure ooze or burning | Other cured debuffs, challenges, trinkets and complete status interactions pending |
| Invisibility | Potion's independent twenty-tick expiry and cloak stealth coexist; removing/expiring either preserves the other; target attacks and wand casts dispel both; surprise hits | Other invisibility sources, preparation/talent interactions and original character rendering pending |
| Strength/upgrade | Strength +1; scroll selects any owned weapon/armor or an unupgraded loose seal; original damage/armor scaling and strength thresholds at +1/+3/+6/+10; cancel is free | No enchantment/curse handling or advanced upgrade interactions beyond the single seal level |
| Mapping | Reveals terrain and discovers secret doors without exposing occupants | No traps or challenge modifiers yet |
| Liquid flame | Free targeting/cancel; one-turn throw with first-character/door/solid collision; 3×3 fire, eight-tick Burning, water extinguishing and orthogonal door spread/destruction | Target selection limited to current FOV; static source-color marker instead of particles; no inventory/heap burning, plants, freezing, gases, immunities or advanced modifiers |
| Items/loot | Seven consumables, a carried spirit bow, an equippable cloak, an armor-bound or loose broken seal, gold, key/blobs and seven equipment definitions; real loot entities; equipment can be collected, inspected, worn and removed; bow/cloak excluded from scroll upgrades | Leather armor/shortsword drops on floors 2–4 are custom fixtures; randomized identification, generic throwing, other artifacts/keys/chests, shops and alchemy pending |
| Settings | Hints affect the HUD; reduced effects suppresses burst camera shake; inactive sensitivity explicitly disabled while preserving old values | No relative-pointer sensitivity, audio controls or complete upstream settings |
| End condition | Goo death keeps playing; physically collect its Worn Key, unlock the exit, then explicitly leave to record one sewer milestone | **No Amulet award**; prison and later content remain pending and are identified as unavailable in the result |
| Persistence | Settings and completed milestone records, save-error recovery | No in-progress run serialization or save/resume |

## Source anchors

All paths below are relative to the upstream repository's
`core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/`:

- `actors/hero/Hero.java`: starting 20 HP / 10 STR, level health growth, XP requirement and action handling.
- `actors/hero/HeroClass.java`: class-specific equipment; used to identify the gaps above.
- `items/BrokenSeal.java`, `items/armor/Armor.java`, `actors/{Char,hero/HeroClass}.java`, `actors/buffs/{ShieldBuff,HoldFast}.java`: starting armor attachment, half-HP activation before absorption, cooldown/decay/refund, hunger bypass, free attachment/detachment and the transferable level. Talents, glyphs, other shields and magic immunity are excluded. `sprites/ItemSpriteSheet.java` supplies the 13×13 seal frame at index 50.
- `items/artifacts/{CloakOfShadows,Artifact}.java`, `items/{KindofMisc,EquipableItem}.java`, `actors/buffs/Invisibility.java`: cloak equip/activation costs, paid stealth ticks, use-XP/capacity, inactive recharge and independent invisibility sources. Talent, curse, ring and magic-immunity modifiers are excluded.
- `actors/mobs/{Rat,Gnoll,Crab,Goo}.java`: basic stats, crab speed, Goo charge, water healing and enrage.
- `actors/buffs/{Hunger,Regeneration,LockedFloor}.java`: 300/450 thresholds, fractional starvation/regeneration accumulators, actor priorities and the fifty-tick passive window. `items/food/Food.java`, `actors/hero/Hero.java#search`, `actors/mobs/Goo.java#damage` and `levels/Level.java#seal` supply food/search costs, window extension and seal/unseal behavior.
- `actors/Actor.java`: f32 action times, rounding near whole ticks and hero/mob/buff priorities.
- `actors/buffs/{Healing,Ooze,Burning,Invisibility,FlavourBuff,Buff}.java`, `items/potions/{PotionOfHealing,PotionOfInvisibility}.java`: effect budgets, reapplication, expiry, water behavior and priorities.
- `items/{Item,potions/PotionOfLiquidFlame}.java`, `mechanics/Ballistica.java`, `actors/blobs/Fire.java`: one-turn throws, first impact, fire seeding, decay and spread. `effects/particles/FlameParticle.java` supplies the static marker's color/size only; its emitter animation is not ported.
- `items/{KindOfWeapon,EquipableItem}.java`, `items/weapon/{Weapon,melee/MeleeWeapon}.java`: equip/unequip time, accuracy and delay encumbrance, strength thresholds and damage scaling.
- `items/weapon/SpiritBow.java`, `items/weapon/missiles/MissileWeapon.java`, `items/Item.java`, `actors/hero/{Hero,HeroClass}.java`: carried starting bow, unlimited arrows, level growth, range accuracy, cast delay and target-only invisibility dispel. `sprites/ItemSpriteSheet.java` supplies the 16×16 bow frame at index 144.
- `items/weapon/melee/{WornShortsword,MagesStaff,Dagger,Gloves,Shortsword}.java`, `items/armor/{Armor,ClothArmor,LeatherArmor}.java`: supported item formulas.
- `items/wands/{Wand,WandOfMagicMissile}.java`, `MagesStaff.updateWand/applyWandChargeBuff`, `mechanics/Ballistica.java`: staff capacity/upgrade restoration, 0.75 recharge scaling, one-tick casts, magic damage, self-target rejection, invisibility dispel and MAGIC_BOLT continuation past empty aim cells.
- `actors/hero/Hero.java`, `items/rings/RingOfForce.java`: armor penalties, base attack/evasion growth, excess-strength rolls and ring-free unarmed damage.
- `actors/hero/Hero.java#search`: two action ticks, six hunger units, visible secret discovery and starting class search radii.
- `actors/mobs/Goo.java#die`, `items/keys/WornKey.java`, `items/quest/GooBlob.java`: source drop identities and 60/30/10 percent blob-count weights.
- `sprites/{HeroSprite,RatSprite,GnollSprite,CrabSprite,GooSprite}.java`: native animation frame sizes.
- `tiles/DungeonTileSheet.java`: floor 0, entrance 16, exit 17, water 32, flat wall 48, doors 56/57.
- `sprites/ItemSpriteSheet.java`: consumable, gold, ration and key atlas locations.

New behavior should cite an upstream source and add a focused behavior test. Tests using
platform doubles and a custom generator must not be described as proof of one-to-one parity.
The seal batch passes 162 tests, Biome and independent TypeScript checks.
The platform doubles round reflected numbers to f32. The existing headless macOS Debug
QuickJS/Bevy test also passes, checking real hunger/regeneration entities, hunger advancement,
three-tick eating and the existing healing diagnostic. It also starts the Huntress and injects
four pointer shots against a real actor, checking health, full-tick deadlines and retained bow/gloves.
The Mage path checks an actual pointer zap, target health, consumed charge, reflected partial
charge and the independent charger/hero clocks.
The Rogue path checks real cloak charge/XP/equip fields, its active buff/deadline and a free
manual stop through the actual bundle and BMS UI actions.
The Warrior path applies a real Burning actor at half HP, verifies shield absorption and the
independent cooldown/absence/initial-shield fields, then detaches and reaffixes the actual seal
through BMS UI actions without advancing the hero or shield clocks.
This does not establish GPU rendering, real input/lifecycle or reference-client pixel parity;
those checks are NOT_RUN for this batch on all five platforms. No runtime API or public ABI changed.

## Next migration order

1. Add other wands/imbuing, advanced seal/cloak/bow/status/item interactions,
   rings/curses and upstream starting inventories.
2. Port sewer builders/painters, entrance/boss room rules, returnable persistent floors,
   stitched tile visuals, upstream camera smoothing/zoom controls and sprite animation.
3. Port item identification, the remaining buffs and environmental interactions, traps, passive secrets,
   chests/keys, shops, alchemy, talents and in-progress save/resume.
4. Port the remaining regions, monsters, quests, bosses, final Amulet floor and return journey.
5. Validate native behavior on Windows, macOS, Linux, Android and iOS, with screenshots and
   real input/lifecycle evidence. No other-platform execution success is implied by Windows tests.

## Full-port completion contract

The target is the complete game at the pinned revision above, including behavior, content,
presentation and persistence. The five-floor sewer milestone is an intermediate deliverable.
Later upstream commits require a separate revision review so that acceptance has a stable target.
Internal batches follow one migration backlog; completing a batch does not establish full parity.

The workstreams below collect the known remaining scope. They are not an exhaustive
source-to-feature inventory: unreviewed upstream code remains an acceptance blocker. Before
full-game sign-off, map upstream gameplay and presentation code, assets and configuration to
implemented behavior and evidence, and record every intentional platform adaptation.

| Workstream | Required completion | Current evidence and gap |
| --- | --- | --- |
| Simulation and world rules | Actor ordering, movement/pathfinding, visibility, terrain and environmental interactions, AI, combat, all status interactions and modifiers | PARTIAL: selected sewer rules have script and native assertions; custom visibility, ordering and AI remain |
| Heroes and progression | All upstream classes, starting inventories, seal and other class items, subclasses, talents, abilities, unlocks and progression modifiers | PARTIAL: four base heroes and selected starting items, including the base seal; advanced kits and other classes remain |
| Items and economy | All item families, identification/curses/enchantments, equipment slots, bags/stacking/throwing, quickslot assignment, shops, trade and alchemy | PARTIAL: selected gear, consumables, bow, staff and cloak; most item families and interactions remain |
| Generation and floor state | Upstream builders/painters, room distributions, traps/secrets/plants, region-specific terrain, floor transitions and revisitable persistent floors | PARTIAL: custom sewer generator and descending-only floor replacement; upstream generation and floor restoration remain |
| Campaign and content | Every region, enemy, boss variant, NPC/quest, special room, key and objective; Amulet, return journey, challenges and endings | PARTIAL: selected sewer enemies and Goo milestone; later campaign and full run completion remain |
| Presentation and controls | Original scenes/windows, HUD/settings, camera, animations, layered terrain, particles, audio/music, localization and platform-equivalent controls | PARTIAL: retained UI and source atlas crops; original motion/audio, full scene coverage and reference capture comparisons remain |
| Run and profile persistence | Save/resume of complete world/actor/item state and random state, floor history, recovery, profile unlocks, journal/catalogue, badges and run records | PARTIAL: settings and sewer milestone records; in-progress runs and most profile systems remain |
| Runtime integration | Real Bevy World ownership, BMS-registered APIs, generated declarations and equivalent Lua/QuickJS behavior for any new runtime capability | Existing gameplay uses BMS; reassess each required capability and test any shared API changes on both adapters |
| Native acceptance | Builds and relevant device/desktop input, lifecycle, persistence, rendering, audio and performance checks on all five platforms | NOT_RUN for full-game acceptance; existing headless macOS checks and historical milestone evidence do not satisfy this gate |

Implementation follows the dependency order in the previous section. Each source-mapped feature
must cover normal behavior, edge cases and its interactions with already ported systems. Use
TypeScript for gameplay and repository tooling; extend the runtime only when existing BMS APIs
cannot express the required behavior. Preserve one real World rather than adding a mirrored game
state to simplify the port.

Record acceptance results separately as `PASS`, `FAIL`, `BLOCKED` or `NOT_RUN`:

1. **Source audit:** pin upstream paths and methods, enumerate behavior and interactions, and
   identify the local implementation. Unclassified source or unexplained adaptations block sign-off.
2. **Automated behavior:** verify source-derived scenarios and meaningful boundaries, run Biome,
   independent TypeScript checks, and the relevant script regressions. A test count is not a
   completeness measure.
3. **Runtime integration:** verify actual reflected actors/components and action ordering through
   the emitted bundle and BMS; add focused Lua/QuickJS registry tests when changing a runtime API.
4. **Reference comparison:** compare matched scenarios with the pinned upstream game, including
   gameplay outcomes and screenshots/animation/audio where relevant. Owning source art alone is
   insufficient evidence of visual parity.
5. **Platform acceptance:** record build and native scenario evidence independently for Windows,
   macOS, Linux, Android and iOS. Include save/relaunch and lifecycle/input behavior; unavailable
   targets remain explicitly unverified.

Full parity may only be reported after the source inventory is reconciled, every workstream is
complete, all required gates pass and no unexplained differences or unverified target platforms
remain. The current status is **PARTIAL**; neither the sewer victory screen nor the 162 passing
script tests constitutes full-game acceptance.
