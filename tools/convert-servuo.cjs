#!/usr/bin/env node
"use strict";
// One-shot converter: ServUO's Felucca data -> OpenShard Community Pack.
//
// This is a *build tool*, not part of the shard — the engine never parses
// ServUO's formats at runtime (that is the whole point of the pack). Run it once
// against a ServUO checkout to regenerate `felucca/_generated/`, commit the
// result, and the shard loads plain pack JS like any other data file.
//
//   SERVUO=/path/to/ServUO node tools/convert-servuo.js
//
// What it reads and writes:
//   Spawns/felucca.xml (XmlSpawner)          -> felucca/_generated/spawns.js
//     grouped by region, creature *names* resolved to body ids by scraping the
//     `Body =` / `SetHits` / `Karma` out of Scripts/Mobiles/**/*.cs. Named
//     townsfolk/vendors/quest NPCs are skipped — those are placed once, not
//     spawner-maintained (the engine's own rule).
//   Data/Decoration/{Britannia,Felucca}/*.cfg -> felucca/_generated/deco.js
//     every entry carries its graphic on the type line, so classification is by
//     class *name*: doors (open = closed+1, offset from ServUO's facing table),
//     containers (gump from the seeded table below), everything else a static.
//
// Both register under the single verbs the `.admin` "Populate/Decorate Felucca"
// buttons send, so one click lays the whole facet.

const fs = require("fs");
const path = require("path");

const SERVUO = process.env.SERVUO || "/Users/youri/Git/ServUO";
const PACK = process.env.PACK || path.resolve(__dirname, "..");
const OUT = path.join(PACK, "felucca", "_generated");

const { BANKERS, DRESS, DEFAULT_DRESS, DEFAULT_BODY } = require("./vendor-data.cjs");

// ServUO's BaseEscortable subclasses, as they appear (lower-cased) in felucca.xml,
// mapped to a display name. These become escort-quest givers (see quests/escort.js
// in the pack): the converter places them and marks their tiles; the pack picks a
// random destination town and pays on arrival. Handled by convertEscorts, and
// skipped by the vendor/spawn passes so they are not also placed as plain folk.
const ESCORTABLE = {
  escortablemage: "a wandering mage",
  escortablehealer: "a wandering healer",
  seekerofadventure: "a seeker of adventure",
  noble: "a noble",
  gargishnoble: "a noble",
  peasant: "a peasant",
  merchant: "a merchant",
  messenger: "a messenger",
  bridegroom: "a wedding traveller",
};

// Every class under Scripts/Mobiles by lowercased name -> its .cs file, filled by
// scrapeCreatures. Used to find a vendor class (Mage, Armorer) and read its shop.
const CLASS_FILES = {};

const SPAWN_VERB = "populate:felucca";
const DECO_VERB = "decorate:felucca";

// ServUO's BaseDoor facing -> (dx, dy) the open leaf shifts by (BaseDoor.cs
// m_Offsets, indexed by the DoorFacing enum). The `.cfg` names the facing.
const DOOR_OFFSETS = {
  WestCW: [-1, 1], EastCCW: [1, 1], WestCCW: [-1, 0], EastCW: [1, -1],
  SouthCW: [1, 1], NorthCCW: [1, -1], SouthCCW: [0, 0], NorthCW: [0, -1],
  SouthSW: [0, 0], SouthSE: [0, 0],
};

// Container graphic -> client gump id, seeded from the graphics Britain already
// resolved (ServUO's container table). An unknown container graphic falls back
// to the plain wooden-box gump, so it still opens.
const CONTAINER_GUMPS = {
  0x09A8: 0x4B, 0x09AB: 0x4A, 0x0A2C: 0x51, 0x0A30: 0x48, 0x0A34: 0x51,
  0x0A38: 0x48, 0x0A4D: 0x4E, 0x0A4F: 0x4F, 0x0A51: 0x4E, 0x0A53: 0x4F,
  0x0A97: 0x4D, 0x0A98: 0x4D, 0x0A99: 0x4D, 0x0A9A: 0x4D, 0x0A9B: 0x4D,
  0x0A9C: 0x4D, 0x0A9D: 0x4D, 0x0A9E: 0x4D, 0x0E1C: 0x92E, 0x0E3C: 0x44,
  0x0E3D: 0x44, 0x0E3E: 0x44, 0x0E3F: 0x44, 0x0E40: 0x42, 0x0E41: 0x42,
  0x0E42: 0x49, 0x0E43: 0x49, 0x0E76: 0x3D, 0x0E77: 0x3E, 0x0E7C: 0x4A,
  0x0E7D: 0x43, 0x0E7E: 0x44, 0x0E80: 0x4B, 0x0FA6: 0x91A, 0x0FAD: 0x92E,
};
const FALLBACK_GUMP = 0x3c;

