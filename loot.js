// Loot tables — what a slain creature's corpse holds beyond the core's gold.
//
// This is the pack side of the engine's loot seam. When a creature dies the
// engine lays its corpse, drops a flat baseline of gold (so a bare shard still
// loots), and forwards a `CorpseCreated` event carrying the corpse serial and the
// creature's `body`. A handler here reads that body, rolls its table, and fills
// the corpse by serial through `op_add_loot` — the "default in core, customise in
// the pack" split combat, magic and item triggers already use.
//
// Register one table per creature body into `Pack.loot`. `index.js` looks the
// body up and rolls it. A table is a list of drops:
//
//   { graphic, hue?, amount?, stackable?, chance? }
//
//   graphic    the item tile to drop
//   hue        its colour, default 0
//   amount     a fixed count, or a [min, max] range rolled inclusive; default 1
//   stackable  true for gold/reagents/arrows (they merge), false for a discrete
//              piece like a weapon or a suit of armour; default false
//   chance     probability 0..1 that it drops at all; default 1 (always)
//
// Adding a creature's loot is a few lines here — no engine change, hot-reloaded
// on save. Bodies match the creatures the spawns place (see felucca/**/spawns).
//
// Note: `amount` is rolled with `Math.random` — pack loot is deliberately not
// bound by the engine's replayable-tick determinism (that guarantee is the core's
// seeded rng; a script is an external input, like a network packet).

"use strict";

globalThis.Pack = globalThis.Pack || {
  spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {},
};
Pack.loot = Pack.loot || {};

// Common item tiles this pack drops.
const GOLD = 0x0EED;        // stacks
const ARROW = 0x0F3F;       // stacks
const BLACK_PEARL = 0x0F7A; // a reagent, stacks
const DAGGER = 0x0F52;      // a discrete weapon
const LEATHER_CHEST = 0x13CC; // a discrete piece of armour

// An orc (body 0x0032): a fighter, so a little extra gold, a chance at its dagger
// and the leather it wore, and the odd handful of arrows.
Pack.loot[0x0032] = [
  { graphic: GOLD, amount: [20, 60], stackable: true },
  { graphic: DAGGER, chance: 0.4 },
  { graphic: LEATHER_CHEST, chance: 0.15 },
  { graphic: ARROW, amount: [3, 8], stackable: true, chance: 0.5 },
];

// A spectre (body 0x001A): undead, no gear, but it hoards reagents.
Pack.loot[0x001A] = [
  { graphic: GOLD, amount: [10, 40], stackable: true },
  { graphic: BLACK_PEARL, amount: [1, 4], stackable: true, chance: 0.6 },
];
