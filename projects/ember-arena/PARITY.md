# Shattered Pixel Dungeon parity tracking

Reference: [00-Evan/shattered-pixel-dungeon, v4.0.2](https://github.com/00-Evan/shattered-pixel-dungeon/tree/57a4e06a4caf162446d1c28caa7983f0493fecf0),
revision `57a4e06a4caf162446d1c28caa7983f0493fecf0`, reviewed 2026-11-12.
This is a port in progress, not a claim of full game or visual parity. The upstream Java
game remains the behavior reference. Original art, UI and icon preparation share this
immutable revision; source and crop checksums are recorded in the asset manifests.

## Current sewer milestone

| Area | Implemented | Remaining difference |
| --- | --- | --- |
| Time | Fractional action times in reflected f32 components; independent healing/fire/mob/buff deadlines with source priorities 0/-1/-10/-20/-30; idle frames do not advance actors | Hunger/regeneration still share a tick; exact same-priority actor ordering and the rest of the Actor framework remain pending |
| Terrain | Rooms, corridors, doors, water, entrance/exit | Custom 25×25 connected-room generator, not upstream builders/painters |
| Movement | Grid steps, bump melee, blocking, door action, known-tile click routes, real orthographic camera follow/zoom | Exact diagonal corner rules, auto-explore, running, upstream camera smoothing/deadzone and manual zoom controls pending |
| Sight | Wall/door occlusion, explored memory, hidden mobs/loot | Bresenham rays, not upstream shadow casting; no lighting/grass/blindness system |
| Search/examine | Turn-free tile examination; visible secret-door discovery; two-tick/six-hunger intentional search; Rogue radius 2, others 1 | Custom optional secret shortcut; no traps, passive discovery, talents or native long-press |
| Stairs | Explicit descent through five floors; supplies/HP retained; Goo encounter sealing; key pickup and one-turn exit unlock | No return upstairs, floor persistence or prison transition; timed LockedFloor behavior pending |
| Rendering | Correctly cropped native 2D hero, mob, item and sewer sprites | Static frames; no original sprite animations, stitched raised walls, particle effects or exact UI layout |
| Native UI | Original atlas chrome/font, title and hero-selection scenes, joined toolbars, five-column backpack, item windows and tabbed settings | See [UI_PARITY.md](UI_PARITY.md); all original scenes/content and pixel-difference acceptance remain incomplete |
| Heroes | Four starting melee weapons and cloth armor are real carried items; original base damage ranges, half-tick gloves and dagger surprise range; 20 starting HP, 10 strength | Staff spells/charges, spirit bow, cloak/seal, full starting supplies, other classes/subclasses/talents pending |
| Rats/Gnolls/Crabs | Upstream base stats; melee gnolls; crab movement costs 0.5 ticks while attacks cost 1, with independent reflected action deadlines | Simplified sleeping/hunting/door behavior and custom loot distributions |
| Goo | 100 HP, water healing, half-health enhancement, two-stage charge, range-2 burst, twenty-tick ooze with source sewer damage/water rules; real Worn Key and 2–4 blob drops; optional burst camera shake | Custom floor; simplified charge cancellation and hit processing, no boss badge/score rules |
| Progression | Kill XP, +5 maximum HP per level; selected weapon/armor drive accuracy, damage, reduction, evasion and time, including strength penalties | Rings, enchantments, curses, talents, challenge modifiers and ascension pending |
| Hunger | Hungry at 300, starving at 450, ration satisfies 300 and takes 3 turns | Simplified regeneration/starvation rates and locked-floor interaction |
| Healing | One-turn potion applies a diminishing `(int)(0.8f*HT+14)` budget at 25% per tick; maximum-budget reapplication, priority before damage; does not cure ooze or burning | Other cured debuffs, challenges, trinkets and complete status interactions pending |
| Invisibility | Independent twenty-tick expiry, blocks detection, attacks break it; surprise hits | Potion-only implementation, no complete cloak/artifact mechanics |
| Strength/upgrade | Strength +1; scroll selects any owned weapon/armor; original damage/armor scaling and strength thresholds at +1/+3/+6/+10; cancel is free | No enchantment/curse handling or advanced upgrade interactions |
| Mapping | Reveals terrain and discovers secret doors without exposing occupants | No traps or challenge modifiers yet |
| Liquid flame | Free targeting/cancel; one-turn throw with first-character/door/solid collision; 3×3 fire, eight-tick Burning, water extinguishing and orthogonal door spread/destruction | Target selection limited to current FOV; static source-color marker instead of particles; no inventory/heap burning, plants, freezing, gases, immunities or advanced modifiers |
| Items/loot | Seven consumables, gold, key/blobs and seven equipment definitions; real loot entities; equipment can be collected, inspected, worn and removed | Leather armor/shortsword drops on floors 2–4 are custom fixtures; randomized identification, throwing, other keys/chests, shops and alchemy pending |
| Settings | Hints affect the HUD; reduced effects suppresses burst camera shake; inactive sensitivity explicitly disabled while preserving old values | No relative-pointer sensitivity, audio controls or complete upstream settings |
| End condition | Goo death keeps playing; physically collect its Worn Key, unlock the exit, then explicitly leave to record one sewer milestone | **No Amulet award**; prison and later content remain pending and are identified as unavailable in the result |
| Persistence | Settings and completed milestone records, save-error recovery | No in-progress run serialization or save/resume |

## Source anchors

All paths below are relative to the upstream repository's
`core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/`:

- `actors/hero/Hero.java`: starting 20 HP / 10 STR, level health growth, XP requirement and action handling.
- `actors/hero/HeroClass.java`: class-specific equipment; used to identify the gaps above.
- `actors/mobs/{Rat,Gnoll,Crab,Goo}.java`: basic stats, crab speed, Goo charge, water healing and enrage.
- `actors/buffs/Hunger.java`: 300/450 hunger thresholds.
- `actors/Actor.java`: f32 action times, rounding near whole ticks and hero/mob/buff priorities.
- `actors/buffs/{Healing,Ooze,Burning,Invisibility,FlavourBuff,Buff}.java`, `items/potions/{PotionOfHealing,PotionOfInvisibility}.java`: effect budgets, reapplication, expiry, water behavior and priorities.
- `items/{Item,potions/PotionOfLiquidFlame}.java`, `mechanics/Ballistica.java`, `actors/blobs/Fire.java`: one-turn throws, first impact, fire seeding, decay and spread. `effects/particles/FlameParticle.java` supplies the static marker's color/size only; its emitter animation is not ported.
- `items/{KindOfWeapon,EquipableItem}.java`, `items/weapon/{Weapon,melee/MeleeWeapon}.java`: equip/unequip time, accuracy and delay encumbrance, strength thresholds and damage scaling.
- `items/weapon/melee/{WornShortsword,MagesStaff,Dagger,Gloves,Shortsword}.java`, `items/armor/{Armor,ClothArmor,LeatherArmor}.java`: supported item formulas. Staff melee is implemented; its wand capability is not.
- `actors/hero/Hero.java`, `items/rings/RingOfForce.java`: armor penalties, base attack/evasion growth, excess-strength rolls and ring-free unarmed damage.
- `actors/hero/Hero.java#search`: two action ticks, six hunger units, visible secret discovery and starting class search radii.
- `actors/mobs/Goo.java#die`, `items/keys/WornKey.java`, `items/quest/GooBlob.java`: source drop identities and 60/30/10 percent blob-count weights.
- `sprites/{HeroSprite,RatSprite,GnollSprite,CrabSprite,GooSprite}.java`: native animation frame sizes.
- `tiles/DungeonTileSheet.java`: floor 0, entrance 16, exit 17, water 32, flat wall 48, doors 56/57.
- `sprites/ItemSpriteSheet.java`: consumable, gold, ration and key atlas locations.

New behavior should cite an upstream source and add a focused behavior test. Tests using
platform doubles and a custom generator must not be described as proof of one-to-one parity.
The timed-effects batch passes 90 tests, Biome and independent TypeScript checks.
The platform doubles round reflected numbers to f32. The existing headless macOS Debug
QuickJS/Bevy test also passes, including a real reflected healing entity and one healing tick.
This does not establish GPU rendering, real input/lifecycle or reference-client pixel parity;
those checks are NOT_RUN for this batch on all five platforms. No runtime API or public ABI changed.

## Next migration order

1. Finish hunger/regeneration/LockedFloor actors and advanced status/item interactions; add staff/spirit-bow targeting
   and charges, cloak/seal behavior, rings/curses and upstream starting inventories.
2. Port sewer builders/painters, entrance/boss room rules, returnable persistent floors,
   stitched tile visuals, upstream camera smoothing/zoom controls and sprite animation.
3. Port item identification, the remaining buffs and environmental interactions, traps, passive secrets,
   chests/keys, shops, alchemy, talents and in-progress save/resume.
4. Port the remaining regions, monsters, quests, bosses, final Amulet floor and return journey.
5. Validate native behavior on Windows, macOS, Linux, Android and iOS, with screenshots and
   real input/lifecycle evidence. No other-platform execution success is implied by Windows tests.