// Class names that are functional-invisible (triggers, blockers, quest hooks):
// placing their graphic as scenery would show a tile where the client shows
// nothing, so they are dropped rather than converted.
const SKIP_DECO = /teleporter|blocker|warningitem|hintitem|trap|lever|obelisk|serpentpillar/i;

const isDoor = (name) => /door|gate/i.test(name);
const isContainer = (name) =>
  /chest|crate|barrel|box|drawer|armoire|bookcase|bookshelf|keg|basket|bag|backpack|cupboard|coffer|shelf|fillable/i.test(name);

// ---------------------------------------------------------------- helpers

function walk(dir, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else fn(full);
  }
}

function num(s) {
  if (s == null) return null;
  return /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
}

function first(text, re) {
  const m = text.match(re);
  return m ? num(m[1]) : null;
}

function avg(text, re) {
  const m = text.match(re);
  return m ? Math.round((num(m[1]) + num(m[2])) / 2) : null;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "misc";
}

function hex(n) {
  return "0x" + n.toString(16).toUpperCase().padStart(4, "0");
}

// ------------------------------------------------- 1. scrape creature bodies

// A creature's body id, however its class spells it: a literal, ServUO's
// `Utility.RandomList(a, ...)` (take the first — a representative body of the
// set), a `SetBody(n)`, or the first element of an `int[]` mount table.
function resolveBody(block) {
  return (
    first(block, /Body\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*;/) ??
    first(block, /Body\s*=\s*Utility\.RandomList\(\s*(0x[0-9A-Fa-f]+|\d+)/) ??
    first(block, /SetBody\(\s*(0x[0-9A-Fa-f]+|\d+)/) ??
    first(block, /new int\[\]\s*{\s*(0x[0-9A-Fa-f]+|\d+)/)
  );
}

function scrapeCreatures() {
  const dir = path.join(SERVUO, "Scripts", "Mobiles");
  const map = {};
  walk(dir, (file) => {
    if (!file.endsWith(".cs")) return;
    const text = fs.readFileSync(file, "utf8");
    // Slice the file into per-class blocks so a file holding several creatures
    // reads each one's own body/hits, not the first class's.
    const re = /public class (\w+)\s*:/g;
    const starts = [];
    let m;
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index });
    for (let i = 0; i < starts.length; i++) {
      const block = text.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : text.length);
      const key0 = starts[i].name.toLowerCase();
      if (!CLASS_FILES[key0]) CLASS_FILES[key0] = file; // record every class, body or not
      const body = resolveBody(block);
      if (body == null) continue;
      const hits =
        avg(block, /SetHits\(\s*(\d+)\s*,\s*(\d+)\s*\)/) ||
        first(block, /SetHits\(\s*(\d+)\s*\)/) ||
        50;
      const damage = avg(block, /SetDamage\(\s*(\d+)\s*,\s*(\d+)\s*\)/) || 5;
      const karma = first(block, /Karma\s*=\s*(-?\d+)\s*;/);
      // Karma below zero is an aggressor: draw it enemy-orange (5); a peaceful
      // animal is grey (3). A rough but data-driven notoriety.
      const notoriety = karma != null && karma < 0 ? 5 : 3;
      const key = starts[i].name.toLowerCase();
      if (!map[key]) map[key] = { body, hits, damage, notoriety };
    }
  });
  return map;
}

// ------------------------------------------------------- 2. convert spawns

// Named-NPC region prefixes: placed once by the pack, never spawner-maintained.
const NPC_REGION = /vendor|towns|guild|quest|people|naturalist|veterinar/i;

