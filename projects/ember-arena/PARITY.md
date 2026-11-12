# Shattered Pixel Dungeon parity tracking

Reference: [00-Evan/shattered-pixel-dungeon, master](https://github.com/00-Evan/shattered-pixel-dungeon/tree/master),
reviewed 2026-11-11. This is a port in progress, not a claim of full game or visual parity.
The upstream Java game remains the behavior reference. Existing asset-cache contents may
predate this review; generated file checksums are recorded separately.

## Current sewer milestone

| Area | Implemented | Remaining difference |
| --- | --- | --- |
| Time | Hero actions advance monsters/hunger; idle frames do not | Integer action budget, not upstream's full fractional Actor scheduler |
| Terrain | Rooms, corridors, doors, water, entrance/exit | Custom 25×25 connected-room generator, not upstream builders/painters |
| Movement | Grid steps, bump melee, blocking, door action, known-tile click routes, real orthographic camera follow/zoom | Exact diagonal corner rules, auto-explore, running, upstream camera smoothing/deadzone and manual zoom controls pending |
| Sight | Wall/door occlusion, explored memory, hidden mobs/loot | Bresenham rays, not upstream shadow casting; no lighting/grass/blindness system |
| Stairs | Explicit descent through five floors; supplies/HP retained | No return upstairs, floor persistence, boss-floor sealing, locked exits or prison transition |
| Rendering | Correctly cropped native 2D hero, mob, item and sewer sprites | Static frames; no original sprite animations, stitched raised walls, particle effects or exact UI layout |
| Native UI | Original atlas chrome/font, title and hero-selection scenes, joined toolbars, five-column backpack, item windows and tabbed settings | See [UI_PARITY.md](UI_PARITY.md); all original scenes/content and pixel-difference acceptance remain incomplete |
| Heroes | Warrior/Mage/Rogue/Huntress; 20 starting HP, 10 strength | Full equipment effects, wand/staff charges, spirit bow, cloak/seal, other classes/subclasses/talents pending |
| Rats/Gnolls/Crabs | Upstream base HP, attack/defense, damage/armor ranges and XP; melee gnolls, faster crabs | Simplified sleeping/hunting and movement scheduling; loot distributions not identical |
| Goo | 100 HP, water healing, half-health enhancement, two-stage charge, range-2 burst, removable ooze | Custom floor; simplified charge cancellation, ooze duration, hit processing, no boss badge/score rules |
| Progression | Kill XP, 5+5×level XP requirement, +5 maximum HP per level | No talent allocation, full item-based accuracy/damage/defense, challenge modifiers or ascension |
| Hunger | Hungry at 300, starving at 450, ration satisfies 300 and takes 3 turns | Simplified regeneration/starvation rates and locked-floor interaction |
| Healing | Restores health and clears ooze; spends a turn | Immediate recovery rather than upstream healing buff; no full status interactions |
| Invisibility | 20 action turns, blocks detection, attacks break it; surprise hits | Potion-only implementation, no complete cloak/artifact mechanics |
| Strength/upgrade | Strength +1; weapon upgrade +1 | Simplified damage bonus; no equipment selection, strength requirements, curse handling or upgrade formulas |
| Mapping | Reveals terrain without exposing occupants | No traps/secrets/challenges to map yet |
| Liquid flame | One-turn nearby visible-target damage | Immediate area damage rather than thrown targeting, persistent fire and Burning buffs |
| Items/loot | Seven identified consumables, gold, real Bevy loot entities, collection on entering a tile | Fixed appearances; no randomized identification, equipment inventory, throwing, chest/key, shop or alchemy systems |
| End condition | Goo defeat records one sewer milestone and Skeleton Key | **No Amulet award**; remaining regions, bosses, Amulet level and return journey pending |
| Persistence | Settings and completed milestone records, save-error recovery | No in-progress run serialization or save/resume |

## Source anchors

All paths below are relative to the upstream repository's
`core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/`:

- `actors/hero/Hero.java`: starting 20 HP / 10 STR, level health growth, XP requirement and action handling.
- `actors/hero/HeroClass.java`: class-specific equipment; used to identify the gaps above.
- `actors/mobs/{Rat,Gnoll,Crab,Goo}.java`: basic stats, crab speed, Goo charge, water healing and enrage.
- `actors/buffs/Hunger.java`: 300/450 hunger thresholds.
- `sprites/{HeroSprite,RatSprite,GnollSprite,CrabSprite,GooSprite}.java`: native animation frame sizes.
- `tiles/DungeonTileSheet.java`: floor 0, entrance 16, exit 17, water 32, flat wall 48, doors 56/57.
- `sprites/ItemSpriteSheet.java`: consumable, gold, ration and key atlas locations.

New behavior should cite an upstream source and add a focused behavior test. Tests using
platform doubles and a custom generator must not be described as proof of one-to-one parity.

## Next migration order

1. Port the full action scheduler and equipment-driven combat; add wand/spirit-bow targeting
   and charges, cloak/seal behavior, and upstream starting inventories.
2. Port sewer builders/painters, entrance/boss room rules, returnable persistent floors,
   stitched tile visuals, upstream camera smoothing/zoom controls and sprite animation.
3. Port item identification, gradual healing, thrown/persistent flame, buffs, traps, secrets,
   chests/keys, shops, alchemy, talents and in-progress save/resume.
4. Port the remaining regions, monsters, quests, bosses, final Amulet floor and return journey.
5. Validate native behavior on Windows, macOS, Linux, Android and iOS, with screenshots and
   real input/lifecycle evidence. No other-platform execution success is implied by Windows tests.
