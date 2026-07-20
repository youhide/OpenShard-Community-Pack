// Item triggers — what a double-clicked item does.
//
// This is the pack side of the engine's item-trigger seam (Sphere's `@DClick`).
// The engine handles the items it knows how to — a door toggles, a container
// opens, a spellbook unfolds, a mount is ridden — and forwards every *other*
// double-clicked item to `onEvent` as an `ItemUsed` carrying its `graphic`, its
// `item` serial and the `by` mobile. Reach is already checked engine-side; a
// handler here only decides what the item *means*.
//
// Register one handler per graphic into `Pack.itemUse`. `index.js` looks the
// graphic up and calls it. Adding an item behaviour is a line here — no engine
// change, hot-reloaded on save. A handler may reach for any op: `op_heal`,
// `op_damage`, `op_cast_spell`, `op_spawn_item`, `op_say`, `op_set_skill`, …
//
// Note: there is no op to *consume* the used item yet, so a one-shot like a heal
// potion (drink and vanish) waits on that primitive — see OpenShard's roadmap
// §6. The behaviours that fit today are the reusable ones: a read, a toggle, a
// summon, an emote.

"use strict";

globalThis.Pack = globalThis.Pack || {
  spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {},
};
Pack.itemUse = Pack.itemUse || {};

// A brown book (graphic 0x0FF2): read it and a line of its lore appears over the
// reader's head, seen by them alone — the smallest possible item trigger, and the
// one that needs nothing but `op_say`. Drop one with `.add 0x0FF2` and double-click.
const BROWN_BOOK = 0x0FF2;
const WELCOME_LINES = [
  "The pages read: 'Welcome, traveller, to the shard of OpenShard.'",
  "The pages read: 'Say a word near a banker to open thy vault.'",
  "The pages read: 'A mage in Britain will sell thee a spellbook and scrolls to fill it.'",
];

Pack.itemUse[BROWN_BOOK] = function (e) {
  const line = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
  Deno.core.ops.op_say(e.by, line, 0x0481); // a soft parchment hue
};
