// Felucca · Britain — creature spawns.
//
// Registered into the shared `Pack.spawnSets` under the verb the `.admin`
// "populate" buttons send. Coordinates and creature lists are ServUO's Felucca
// points (ServUO/Spawns/felucca.xml); body ids are the `Body =` in each creature
// class. Notoriety wire bytes: 1 innocent, 3 neutral (grey animal), 5 enemy
// (orange), 6 murderer (red, freely attackable).

globalThis.Pack = globalThis.Pack || { spawnSets: {}, decoSets: {}, doorRegions: {} };

// The graveyard just north-west of the city — Spawns/felucca.xml "Graveyards#0".
const CEMETERY = {
  x: 1349, y: 1455, width: 40, height: 40, facet: 0,
  maxCount: 11, respawnDelay: 60, // ~3s between refills at 20Hz
  creatures: [
    { body: 0x001A, hits: 60, notoriety: 6, damage: 8, resistance: 5, sight: 10, wander: true }, // spectre
    { body: 0x001A, hits: 60, notoriety: 6, damage: 8, resistance: 5, sight: 10, wander: true }, // wraith
    { body: 0x0032, hits: 34, notoriety: 6, damage: 6, sight: 8, wander: true },                 // skeleton
    { body: 0x0003, hits: 30, notoriety: 6, damage: 5, sight: 8, wander: true },                 // zombie
  ],
};

// The placid surface life around the city.
const BRITAIN_ANIMALS = {
  x: 1400, y: 1590, width: 40, height: 40, facet: 0,
  maxCount: 15, respawnDelay: 80,
  creatures: [
    { body: 0x00D0, hits: 6, notoriety: 3, wander: true },  // chicken
    { body: 0x00D8, hits: 24, notoriety: 3, wander: true }, // cow
    { body: 0x00CC, hits: 28, notoriety: 3, wander: true }, // horse
    { body: 0x00CF, hits: 20, notoriety: 3, wander: true }, // sheep
    { body: 0x00CD, hits: 8, notoriety: 3, wander: true },  // rabbit
  ],
};

Pack.spawnSets["populate:britain"] = [BRITAIN_ANIMALS];
Pack.spawnSets["populate:cemetery"] = [CEMETERY];
