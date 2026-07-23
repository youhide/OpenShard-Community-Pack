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
// A one-shot item — a potion drunk and gone, a scroll read once — calls
// `op_consume_item(serial, amount)` to remove itself: `amount` 0 takes the whole
// item, a smaller amount decrements a stackable pile (one potion out of a lot).

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

// A greater heal potion (graphic 0x0F0C): drink it and it mends thee, then it is
// gone from thy pack. The one-shot the consume op exists for — potions stack, so
// it removes just the one bottle (`amount` 1), leaving the rest of the lot.
const HEAL_POTION = 0x0F0C;

Pack.itemUse[HEAL_POTION] = function (e) {
  Deno.core.ops.op_heal(e.by, 25);
  Deno.core.ops.op_consume_item(e.item, 1);
};
