// OpenShard Community Pack — the shard's gameplay data and logic.
//
// `scripting.main` points at this *directory*. The server concatenates every
// `.js` under it (folders by facet and place) into one script, with the
// `index.js` files last, and hot-reloads the whole tree — so a shard's spawns and
// decoration are edited here and take effect without rebuilding the emulator.
//
// The seam: the engine forwards domain events to `onEvent(e)` and takes the
// commands issued through `Deno.core.ops.*`. Data files register into the shared
// `Pack` namespace under a verb; this file turns the `.admin` button that carries
// that verb into the ops that populate or decorate.
//
// Registries (each data file guard-initialises and fills one):
//   Pack.spawnSets[verb]   -> [ spawn region, ... ]
//   Pack.npcs[verb]        -> [ { body, name, banker, x, y, z, ... }, ... ]  // placed once
//   Pack.decoSets[verb]    -> { facet, statics, doors, containers }
//   Pack.doorRegions[verb] -> [ { facet, x, y, width, height }, ... ]  // door-gen
//   Pack.vendorStock[key]  -> [ { graphic, amount, price, name }, ... ]  // "x,y"
//   Pack.itemUse[graphic]  -> function(e)  // @DClick: what a used item does
//   Pack.loot[body]        -> [ { graphic, amount, stackable, chance }, ... ]  // corpse loot
//   Pack.regionSets[verb]  -> { facet, regions: [ ... ] }  // named areas
//   Pack.questGiverTiles[key] -> [ quest key, ... ]   // "x,y"; bound on spawn AND restore
//   Pack.escortTiles[key]  -> destination region name, or ""  // "x,y"

"use strict";

const ops = Deno.core.ops;

function onEvent(e) {
  // A freshly spawned vendor announces its serial here (op_spawn_mobile is
  // fire-and-forget). Match it back to the stock registered for its tile and
  // fill its crate once — the same event->op seam a scripted brain uses.
  if (e.type === "MobileSpawned") {
    const P = globalThis.Pack;
    const stock = P && P.vendorStock && P.vendorStock[`${e.x},${e.y}`];
    if (stock) {
      ops.op_stock({ serial: e.serial, items: stock });
      delete P.vendorStock[`${e.x},${e.y}`];
    }
    // A quest giver announces its serial the same way: match it to the quests
    // its tile names. The engine keeps the binding on the mobile and saves it,
    // so this is a first-placement step, not a per-boot one.
    bindQuestNpc(e.serial, e.x, e.y);
    return;
  }

  // An NPC came back from the save at boot. NOT a spawn: anything that *creates*
  // (a vendor's stock crate) must not run again, or it duplicates every reboot.
  // Binding is idempotent, so it runs here too — and has to, because a shard
  // whose quest givers were only ever bound on first placement went quietly inert
  // at the first restart.
  if (e.type === "MobileRestored") {
    bindQuestNpc(e.serial, e.x, e.y);
    return;
  }

  // Quests are the engine's: offering, tracking, the log window and the save all
  // live in `crates/quests`. What is left for a pack is the *content*
  // (quests/quests.js) and this one hook, for a reward the core's flat list
  // cannot express — a title, a follow-up, a line of dialogue. The declared
  // rewards are already paid by the time this arrives, so a script adds.
  if (e.type === "QuestCompleted") {
    const P = globalThis.Pack;
    const handler = P && P.questRewards && P.questRewards[e.key];
    if (handler) handler(e);
    return;
  }

  // The item-trigger seam (Sphere's @DClick): the engine handles the items it
  // knows and hands every other double-clicked item here, keyed by graphic.
  // Reach is already checked engine-side; a handler only decides what happens.
  if (e.type === "ItemUsed") {
    const P = globalThis.Pack;
    const handler = P && P.itemUse && P.itemUse[e.graphic];
    if (handler) handler(e);
    return;
  }

  // The loot seam: a slain creature's corpse is laid (with the core's baseline
  // gold already in it) and forwarded here by body. Roll the pack's table for
  // that body and fill the corpse by serial — the real per-creature loot on top.
  if (e.type === "CorpseCreated") {
    const P = globalThis.Pack;
    const table = P && P.loot && P.loot[e.body];
    if (table) for (const drop of table) rollLoot(e.corpse, drop);
    return;
  }

  if (e.type !== "AdminAction") return;

  const P = globalThis.Pack || {
    spawnSets: {},
    npcs: {},
    decoSets: {},
    doorRegions: {},
    regionSets: {},
  };

  switch (e.action) {
    case "clear":
      ops.op_clear_spawners();
      return;
    case "clear:deco":
      ops.op_clear_decorations();
      return;
    case "clear:regions":
      ops.op_clear_regions(0);
      return;
  }

  // A regions verb hands the facet its named areas — the towns, dungeons and
  // guarded zones the engine reads for guards, music, light and the no-teleport
  // rule. The whole set at once: the engine replaces what that facet had.
  const regions = P.regionSets && P.regionSets[e.action];
  if (regions) {
    ops.op_register_regions(regions);
    return;
  }

  // A populate verb both registers the maintained creature regions and places the
  // named, standing townsfolk (bankers, later vendors) once.
  const spawns = P.spawnSets && P.spawnSets[e.action];
  const npcs = P.npcs && P.npcs[e.action];
  if (spawns || npcs) {
    if (spawns) for (const region of spawns) ops.op_register_spawner(region);
    if (npcs) for (const npc of npcs) ops.op_spawn_mobile(npc);
    return;
  }

  // A decorate verb lays down statics/doors/containers and then generates the
  // functional shop doors the map's static frames only imply.
  const deco = P.decoSets[e.action];
  const doorRegions = P.doorRegions[e.action];
  if (deco || doorRegions) {
    if (deco) ops.op_decorate(deco);
    if (doorRegions) for (const region of doorRegions) ops.op_generate_doors(region);
  }
}

// Bind a placed or restored NPC to whatever its tile says it is: a quest giver,
// an escortable, or neither. Both bindings are saved with the mobile by the
// engine, so this is idempotent and safe to run on spawn and on restore alike.
function bindQuestNpc(serial, x, y) {
  const P = globalThis.Pack;
  if (!P) return;
  const key = `${x},${y}`;
  const keys = P.questGiverTiles && P.questGiverTiles[key];
  if (keys) ops.op_bind_quest_giver(serial, keys);
  const escort = P.escortTiles && P.escortTiles[key];
  if (escort !== undefined) ops.op_make_escortable(serial, escort);
}

// Roll one loot drop into a corpse. `amount` may be a fixed count or a [min, max]
// range; `chance` gates whether it drops at all. See `loot.js` for the shape.
function rollLoot(corpse, drop) {
  if (Math.random() > (drop.chance ?? 1)) return;
  let amount = drop.amount ?? 1;
  if (Array.isArray(amount)) {
    const [lo, hi] = amount;
    amount = lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  if (amount <= 0) return;
  ops.op_add_loot(corpse, drop.graphic, drop.hue ?? 0, amount, drop.stackable ?? false);
}
