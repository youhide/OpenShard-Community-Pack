"use strict";
// Quest data — the shard's quests, and the NPCs that give them.
//
// The quest *system* is the engine's now (`crates/quests`): the offer window, the
// log the paperdoll's Quest button opens, progress, timers, turn-in and the save
// are all core. What is left here is content, which is the right split and the
// same one `Pack.loot` and the region data use.
//
// A quest is registered with op_register_quests, wholesale, at load time — a hot
// reload re-runs this file and replaces the lot. A giver is bound to an NPC by
// serial with op_bind_quest_giver, and **that binding is saved with the mobile**,
// which is what the old pack-side version could not do: it lived in a JS map, so
// every restart left the town's quest givers standing there answering nothing.
//
// Objective kinds the engine knows: "slay" (target = a creature body), "obtain"
// (target = an item graphic, counted from the backpack as you play), "deliver"
// (target = a graphic, destination = an NPC's name) and "escort" (destination =
// a region name).

globalThis.Pack = globalThis.Pack || {};
Pack.npcs = Pack.npcs || {};
Pack.questGiverTiles = Pack.questGiverTiles || {}; // "x,y" -> [quest keys]

// Named for this file: the pack is concatenated into one script, so a bare
// `const ops` here collides with index.js' and the whole pack fails to load.
const questOps = () => Deno.core.ops;

// A worn robe and hair for the herald.
const HERALD_DRESS = [
  { graphic: 0x1f03, layer: 0x16, hue: 0x0455 }, // robe, muted red-brown
  { graphic: 0x203b, layer: 0x0b, hue: 0x0455 }, // hair
];

questOps().op_register_quests({
  quests: [
    // A slay quest. The engine credits a kill to whoever struck the killing
    // blow, matched by the victim's body.
    {
      key: "rat_cull",
      title: "A Plague of Rats",
      description:
        "Rats overrun the sewers beneath Britain. Slay five of them and return to me, and you will be paid.",
      refuse: "Then the sewers will keep their tenants a while longer.",
      uncomplete: "The rats are still down there, friend. Five of them.",
      complete: "The sewers will rest easier tonight. Here — you have earned this.",
      objectives: [{ kind: "slay", target: 0x00ee, count: 5, name: "sewer rat" }],
      rewards: [{ gold: 250, name: "250 gold" }],
      restartDelaySecs: 600,
    },
    // An obtain quest. Unlike the pack's old "collect", this tracks *as you
    // play* — the engine counts the backpack twice a second — and the items are
    // taken at the counter, all-or-nothing across every objective.
    {
      key: "silk_gather",
      title: "Silk for the Spellwright",
      description:
        "Bring me five skeins of spiders' silk and you'll be paid. The mage by the bank sells it.",
      refuse: "As you like. The silk will not gather itself.",
      uncomplete: "Five skeins, no fewer. Come back when you have them.",
      complete: "Fine silk — my thanks. Here is your pay.",
      objectives: [
        { kind: "obtain", target: 0x0f8d, count: 5, name: "spiders' silk" },
      ],
      rewards: [{ gold: 120, name: "120 gold" }],
      restartDelaySecs: 600,
    },
  ],
});

// Two givers, placed once by Populate Felucca in the square north of the West
// Britain bank. Their tiles are matched to their quests when they spawn — and
// again when they are *restored* at boot, which is the whole point of the
// MobileRestored event (see index.js).
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
Pack.questGiverTiles[`${HERALD_X},${HERALD_Y}`] = ["rat_cull"];
Pack.questGiverTiles[`${APPRENTICE_X},${APPRENTICE_Y}`] = ["silk_gather"];