function parseObjects(s) {
  // "Name:MX=1:...:OBJ=Other:MX=2:..." — the leading token and each OBJ= is a
  // creature class name; the rest are XmlSpawner flags.
  const names = [];
  s.split(":").forEach((tok, i) => {
    if (i === 0 && tok && !tok.includes("=")) names.push(tok);
    else if (tok.startsWith("OBJ=")) names.push(tok.slice(4));
  });
  return names;
}

function convertSpawns(creatures) {
  const xml = fs.readFileSync(path.join(SERVUO, "Spawns", "felucca.xml"), "utf8");
  const groups = {};
  const unresolved = {};
  let points = 0;
  let regions = 0;

  for (const block of xml.split("<Points>").slice(1)) {
    const name = (tag(block, "Name") || "").trim();
    const prefix = name.split("#")[0].trim();
    if (NPC_REGION.test(prefix)) continue;
    points++;

    const objs = tag(block, "Objects2") || "";
    const list = [];
    for (const n of parseObjects(objs)) {
      const c = creatures[n.toLowerCase()];
      if (!c) {
        unresolved[n] = (unresolved[n] || 0) + 1;
        continue;
      }
      list.push({
        body: c.body,
        hits: c.hits,
        damage: c.damage,
        notoriety: c.notoriety,
        sight: 10,
        wander: true,
      });
    }
    if (!list.length) continue;

    const region = {
      x: num(tag(block, "X")),
      y: num(tag(block, "Y")),
      width: Math.max(1, num(tag(block, "Width")) || 1),
      height: Math.max(1, num(tag(block, "Height")) || 1),
      facet: 0,
      maxCount: Math.min(12, Math.max(1, num(tag(block, "MaxCount")) || 1)),
      respawnDelay: 200, // ~10s at 20Hz — lively but not thrashing
      creatures: list,
    };
    const key = slug(prefix);
    (groups[key] = groups[key] || []).push(region);
    regions++;
  }
  return { groups, unresolved, points, regions };
}

// --------------------------------------------------------- 3. convert deco

// The Felucca town .cfg basenames. Each gets a door-generation region (the bbox
// of its own entries), so the plain wooden shop doors — implied by the map's
// static frames, not listed in the .cfg — are generated on decorate. Dungeons
// are excluded: they span the whole map, and a region that wide would have
// op_generate_doors scan millions of tiles for doors that are not there.
const TOWN_CFGS = new Set([
  "britain", "trinsic", "minoc", "vesper", "yew", "skara", "magincia",
  "moonglow", "nujelm", "jhelom", "cove", "delucia", "papua", "serpentshold",
  "wind", "bucs",
]);

