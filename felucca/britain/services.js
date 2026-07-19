// Felucca · Britain — townsfolk services.
//
// Standing NPCs placed once (not maintained like monsters): the bankers who open
// your bank box when you say "bank" nearby. Body 0x0190 is a human male; notoriety
// 7 is invulnerable (a yellow health bar, unattackable). Coordinates are ServUO's
// Felucca banker spawns — the West and East Britain banks.

globalThis.Pack = globalThis.Pack || {
  spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {},
};
Pack.npcs = Pack.npcs || {};

Pack.npcs["populate:britain"] = [
  // West Britain Bank — the classic WBB.
  { body: 0x0190, name: "the banker", banker: true, notoriety: 7, hits: 100, x: 1428, y: 1682, z: 0 },
  // East Britain Bank.
  { body: 0x0190, name: "the banker", banker: true, notoriety: 7, hits: 100, x: 1650, y: 1608, z: 0 },
];
