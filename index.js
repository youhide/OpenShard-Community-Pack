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
    // A quest giver announces its serial the same way: match it to the quest its
    // tile names, so a double-click on it later offers that quest.
    if (P && P.Quests) P.Quests.onSpawn(e.serial, e.x, e.y);
    // An escortable does likewise, and is taken under script control so its
    // onTick can follow whoever leads it.
    if (P && P.Escort) P.Escort.onSpawn(e.serial, e.x, e.y);
    return;
  }

  // The quest seams. Double-clicking an NPC (MobileUsed) offers or turns in its
  // quest; the offer dialog's answer (GumpAnswered) accepts it; a credited kill
  // (MobileDied carries the body and the killer) advances a "slay N" objective;
  // and a saved log (QuestLoaded, on login) rebuilds the player's progress.
  if (e.type === "MobileUsed") {
    const P = globalThis.Pack;
    // A quest giver first; an escortable if it was not one.
    if (P && P.Quests && P.Quests.onTalk(e.mobile, e.by)) return;
    if (P && P.Escort) P.Escort.onTalk(e.mobile, e.by);
    return;
  }
  if (e.type === "MobileSpoke") {
    const P = globalThis.Pack;
    if (P && P.Quests) P.Quests.onSpeech(e.serial, e.text);
    return;
  }
  if (e.type === "GumpAnswered") {
    const P = globalThis.Pack;
    if (P && P.Quests) P.Quests.onGump(e.serial, e.gump_id, e.button);
    return;
  }
  if (e.type === "MobileDied") {
    const P = globalThis.Pack;
    if (P && P.Quests) P.Quests.onKill(e.killer, e.body);
    return;
  }
  if (e.type === "QuestLoaded") {
    const P = globalThis.Pack;
    if (P && P.Quests) P.Quests.restore(e.serial, e.blob);
    return;
  }

  // The item-trigger seam (Sphere's @DClick): the engine handles the items it
  // knows and hands every other double-clicked item here, keyed by graphic.
  // Reach is already checked engine-side; a handler only decides what happens.
  if (e.type === "ItemUsed") {
    const P = globalThis.Pack;
    const handler = P && P.itemUse && P.itemUse[e.graphic];
    if (handler) handler(e);
    // A used item may also be a quest "deliver" target — advance that objective.
    if (P && P.Quests) P.Quests.onDeliver(e.by, e.graphic);
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

  const P = globalThis.Pack || { spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {} };

  switch (e.action) {
    case "clear":
      ops.op_clear_spawners();
      return;
    case "clear:deco":
      ops.op_clear_decorations();
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

// The per-mobile brain the engine calls each tick for every mobile a script has
// taken control of (op_control). Today that is the escortables: each follows its
// escorter and pays on arrival.
function onTick(serial) {
  const P = globalThis.Pack;
  if (P && P.Escort) P.Escort.tick(serial);
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