function convertDeco() {
  const dirs = [
    path.join(SERVUO, "Data", "Decoration", "Britannia"),
    path.join(SERVUO, "Data", "Decoration", "Felucca"),
  ];
  const statics = [];
  const doors = [];
  const containers = [];
  const skipped = {};
  const bboxes = {}; // town basename -> {minX, minY, maxX, maxY}
  let entries = 0;

  const parseFile = (file, town, base) => {
    let type = null;
    let graphic = null;
    let facing = null;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const coord = line.match(/^(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
      if (coord && graphic != null) {
        entries++;
        const x = +coord[1];
        const y = +coord[2];
        const z = +coord[3];
        if (town) {
          const b = (bboxes[base] = bboxes[base] || { minX: x, minY: y, maxX: x, maxY: y });
          b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
          b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
        }
        if (SKIP_DECO.test(type)) {
          skipped[type] = (skipped[type] || 0) + 1;
        } else if (isDoor(type)) {
          const [dx, dy] = DOOR_OFFSETS[facing] || [0, 0];
          doors.push({ closed: graphic, open: graphic + 1, offset_x: dx, offset_y: dy, x, y, z });
        } else if (isContainer(type)) {
          containers.push({ graphic, gump: CONTAINER_GUMPS[graphic] || FALLBACK_GUMP, x, y, z });
        } else {
          statics.push({ graphic, x, y, z });
        }
        continue;
      }

      // A type line: "<ClassName> [0xGRAPHIC] [(Facing=...)]".
      const head = line.match(/^([A-Za-z]\w*)\s*(0x[0-9A-Fa-f]+)?/);
      if (head) {
        type = head[1];
        graphic = head[2] ? parseInt(head[2], 16) : null;
        const fm = line.match(/Facing=(\w+)/);
        facing = fm ? fm[1] : null;
      }
    }
  };

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    walk(dir, (file) => {
      if (!file.endsWith(".cfg")) return;
      const base = path.basename(file, ".cfg");
      parseFile(file, TOWN_CFGS.has(base), base);
    });
  }

  // The shop and street signs — a separate file, and a different format: a flat
  // table of "<facet> <graphic> <x> <y> <z> #<cliloc>" with a *decimal* graphic.
  // The text is a cliloc (a later slice); the sign art is placed now, as a static
  // on our facet (0).
  const signs = path.join(SERVUO, "Data", "signs.cfg");
  if (fs.existsSync(signs)) {
    for (const raw of fs.readFileSync(signs, "utf8").split(/\r?\n/)) {
      const m = raw.trim().match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
      if (!m) continue;
      if (+m[1] !== 0) continue; // facet 0 (Felucca) only
      entries++;
      statics.push({ graphic: +m[2], x: +m[3], y: +m[4], z: +m[5] });
    }
  }

  // A door-gen region per town, padded a couple of tiles so a frame on the very
  // edge is still scanned. A stray far-flung entry (a sign at the map edge) can
  // blow a town's bbox up to span the map; op_generate_doors scans every tile,
  // so a region past ~350k tiles (comfortably above the largest real town) is
  // dropped rather than made to sweep millions for doors that are not there.
  const MAX_DOOR_REGION = 350_000;
  const doorRegions = Object.entries(bboxes)
    .map(([, b]) => ({
      facet: 0,
      x: b.minX - 2,
      y: b.minY - 2,
      width: b.maxX - b.minX + 4,
      height: b.maxY - b.minY + 4,
    }))
    .filter((r) => r.width * r.height <= MAX_DOOR_REGION);
  return { statics, doors, containers, doorRegions, skipped, entries };
}

// -------------------------------------------------------------- 4. emit

function header(what, source, verb, button) {
  return `// Felucca — ${what}.
//
// GENERATED by tools/convert-servuo.cjs from ${source}. Do not edit by hand;
// re-run the converter. Registers under "${verb}", the verb the .admin
// "${button} Felucca" button sends.

globalThis.Pack = globalThis.Pack || { spawnSets: {}, npcs: {}, decoSets: {}, doorRegions: {} };
`;
}

function emitSpawns(groups) {
  const regions = [];
  for (const key of Object.keys(groups).sort()) {
    regions.push(`  // ${key}`);
    for (const r of groups[key]) regions.push("  " + JSON.stringify(r) + ",");
  }
  const body =
    header("creature spawns", "Spawns/felucca.xml", SPAWN_VERB, "Populate") +
    `\nPack.spawnSets["${SPAWN_VERB}"] = (Pack.spawnSets["${SPAWN_VERB}"] || []).concat([\n` +
    regions.join("\n") +
    `\n]);\n`;
  fs.writeFileSync(path.join(OUT, "spawns.js"), body);
}

function emitDeco(deco) {
  const fmtStatic = (s) => `{ graphic: ${hex(s.graphic)}, x: ${s.x}, y: ${s.y}, z: ${s.z} }`;
  const fmtDoor = (d) =>
    `{ closed: ${hex(d.closed)}, open: ${hex(d.open)}, offset_x: ${d.offset_x}, offset_y: ${d.offset_y}, x: ${d.x}, y: ${d.y}, z: ${d.z} }`;
  const fmtCont = (c) => `{ graphic: ${hex(c.graphic)}, gump: ${hex(c.gump)}, x: ${c.x}, y: ${c.y}, z: ${c.z} }`;

  const fmtRegion = (r) =>
    `{ facet: 0, x: ${r.x}, y: ${r.y}, width: ${r.width}, height: ${r.height} }`;

  const body =
    header("decoration", "Data/Decoration/**.cfg + Data/signs.cfg", DECO_VERB, "Decorate") +
    `\nPack.decoSets["${DECO_VERB}"] = {\n` +
    `  facet: 0,\n` +
    `  statics: [\n    ${deco.statics.map(fmtStatic).join(",\n    ")}\n  ],\n` +
    `  doors: [\n    ${deco.doors.map(fmtDoor).join(",\n    ")}\n  ],\n` +
    `  containers: [\n    ${deco.containers.map(fmtCont).join(",\n    ")}\n  ],\n` +
    `};\n\n` +
    // The plain wooden shop doors the town static frames only imply: the engine
    // scans each region and drops a functional door into every gap (ServUO's
    // DoorGenerator). One region per town.
    `Pack.doorRegions["${DECO_VERB}"] = [\n  ${deco.doorRegions.map(fmtRegion).join(",\n  ")}\n];\n`;
  fs.writeFileSync(path.join(OUT, "deco.js"), body);
}

