"use strict";
// Quest data — the shard's quests, and the NPCs that give them.
//
// A quest is registered under an id in Pack.quests; a giver is an NPC placed on a
// tile that Pack.questGiverTiles maps to that id. Talk to the giver (double-click)
// to be offered the quest, and again once its objectives are met to turn it in.
// Objective kinds handled by quests/engine.js: "kill" (target = a creature body,
// credited to whoever struck the killing blow) and "deliver" (target = an item
// graphic the player uses). Rewards are gold or an item into the backpack.

globalThis.Pack = globalThis.Pack || {};
Pack.quests = Pack.quests || {};
Pack.npcs = Pack.npcs || {};
Pack.questGiverTiles = Pack.questGiverTiles || {};

// A worn robe and hair for the herald.
const HERALD_DRESS = [
  { graphic: 0x1f03, layer: 0x16, hue: 0x0455 }, // robe, muted red-brown
  { graphic: 0x203b, layer: 0x0b, hue: 0x0455 }, // hair
];

// The first quest: cull the sewer rats. A kill objective — the engine's
// `MobileDied` now carries the victim's body and its killer, so a rat slain by
// this player anywhere counts. Reward is gold, dropped into the backpack.
Pack.quests["rat_cull"] = {
  title: "A Plague of Rats",
  description: "Rats overrun the sewers beneath Britain. Slay five of them and\nreturn to me, and you will be paid.",
  objectives: [{ kind: "kill", target: 0x00ee, count: 5 }], // 0xEE — the common rat
  rewards: [{ gold: 250 }],
  complete: "The sewers will rest easier tonight. Here — you have earned this.",
};

// The town herald, who gives it — placed once by Populate Felucca, in the square
// north of the West Britain bank. When it spawns, engine.js's onSpawn matches its
// serial to the quest by this tile (the vendor-stock pattern).
const HERALD_X = 1495;
const HERALD_Y = 1629;

Pack.npcs["populate:felucca"] = (Pack.npcs["populate:felucca"] || []).concat([
  {
    body: 0x0190,
    notoriety: 7, // invulnerable — a quest giver is not loot
    hits: 100,
    name: "the town herald",
    x: HERALD_X,
    y: HERALD_Y,
    z: 0,
    equipment: HERALD_DRESS,
  },
]);
Pack.questGiverTiles[`${HERALD_X},${HERALD_Y}`] = "rat_cull";
