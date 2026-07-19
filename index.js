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