// --------------------------------------------------- 5. convert town vendors

// The 64 Magery spells in client order — the scroll names the mage's shop needs
// (ServUO's SBMage builds them in a loop the literal-Add scrape can't see).
const MAGERY_SPELLS = [
  "Clumsy", "Create Food", "Feeblemind", "Heal", "Magic Arrow", "Night Sight", "Reactive Armor", "Weaken",
  "Agility", "Cunning", "Cure", "Harm", "Magic Trap", "Magic Untrap", "Protection", "Strength",
  "Bless", "Fireball", "Magic Lock", "Poison", "Telekinesis", "Teleport", "Unlock", "Wall of Stone",
  "Arch Cure", "Arch Protection", "Curse", "Fire Field", "Greater Heal", "Lightning", "Mana Drain", "Recall",
];

// "LesserHealPotion" -> "lesser heal potion" — a readable label from the type.
function label(type) {
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// The base (pre-AoS) SB buy lists a vendor class aggregates, read from its
// InitSBInfo. Expansion lists (SBSE*, SBSA*, and the AoS trades) are left out, as
// are commented-out and duplicate adds.
function baseSbClasses(profession) {
  let file = CLASS_FILES[profession];
  if (!file && profession.endsWith("guildmaster")) {
    file = CLASS_FILES[profession.slice(0, -"guildmaster".length)];
  }
  if (!file) return [];
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, ""); // line comments
  const at = text.indexOf("InitSBInfo");
  if (at < 0) return [];
  const body = text.slice(at, at + 3000);
  const out = [];
  const re = /new (SB\w+)\(\)/g;
  let m;
  while ((m = re.exec(body))) {
    const n = m[1];
    if (/^SBS[EA]|Holy|Keeper|Mystic|Necromancer|Monk|PlayerBarkeeper/.test(n)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// A ServUO SB buy list -> our stock rows, straight from its literal
// GenericBuyInfo(typeof(X), price, amount, itemID, ...) adds (the optional leading
// cliloc string is ignored). SBMage's scroll loop is regenerated by hand.
function scrapeSbList(sbName) {
  const file = path.join(SERVUO, "Scripts", "VendorInfo", sbName + ".cs");
  if (!fs.existsSync(file)) return [];
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
    // Drop expansion-gated adds — this is a pre-AoS (era 1) shard, so the AoS/SE/
    // ML/SA reagents, necromancer books and the like ServUO hides behind
    // `if (Core.AOS)` do not belong. Both the braced block and the bare one-liner.
    .replace(/if\s*\(\s*Core\.\w+[^)]*\)\s*\{[^{}]*\}/g, "")
    .replace(/if\s*\(\s*Core\.\w+[^)]*\)\s*Add\([^;]*\);/g, "");
  const items = [];
  const re = /GenericBuyInfo\(\s*(?:"[^"]*"\s*,\s*)?typeof\(([\w.]+)\)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    items.push({ graphic: num(m[4]), price: +m[2], amount: +m[3], name: label(m[1].split(".").pop()) });
  }
  if (sbName === "SBMage") {
    // ServUO SBMage: circles 1–3 (24 scrolls), itemID 0x1F2E+i with the i==6 /
    // i>6 fixup, price 12 + (i/8)*10, amount 20.
    for (let i = 0; i < 24; i++) {
      let id = 0x1f2e + i;
      if (i === 6) id = 0x1f2d;
      else if (i > 6) id -= 1;
      items.push({ graphic: id, price: 12 + Math.floor(i / 8) * 10, amount: 20, name: `${MAGERY_SPELLS[i]} scroll` });
    }
  }
  return items;
}

const shopCache = {};
function scrapeShop(profession) {
  if (shopCache[profession]) return shopCache[profession];
  const items = [];
  const seen = new Set();
  for (const sb of baseSbClasses(profession)) {
    for (const it of scrapeSbList(sb)) {
      if (seen.has(it.graphic)) continue;
      seen.add(it.graphic);
      items.push(it);
    }
  }
  return (shopCache[profession] = items);
}

function niceName(profession) {
  return "the " + profession.replace(/guildmaster$/, " guildmaster");
}

function convertVendors(creatures) {
  const xml = fs.readFileSync(path.join(SERVUO, "Spawns", "felucca.xml"), "utf8");
  const npcs = [];
  const stock = {};
  const unknown = {};

  // Town NPCs are keyed off the *object*, not the region name: a profession is
  // lower-case (armorer, banker, minter), a creature/animal is capitalised — so a
  // profession is placed wherever it stands, whatever the region is called (this
  // catches bankers in oddly-named regions like "banker/minter", the West Britain
  // bank). A banker opens the box; anything ServUO gives a shop becomes a vendor
  // with *ServUO's* stock; a trade with a class but no shop just stands named.
  for (const block of xml.split("<Points>").slice(1)) {
    const cx = num(tag(block, "CentreX")) ?? num(tag(block, "X"));
    const cy = num(tag(block, "CentreY")) ?? num(tag(block, "Y"));
    if (cx == null || cy == null) continue;

    let k = 0;
    for (const name of parseObjects(tag(block, "Objects2") || "")) {
      if (name[0] !== name[0].toLowerCase()) continue; // capitalised → a creature
      const prof = name.toLowerCase();
      if (creatures[prof]) continue; // a lower-case monster (troll, lizardman): the spawn pass owns it
      if (ESCORTABLE[prof]) continue; // an escortable: the escort pass owns it

      const banker = BANKERS.has(prof);
      const shop = banker ? [] : scrapeShop(prof);
      const hasClass = !!(CLASS_FILES[prof] || CLASS_FILES[prof.replace(/guildmaster$/, "")]);
      if (!banker && !shop.length && !hasClass) {
        unknown[name] = (unknown[name] || 0) + 1;
        continue;
      }

      // Spread several NPCs in one region along a row so they do not stack on the
      // one centre tile (nudge later if any lands in a wall).
      const x = cx + k;
      const y = cy;
      k++;
      const npc = {
        body: DEFAULT_BODY,
        notoriety: 7, // invulnerable — townsfolk are not loot
        hits: 100,
        name: niceName(prof),
        x,
        y,
        z: 0,
        equipment: DRESS[prof] || DEFAULT_DRESS,
      };
      if (banker) npc.banker = true;
      else if (shop.length) {
        npc.vendor = true;
        stock[`${x},${y}`] = shop;
      }
      npcs.push(npc);
    }
  }
  return { npcs, stock, unknown };
}

function emitVendors(v) {
  const npcLines = v.npcs.map((n) => "  " + JSON.stringify(n) + ",").join("\n");
  const stockLines = Object.entries(v.stock)
    .map(([k, s]) => `Pack.vendorStock[${JSON.stringify(k)}] = ${JSON.stringify(s)};`)
    .join("\n");
  const body =
    header("town vendors & folk", "Spawns/felucca.xml + ServUO SB*.cs shop lists", SPAWN_VERB, "Populate") +
    `Pack.vendorStock = Pack.vendorStock || {};\n\n` +
    `Pack.npcs["${SPAWN_VERB}"] = (Pack.npcs["${SPAWN_VERB}"] || []).concat([\n${npcLines}\n]);\n\n` +
    stockLines +
    "\n";
  fs.writeFileSync(path.join(OUT, "vendors.js"), body);
}

// ------------------------------------------------ 6. convert escort givers

// A robe and hair for a wandering escortable.
const ESCORT_DRESS = [
  { graphic: 0x1f03, layer: 0x16, hue: 0x0384 },
  { graphic: 0x203b, layer: 0x0b, hue: 0x0455 },
];

function convertEscorts() {
  const xml = fs.readFileSync(path.join(SERVUO, "Spawns", "felucca.xml"), "utf8");
  const npcs = [];
  const tiles = {};
  for (const block of xml.split("<Points>").slice(1)) {
    const cx = num(tag(block, "CentreX")) ?? num(tag(block, "X"));
    const cy = num(tag(block, "CentreY")) ?? num(tag(block, "Y"));
    if (cx == null || cy == null) continue;
    let k = 0;
    for (const name of parseObjects(tag(block, "Objects2") || "")) {
      const disp = ESCORTABLE[name.toLowerCase()];
      if (!disp) continue;
      const x = cx + k;
      const y = cy;
      k++;
      npcs.push({
        body: 0x0190,
        notoriety: 1, // innocent (blue) — an escortable can be attacked, unlike a vendor
        hits: 60,
        name: disp,
        x,
        y,
        z: 0,
        equipment: ESCORT_DRESS,
      });
      // No fixed destination — the pack picks a random town on accept, ServUO's
      // way; the reward is ServUO's Gold(500, 1000).
      tiles[`${x},${y}`] = { reward: [500, 1000] };
    }
  }
  return { npcs, tiles };
}

function emitEscorts(e) {
  const npcLines = e.npcs.map((n) => "  " + JSON.stringify(n) + ",").join("\n");
  const tileLines = Object.entries(e.tiles)
    .map(([k, cfg]) => `Pack.escorts[${JSON.stringify(k)}] = ${JSON.stringify(cfg)};`)
    .join("\n");
  const body =
    header("escort givers", "Spawns/felucca.xml (BaseEscortable spawns)", SPAWN_VERB, "Populate") +
    `Pack.escorts = Pack.escorts || {};\n\n` +
    `Pack.npcs["${SPAWN_VERB}"] = (Pack.npcs["${SPAWN_VERB}"] || []).concat([\n${npcLines}\n]);\n\n` +
    tileLines +
    "\n";
  fs.writeFileSync(path.join(OUT, "escorts.js"), body);
}

// -------------------------------------------------------------- main

function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log("Scraping creature bodies from Scripts/Mobiles ...");
  const creatures = scrapeCreatures();
  console.log(`  ${Object.keys(creatures).length} creature classes resolved to a body`);

  console.log("Converting spawns from felucca.xml ...");
  const spawns = convertSpawns(creatures);
  emitSpawns(spawns.groups);
  console.log(
    `  ${spawns.regions} regions from ${spawns.points} monster points, ` +
      `in ${Object.keys(spawns.groups).length} groups`
  );
  const unresolvedCount = Object.keys(spawns.unresolved).length;
  if (unresolvedCount) {
    console.log(`  ${unresolvedCount} unresolved creature names (skipped), top: ${topN(spawns.unresolved, 12)}`);
  }

  console.log("Converting decoration from Data/Decoration ...");
  const deco = convertDeco();
  emitDeco(deco);
  console.log(
    `  ${deco.entries} entries -> ${deco.statics.length} statics, ` +
      `${deco.doors.length} doors, ${deco.containers.length} containers`
  );
  const skippedCount = Object.values(deco.skipped).reduce((a, b) => a + b, 0);
  if (skippedCount) {
    console.log(`  ${skippedCount} functional-invisible entries skipped, top: ${topN(deco.skipped, 8)}`);
  }
  console.log(`  ${deco.doorRegions.length} town door-gen regions`);

  console.log("Converting town vendors from felucca.xml ...");
  const vendors = convertVendors(creatures);
  emitVendors(vendors);
  const shops = Object.keys(vendors.stock).length;
  console.log(`  ${vendors.npcs.length} town NPCs placed (${shops} with a shop)`);
  const unknownCount = Object.keys(vendors.unknown).length;
  if (unknownCount) {
    console.log(`  ${unknownCount} town types with no curated data (skipped), top: ${topN(vendors.unknown, 10)}`);
  }

  console.log("Converting escort givers from felucca.xml ...");
  const escorts = convertEscorts();
  emitEscorts(escorts);
  console.log(`  ${escorts.npcs.length} escortables placed as escort-quest givers`);

  console.log(`\nWrote ${path.relative(PACK, OUT)}/{spawns,deco,vendors,escorts}.js`);
}

main();
