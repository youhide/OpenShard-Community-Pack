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

// A collect quest: bring the spellwright's apprentice five skeins of spiders'
// silk (a reagent the Britain mage sells). Collect objectives are not tracked as
// you play — the engine has no inventory events — so they hand in at the counter:
// talk to the giver and it asks the engine to take the items (all-or-nothing),
// paying only if you brought them all.
Pack.quests["silk_gather"] = {
  title: "Silk for the Spellwright",
  description: "Bring me five skeins of spiders' silk and you'll be paid.\nThe mage by the bank sells it.",
  objectives: [{ kind: "collect", target: 0x0f8d, count: 5 }], // 0x0F8D — spiders' silk
  rewards: [{ gold: 120 }],
  complete: "Fine silk — my thanks. Here is your pay.",
};

// Two givers, placed once by Populate Felucca in the square north of the West
// Britain bank. When each spawns, engine.js matches its serial to the quest by
// its tile (the vendor-stock pattern).
const HERALD_X = 1495;
const HERALD_Y = 1629;
const APPRENTICE_X = 1492;
const APPRENTICE_Y = 1629;

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
  {
    body: 0x0190,
    notoriety: 7,
    hits: 100,
    name: "the spellwright's apprentice",
    x: APPRENTICE_X,
    y: APPRENTICE_Y,
    z: 0,
    equipment: HERALD_DRESS,
  },
]);
Pack.questGiverTiles[`${HERALD_X},${HERALD_Y}`] = "rat_cull";
Pack.questGiverTiles[`${APPRENTICE_X},${APPRENTICE_Y}`] = "silk_gather";
