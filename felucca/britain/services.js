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
Pack.vendorStock = Pack.vendorStock || {};

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

// The tailor: a vendor. Double-click opens its shop (buy), and saying "sell"
// nearby offers to buy back what it also stocks, at half price. Shirt, pants and
// a half-apron on the usual worn layers; the stock crate rides layer 0x1A, which
// none of these touch.
const TAILOR_DRESS = [
  { graphic: 0x1517, layer: 0x05, hue: 0x0483 }, // shirt, faded green
  { graphic: 0x1539, layer: 0x04, hue: 0x0837 }, // long pants, dark
  { graphic: 0x153B, layer: 0x16, hue: 0x0000 }, // half apron — the tailor's mark
  { graphic: 0x203B, layer: 0x0B, hue: 0x044E }, // hair
];

// The tailor's wares — ServUO's SBTailor buy list: graphic, how many held, the
// buy price in gp, and the label the client shows. Selling pays half.
const TAILOR_STOCK = [
  { graphic: 0x0F9D, amount: 100, price: 3, name: "sewing kit" },
  { graphic: 0x0F9F, amount: 50, price: 11, name: "scissors" },
  { graphic: 0x1517, amount: 50, price: 12, name: "shirt" },
  { graphic: 0x1EFD, amount: 50, price: 21, name: "fancy shirt" },
  { graphic: 0x152E, amount: 50, price: 7, name: "short pants" },
  { graphic: 0x1539, amount: 50, price: 10, name: "long pants" },
  { graphic: 0x1537, amount: 50, price: 11, name: "kilt" },
  { graphic: 0x153B, amount: 50, price: 10, name: "half apron" },
  { graphic: 0x1F03, amount: 30, price: 18, name: "robe" },
  { graphic: 0x1F7B, amount: 30, price: 13, name: "doublet" },
];

function tailor(x, y) {
  return {
    body: 0x0190, vendor: true, notoriety: 7, hits: 100,
    name: "the tailor", x, y, z: 0, equipment: TAILOR_DRESS,
  };
}

Pack.npcs["populate:britain"] = [
  banker(1427, 1684), // West Britain Bank
  banker(1650, 1608), // East Britain Bank
  tailor(1550, 1659), // Britain tailor shop (ServUO Felucca spawn centre)
];

// A vendor learns its serial only after it spawns (MobileSpawned carries it), so
// the stock waits there: index.js matches the event's (x, y) back to this table
// and calls op_stock. Key on the placement, which the event echoes unchanged.
Pack.vendorStock["1547,1659"] = TAILOR_STOCK;
