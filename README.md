# OpenShard Community Pack

The reference script pack for [**OpenShard**](https://github.com/youhide/OpenShard)
— a shard's gameplay **data and logic**, edited here and hot-reloaded, with no
emulator rebuild.

The engine (Rust) provides the machinery — the tick, the protocol, the spawner,
the ops, the default rules (the 64-spell Magery table, the skill curves). This
pack provides what a *particular* shard does with it: which creatures spawn
where, what the town looks like, who banks your gold and sells you a shirt, and
any spell or skill effect a shard wants done differently from the core default.
It is the Sphere `Scripts-X` idea, in JavaScript over a real V8 isolate.

## Using it

Point the shard's `openshard.toml` at this **directory**:

```toml
[scripting]
main = "/absolute/path/to/OpenShard-Community-Pack"
```

The engine concatenates every `.js` under it into one script — data files first,
`index.js` files last — and watches the whole tree: save any file and the running
shard reloads the pack.

Then, on a fresh (empty-store) world, a game master runs `.admin` in game and
presses the Populate/Decorate buttons **once**. The world is saved whole from
that point on — spawns, decoration, doors, vendor stock all persist in the
database, and nothing re-populates at boot.

## Layout

```
index.js                     the entry point: onEvent, verb dispatch
items.js                     item triggers: what a double-clicked item does (@DClick)
loot.js                      corpse loot tables: what a slain creature drops, by body
felucca/
  britain/
    spawns.js                maintained creature regions (graveyard, farmland, …)
    deco.js                  statics, named doors, town containers, door-gen regions
    services.js              bankers and vendors, dress and stock
```

Folders follow facet and place. A data file registers what it knows into the
shared `Pack` namespace under a **verb** (`Pack.spawnSets["populate:britain"]`,
`Pack.decoSets["decorate:britain"]`, …); `index.js` turns the `.admin` button
that carries that verb into the ops that make it real. Adding a city or a
dungeon is a new folder and a new verb — no engine change.

## What's here

### Spawns (`spawns.js`)

Maintained creature regions: each holds an area, creature templates (body,
notoriety, hits, damage, aggression, ranged reach, …), a max count and a respawn
delay. The engine keeps the region populated — a creature dies, the timer
refills it. Coordinates and creature lists are ServUO's Felucca points
(`ServUO/Spawns/felucca.xml`); body ids are the `Body =` value in each ServUO
creature class.

### Decoration and doors (`deco.js`)

Everything the shard adds on top of the client's static map art, migrated from
ServUO's `britain.cfg` and `signs.cfg`: plain **statics** (walls, furniture,
shop signs), named **doors** (closed/open graphics and hinge offsets resolved
from ServUO's door tables *at pack time*, so the engine stays a generic toggle),
**containers** that open onto a gump (town chests, crates), and **door-gen
regions** — the engine scans the map's static door frames inside each region and
drops a functional wooden door into every gap the art implies (ServUO's
`DoorGenerator`, in the engine).

### Services (`services.js`)

The townsfolk placed once, not maintained: **bankers** (say "bank" nearby to
open your box, "balance" to count the gold; the engine names them, dresses them
from the pack's outfit data and stands them on the floor) and **vendors** — a
spawn flagged `vendor` gets its stock crate filled by the pack (`op_stock`,
matched by tile when the `MobileSpawned` event announces the serial), priced and
named per item. Double-click a vendor to buy; say "sell" nearby to sell at half
price. Stock persists with the vendor in the shard's save.

### Item triggers (`items.js`)

Sphere's `@DClick`, the OpenShard way. The engine handles the items it knows how
to — a door toggles, a container opens, a spellbook unfolds, a mount is ridden —
and forwards every *other* double-clicked item to the pack as an `ItemUsed`
event, keyed by graphic, with reach already checked. A handler registered into
`Pack.itemUse[graphic]` decides what the item *means*: it may reach for any op
(`op_heal`, `op_cast_spell`, `op_spawn_item`, `op_say`, …). The engine keeps no
default behaviour for a bare item — the meaning lives entirely here, so adding a
usable item is a line in this file, hot-reloaded, no rebuild. A one-shot item —
a potion drunk and gone, a scroll read once — calls `op_consume_item(serial,
amount)` to remove itself (`amount` 0 takes the whole item, a smaller amount
decrements a stackable pile). The shipped examples are a readable brown book
(`.add 0x0FF2`, then double-click) and a greater heal potion (`0x0F0C`) that mends
the drinker and vanishes.

### Loot tables (`loot.js`)

The pack side of the corpse loot seam. When a creature dies the engine lays its
corpse, drops a flat baseline of gold (so a bare shard still loots), and forwards
a `CorpseCreated` event carrying the corpse serial and the creature's `body`. A
table registered into `Pack.loot[body]` is rolled by `index.js` and dropped into
the corpse through `op_add_loot` — the real per-creature loot *on top of* the
core baseline. A drop is `{ graphic, hue?, amount?, stackable?, chance? }`, where
`amount` may be a `[min, max]` range and `stackable` merges gold/reagents but not
a discrete weapon or armour. Adding a creature's loot is a few lines here, keyed
by the same body id the spawns use, hot-reloaded, no rebuild. The shipped
examples are an orc (extra gold, a chance at its dagger and leather) and a
spectre (gold and black pearls). Because loot is the pack's, it may use
`Math.random` freely — the engine's replayable-tick determinism is the core's
seeded rng, and a script is an external input to it, like a network packet.

## The seam, briefly

- **Events in** (`onEvent(e)`): `e.type` is one of `PlayerEntered`,
  `MobileSpawned`, `MobileMoved`, `StepRefused`, `PlayerLeft`, `MobileDied`,
  `CorpseCreated`, `SkillUsed`, `SpellCast`, `MobileSpoke`, `ItemUsed`,
  `AdminAction`. Each carries a `serial` (or, for `ItemUsed`, an `item` and a
  `by`; for `CorpseCreated`, a `corpse` and a `body`) and its own fields.
- **Commands out** (`Deno.core.ops.op_*`): `op_spawn_mobile`, `op_spawn_item`,
  `op_spawn_container`, `op_register_spawner`, `op_clear_spawners`,
  `op_decorate`, `op_generate_doors`, `op_clear_decorations`, `op_stock`,
  `op_add_loot`, `op_consume_item`, `op_say`, `op_damage`, `op_heal`,
  `op_cast_spell`, `op_set_stats`, `op_set_skill`, `op_use_skill`, `op_control`,
  `op_move`, …
- **A scripted brain**: `op_control(serial)` takes a mobile off the engine's
  built-in AI; the pack's `onTick(serial)` then runs for it every tick.

A script never touches the world directly: it reads events and enqueues
commands, which the tick applies in order — the same seam every engine system
uses. Spell and skill *effects* follow the "default in core, customise in the
pack" split: the engine runs the classic behaviour, and a pack overrides any
spell by reacting to its `SpellCast` (or rewards any skill off `SkillUsed`).

## Provenance

Coordinates, creature lists, decoration and door tables are read from ServUO's
data files and resolved to raw numbers here, at pack time. No client files are
in this repository and none ever will be — art, maps and clilocs belong to the
client install the shard's operator already has.
