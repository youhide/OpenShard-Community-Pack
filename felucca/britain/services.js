// Felucca · Britain — townsfolk services.
//
// Standing NPCs placed once (not maintained like monsters): the bankers who open
// your bank box when you say "bank" nearby, greet you by name when you come close,
// turn to face you, and shuffle a little around their post. Body 0x0190 is a human
// male; notoriety 7 is invulnerable (yellow bar, unattackable).
//
// Name: omitted on purpose — the engine gives each banker a generated name and the
// "the banker" title (e.g. "Rowena the banker"), so no two read the same.
//
// The engine drops each onto the floor at its (x, y) — z is only a hint — so nudge
// x/y if one ends up in a wall (pack data, hot-reload, no rebuild). Coordinates are
// ServUO's Felucca banker spawn centres: the West and East Britain banks.
//
// Clothing is worn gear like any other, drawn in the 0x78. Tweak the graphics and
// hues freely; a banker wears a robe (layer 0x16) and hair (layer 0x0B).

globalThis.Pack = globalThis.Pack || {
  spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {},
};
Pack.npcs = Pack.npcs || {};

// A robe and hair — a dignified, covered townsperson.
const BANKER_DRESS = [
  { graphic: 0x1F03, layer: 0x16, hue: 0x0396 }, // full robe, a muted slate blue
  { graphic: 0x203B, layer: 0x0B, hue: 0x0455 }, // short hair, dark brown
];

function banker(x, y) {
  return {
    body: 0x0190, banker: true, notoriety: 7, hits: 100,
    x, y, z: 0, equipment: BANKER_DRESS,
  };
}

Pack.npcs["populate:britain"] = [
  banker(1428, 1682), // West Britain Bank
  banker(1650, 1608), // East Britain Bank
];
