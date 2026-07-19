# OpenShard Community Pack

The example/scaffold script pack for OpenShard — a shard's gameplay **data and
logic**, edited here and hot-reloaded, with no emulator rebuild.

The engine (Rust) provides the machinery — the tick, the protocol, the spawner,
the ops. This pack provides what a *particular* shard does with it: which
creatures spawn where, what NPCs say, how spells resolve. It is the Sphere
`Scripts-X` idea, in JavaScript over a real V8 isolate.

## Using it

Point the shard's `openshard.toml` at `main.js`:

```toml
[scripting]
main = "/absolute/path/to/OpenShard-Community-Pack/main.js"
```

The file is watched — save it and the running shard reloads it.

## What's here

- **`main.js`** — the entry point. It reacts to the engine's domain events in
  `onEvent(e)` and issues commands through `Deno.core.ops.*`.

### Spawns

The `.admin` staff menu (game master and up) emits an `AdminAction` event with a
verb like `"populate:britain"`. `main.js` maps each verb to a set of **spawn
regions** and registers them with `op_register_spawner`; the engine then keeps
each region populated — a creature dies, another takes its place.

Coordinates and creature lists are ServUO's Felucca points
(`ServUO/Spawns/felucca.xml`); body ids are the `Body =` value in each ServUO
creature class. Add a city or a dungeon by adding a region and a verb to
`SPAWN_SETS` — no rebuild.

## The seam, briefly

- **Events in** (`onEvent(e)`): `e.type` is one of `PlayerEntered`,
  `MobileSpawned`, `MobileMoved`, `PlayerLeft`, `MobileDied`, `SkillUsed`,
  `SpellCast`, `MobileSpoke`, `AdminAction`, … Each carries a `serial` and its
  own fields.
- **Commands out** (`Deno.core.ops.op_*`): `op_spawn_mobile`, `op_spawn_item`,
  `op_register_spawner`, `op_clear_spawners`, `op_say`, `op_damage`, `op_heal`,
  `op_cast_spell`, `op_set_stats`, `op_set_skill`, `op_use_skill`, `op_control`, …

A script never touches the world directly: it reads events and enqueues
commands, which the tick applies in order.
