"use strict";
// Presentation for the generated town NPCs (tools/convert-servuo.cjs requires it).
//
// Their SHOP STOCK is NOT here — it is scraped straight from ServUO's SB*.cs buy
// lists at convert time, so every price, amount and item is ServUO's, not a
// guess. This file only says who opens a bank (rather than a shop) and how each
// trade dresses; the converter derives "vendor vs plain townsperson" from whether
// ServUO gives the trade a shop.

// A robe and hair — a covered townsperson. `hue` tints the robe.
const ROBE = (hue) => [
  { graphic: 0x1f03, layer: 0x16, hue }, // full robe
  { graphic: 0x203b, layer: 0x0b, hue: 0x0455 }, // short hair, dark brown
];

// Bank NPCs — no shop; saying "bank" nearby opens the box. (ServUO's banker also
// sells employment contracts; a shard's banker is the bank teller, so that little
// shop is dropped.)
const BANKERS = new Set(["banker", "minter"]);

// A dress hue per trade where one reads nicely; every other trade wears the
// default slate robe.
const DEFAULT_DRESS = ROBE(0x0396);
const DRESS = {
  mage: ROBE(0x0499), mageguildmaster: ROBE(0x0499), scribe: ROBE(0x0499),
  tailor: ROBE(0x0483), tailorguildmaster: ROBE(0x0483), weaver: ROBE(0x0489), baker: ROBE(0x0483),
  alchemist: ROBE(0x0021), healer: ROBE(0x0481), healerguildmaster: ROBE(0x0481), herbalist: ROBE(0x0021),
  armorer: ROBE(0x0455), weaponsmith: ROBE(0x0455), blacksmith: ROBE(0x0455),
  bowyer: ROBE(0x0489), carpenter: ROBE(0x07d1), tinker: ROBE(0x07d1),
  provisioner: ROBE(0x0837), tavernkeeper: ROBE(0x0837), innkeeper: ROBE(0x0837),
  butcher: ROBE(0x0021), cobbler: ROBE(0x0837), fisherman: ROBE(0x0837),
};

// The human male body a town NPC stands in (ServUO's BaseVendor randomises a
// human at runtime; a fixed male body is a deterministic stand-in).
const DEFAULT_BODY = 0x0190;

module.exports = { BANKERS, DRESS, DEFAULT_DRESS, DEFAULT_BODY };
