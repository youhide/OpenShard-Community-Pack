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
//   Data/Regions.xml (the Felucca facet)     -> felucca/_generated/regions.js
//     towns, dungeons and guarded zones: rectangles, music, and the flags the
//     engine reads (guarded, no-teleport). ServUO nests regions; the nesting is
//     flattened here by raising the child's priority, so the engine holds a flat
//     list and a number rather than a tree.
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
// scrapeCreatures. Used to find a vendor class (Mage, Armorer) and read its shop
// and its outfit.
//
// The *path* matters, not just the presence: ServUO keeps town NPCs in
// Scripts/Mobiles/NPCs and creatures in Normal/Named/etc. Accepting any class with
// a file is how `the firesteed`, `the nightmare` and a dozen other monsters ended up
// standing in Britannia in a robe as body 400 — they are lower-case in the spawn XML
// and their body does not resolve, so both of the old filters missed them.
const CLASS_FILES = {};

// A town NPC's class lives here. Anything else under Scripts/Mobiles is a creature.
const NPC_CLASS_DIR = path.join("Scripts", "Mobiles", "NPCs");

function isTownClass(profession) {
  const file =
    CLASS_FILES[profession] ||
    CLASS_FILES[profession.replace(/guildmaster$/, "")];
  return !!file && file.includes(NPC_CLASS_DIR);
}

// Every item class under Scripts/Items by lowercased name -> its graphic, filled by
// scrapeItemGraphics. This is what turns a vendor class's `AddItem(new FullApron())`
// into a graphic the engine can equip.
const ITEM_GRAPHICS = {};

function scrapeItemGraphics() {
  const dir = path.join(SERVUO, "Scripts", "Items");
  walk(dir, (file) => {
    if (!file.endsWith(".cs")) return;
    const text = fs.readFileSync(file, "utf8");
    const re = /public class (\w+)\s*:/g;
    const starts = [];
    let m;
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index });
    for (let i = 0; i < starts.length; i++) {
      const block = text.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : text.length);
      const key = starts[i].name.toLowerCase();
      if (ITEM_GRAPHICS[key] != null) continue;
      // `: base(0x1EFD, hue)` — the graphic a constructor hands its base class.
      const g = /:\s*base\(\s*(0x[0-9A-Fa-f]+)/.exec(block);
      if (g) ITEM_GRAPHICS[key] = parseInt(g[1], 16);
    }
  });
}

// The layer a worn graphic belongs on. ServUO reads it from tiledata's Quality
// byte, which this engine's tiledata reader drops — so it is a table here, keyed by
// the item class, exactly like the weapon and armour tables are keyed by graphic in
// the engine. Only the classes ServUO's own InitOutfit overrides actually use.
const OUTFIT_LAYERS = {
  // 0x01 one-handed, 0x02 two-handed
  smithhammer: 0x01, tongs: 0x01, sledgehammer: 0x01, hammer: 0x01,
  shepherdscrook: 0x02, gnarledstaff: 0x02, quarterstaff: 0x02, club: 0x01,
  butcherknife: 0x01, cleaver: 0x01, dagger: 0x01, skinningknife: 0x01,
  hatchet: 0x01, pickaxe: 0x01, shovel: 0x02, pitchfork: 0x02, hoe: 0x02,
  fishingpole: 0x02, harp: 0x02, lute: 0x02, lapharp: 0x02, drums: 0x02,
  tambourine: 0x02, spellbook: 0x01, torch: 0x01, lantern: 0x01,
  bow: 0x02, crossbow: 0x02, halberd: 0x02, bardiche: 0x02, longsword: 0x01,
  broadsword: 0x01, katana: 0x01, scimitar: 0x01, vikingsword: 0x01,
  warhammer: 0x02, mace: 0x01, warmace: 0x02, spear: 0x02, shortspear: 0x01,
  woodenshield: 0x02, metalshield: 0x02, bronzeshield: 0x02, heatershield: 0x02,
  // 0x05 shirt, 0x06 helm, 0x07 gloves, 0x0A neck, 0x0C waist
  shirt: 0x05, fancyshirt: 0x05,
  bascinet: 0x06, closehelm: 0x06, norsehelm: 0x06, helmet: 0x06, platehelm: 0x06,
  cap: 0x06, feetheredhat: 0x06, featheredhat: 0x06, floppyhat: 0x06, widebrimhat: 0x06,
  strawhat: 0x06, tallstrawhat: 0x06, wizardshat: 0x06, jesterhat: 0x06, bonnet: 0x06,
  bandana: 0x06, skullcap: 0x06, tricorne: 0x06, hat: 0x06,
  leathergloves: 0x07, plategloves: 0x07, ringmailgloves: 0x07, studdedgloves: 0x07,
  bonegloves: 0x07, chainmailgloves: 0x07,
  leathergorget: 0x0a, plategorget: 0x0a, studdedgorget: 0x0a, bonehelm: 0x06,
  halfapron: 0x0c, bodysash: 0x0c,
  // 0x0D inner torso (mail), 0x11 middle torso, 0x13 arms, 0x14 cloak
  ringmailchest: 0x0d, chainchest: 0x0d, platechest: 0x0d, leatherchest: 0x0d,
  studdedchest: 0x0d, bonechest: 0x0d, femaleplatechest: 0x0d, femaleleatherchest: 0x0d,
  doublet: 0x11, fullapron: 0x11, tunic: 0x11, surcoat: 0x11, jestersuit: 0x11,
  leatherarms: 0x13, platearms: 0x13, studdedarms: 0x13, ringmailarms: 0x13,
  chainmailarms: 0x13, bonearms: 0x13,
  cloak: 0x14,
  // 0x16 outer torso, 0x17 outer legs, 0x18 inner legs, 0x04 pants
  robe: 0x16, deathrobe: 0x16, plaindress: 0x16, fancydress: 0x16,
  kilt: 0x17, skirt: 0x17,
  leatherlegs: 0x18, platelegs: 0x18, studdedlegs: 0x18, ringmaillegs: 0x18,
  chainlegs: 0x18, bonelegs: 0x18, leathershorts: 0x18, leatherskirt: 0x17,
  longpants: 0x04, shortpants: 0x04,
  // 0x03 shoes
  shoes: 0x03, boots: 0x03, sandals: 0x03, thighboots: 0x03,
};

const SPAWN_VERB = "populate:felucca";
const DECO_VERB = "decorate:felucca";
const REGION_VERB = "regions:felucca";

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

// Somewhere a townsperson can plausibly spend the night: the chairs, benches,
// stools, thrones and beds ServUO's own decoration data places inside Britannia's
// buildings. There are well over a thousand of them across the two facets — more
// than there are townsfolk — and every one is indoors, in a real room, on a floor.
// See `assignNightHomes` for why that matters.
const isSeat = (name) => /chair|bench|stool|throne|bed/i.test(name);

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
    first(block, /new int\[\]\s*{\s*(0x[0-9A-Fa-f]+|\d+)/) ??
    // A `BaseVendor` (and so a `BaseHealer`, a `BaseEscortable`, a guildmaster) never
    // writes a body: `BaseVendor.InitBody` rolls a human at runtime. Capitalised ones
    // sit on spawners — 179 `WanderingHealer` points alone — and were dropped for
    // having nothing to read. A human male is the deterministic stand-in the vendor
    // pass already uses.
    humanBody(block) ??
    // `BaseMount`'s constructor takes the body positionally, after the name:
    // `base("a ridable llama", 0xDC, 0x3EA6, AIType.AI_Animal, ...)`. Nothing else
    // in the class says 0xDC, which is why every ridable mount — llamas, ostards —
    // fell out of the spawns entirely.
    first(block, /:\s*base\(\s*(?:"[^"]*"|\w+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)\s*,\s*(?:0x[0-9A-Fa-f]+|\d+)\s*,\s*AIType/)
  );
}

/// The human body a `BaseVendor`-family class comes out as, or null for anything else.
function humanBody(block) {
  return /public class \w+\s*:\s*(?:BaseVendor|BaseHealer|BaseEscortable|BaseGuildmaster|BaseHire)\b/.test(
    block
  )
    ? 0x0190
    : null;
}

function scrapeCreatures() {
  // All of `Scripts`, not just `Scripts/Mobiles`: the seasonal-event and revamped-
  // dungeon creatures live under `Scripts/Services`, so `ShadowFiend` and its
  // neighbours were unresolvable for no reason other than where their file sits.
  const dir = path.join(SERVUO, "Scripts");
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
      // Its own fame, which a killer inherits — ServUO's `BaseCreature.OnDeath` hands
      // `Titles.AwardFame(killer, Fame)`. Without it every kill in Britannia was worth
      // nothing and no character could earn a title.
      const fame = first(block, /Fame\s*=\s*(\d+)\s*;/) ?? 0;
      // Karma below zero is an aggressor: draw it enemy-orange (5); a peaceful
      // animal is grey (3). A rough but data-driven notoriety.
      const notoriety = karma != null && karma < 0 ? 5 : 3;
      const key = starts[i].name.toLowerCase();
      if (!map[key])
        map[key] = { body, hits, damage, notoriety, fame, karma: karma ?? 0 };
    }
  });
  return map;
}

// ------------------------------------------------------- 2. convert spawns

// XmlSpawner sub-tier tokens, not creature classes: a `TreasureLevel3` in an
// `<Objects2>` list names which tier of loot the *spawner* rolls, and there is no
// mobile to make. They were the loudest names in the unresolved report and the only
// ones in it that were never a conversion failure.
const NOT_A_CREATURE = /^treasurelevel\d*$/i;

// A `BaseCamp` has no body of its own — it is a multi that lays out tents and then
// `AddMobile`s its occupants — so the spawn pass could not resolve one and its
// creatures went with it. Read from each camp's `AddMobile(new X(), ...)` calls under
// `Scripts/Multis/Camps`, so a camp spawn point becomes its garrison.
const CAMP_CREATURES = {};

function scrapeCamps() {
  const dir = path.join(SERVUO, "Scripts", "Multis", "Camps");
  if (!fs.existsSync(dir)) return;
  walk(dir, (file) => {
    if (!file.endsWith(".cs")) return;
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const m of text.matchAll(/public class (\w+)\s*:\s*BaseCamp/g)) {
      const key = m[1].toLowerCase();
      const block = text.slice(m.index);
      const members = new Set();
      // `AddMobile(new Orc(), ...)` names one directly; `AddMobile(Orcs, ...)` names a
      // local whose factory returns one, so the `return new Orc();` above it counts too.
      for (const a of block.matchAll(/AddMobile\(\s*new (\w+)\(/g)) members.add(a[1].toLowerCase());
      for (const a of block.matchAll(/return new (\w+)\(\s*\)\s*;/g)) members.add(a[1].toLowerCase());
      if (members.size) CAMP_CREATURES[key] = [...members];
    }
  });
}

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
      const key = n.toLowerCase();
      // Not a mobile at all, and never was: an XmlSpawner loot tier.
      if (NOT_A_CREATURE.test(key)) continue;
      // Owned by another pass, not a failure here: a town trade is placed once by the
      // vendor pass and an escortable by the escort pass. Reporting them as
      // "unresolved creatures" made the report read as though a third of Britannia had
      // been dropped, when what had happened is that a townsperson is not a monster.
      if (isTownClass(key) || ESCORTABLE[key]) continue;
      // A camp is a meta-spawner: no body of its own, and its creatures are lost with
      // it unless it is expanded into them.
      const camp = CAMP_CREATURES[key];
      if (camp) {
        for (const member of camp) {
          const c = creatures[member];
          if (c) list.push({ ...c, sight: 10, wander: true });
        }
        if (!camp.some((member) => creatures[member])) {
          unresolved[n] = (unresolved[n] || 0) + 1;
        }
        continue;
      }
      const c = creatures[key];
      if (!c) {
        unresolved[n] = (unresolved[n] || 0) + 1;
        continue;
      }
      // Spread rather than enumerate: the scrape grew `fame` and `karma` and a list of
      // named fields silently dropped them, so every kill in Britannia was worth
      // nothing and no character could earn a title.
      list.push({ ...c, sight: 10, wander: true });
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
  const seats = [];
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
          // A seat is still a static — it is drawn like any other. It is only
          // *also* noted, as a candidate night home.
          if (isSeat(type)) seats.push({ x, y, z });
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
  return { statics, doors, containers, seats, doorRegions, skipped, entries };
}

// -------------------------------------------------------------- 4. emit

function header(what, source, verb, button) {
  // A file registered at load time rather than behind an .admin button (the speech
  // and name tables) has no verb, and saying it does would send whoever reads it
  // looking for a button that is not there.
  const when = verb
    ? `Registers under "${verb}", the verb the .admin\n// "${button} Felucca" button sends.`
    : `Registered at pack load time, not behind an .admin button.`;
  return `// Felucca — ${what}.
//
// GENERATED by tools/convert-servuo.cjs from ${source}. Do not edit by hand;
// re-run the converter. ${when}

globalThis.Pack = globalThis.Pack || {};
Pack.spawnSets = Pack.spawnSets || {};
Pack.npcs = Pack.npcs || {};
Pack.decoSets = Pack.decoSets || {};
Pack.doorRegions = Pack.doorRegions || {};
Pack.regionSets = Pack.regionSets || {};
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

// ShoeType's wire byte, matching the engine's `npc::dress::ShoeType`.
const SHOE_BITS = { none: 0, shoes: 1, boots: 2, sandals: 3, thighboots: 4 };

// What a trade adds to the base outfit, and what it wears on its feet — read from
// the trade's own class in Scripts/Mobiles/NPCs.
//
// This is the half of appearance that is *data*: ServUO's BaseVendor.InitOutfit
// rolls a shirt, trousers and hair for every vendor (the engine does that now, in
// npc::dress), and 248 vendor classes override it to add their own — the smith's
// apron and bascinet, the mage's blue robe, the ranger's thigh boots. Those
// overrides are the only thing that makes a street of shopkeepers legible, and they
// are read here rather than invented.
const outfitCache = {};
function scrapeOutfit(profession) {
  if (outfitCache[profession]) return outfitCache[profession];
  const blank = { extras: [], shoe: SHOE_BITS.shoes };
  let file = CLASS_FILES[profession] || CLASS_FILES[profession.replace(/guildmaster$/, "")];
  if (!file) return (outfitCache[profession] = blank);

  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // The footwear the trade declares. A class that rolls between two (the Mage)
  // takes the first, since the engine's roll is per-NPC anyway and a fixed choice
  // here would be the one thing the shard could not vary.
  let shoe = SHOE_BITS.shoes;
  const shoeDecl = /ShoeType[\s\S]{0,200}?VendorShoeType\.(\w+)/.exec(text);
  if (shoeDecl) {
    const bits = SHOE_BITS[shoeDecl[1].toLowerCase()];
    if (bits != null) shoe = bits;
  }

  // The InitOutfit override's own additions. Only classes that resolve to both a
  // graphic and a layer are kept — anything else would be an item on layer zero,
  // which the client draws nowhere.
  //
  // ServUO writes *alternatives* two ways, and both matter because taking both halves
  // puts a smith in ringmail AND an apron, which no ServUO smith ever wears:
  //
  //   AddItem(RandomBool() ? new QuarterStaff() : (Item)new ShepherdsCrook());
  //   Item item = (RandomBool() ? null : new RingmailChest());  ... if (item == null)
  //       AddItem(new FullApron());
  //
  // The first is a plain ternary between two items; the second is the Blacksmith's,
  // where `null` means "wear the next thing instead". Both come back as a pair, and
  // the caller picks one *per NPC* — which it can, because equipment is emitted per
  // NPC and not per trade.
  const extras = [];
  const alternates = [];
  const at = text.indexOf("InitOutfit");
  if (at >= 0) {
    let body = text.slice(at, at + 2500);
    const NEW = "new (?:Server\\.Items\\.)?(\\w+)\\(([^)]*)\\)";
    const item = (name, args) => {
      const key = (name || "").toLowerCase();
      const layer = OUTFIT_LAYERS[key];
      const graphic = ITEM_GRAPHICS[key];
      if (layer == null || graphic == null) return null;
      // A literal hue in the constructor is kept; a `Utility.Random*Hue()` is left to
      // the engine's own roll, which is the same table and varies per NPC.
      const literal = /^\s*(0x[0-9A-Fa-f]+|\d+)\s*$/.exec(args || "");
      return { graphic, layer, hue: literal ? num(literal[1]) : 0 };
    };
    // Blank a matched span so the plain pass below does not claim it a second time.
    const consume = (m) => {
      body = body.slice(0, m.index) + " ".repeat(m[0].length) + body.slice(m.index + m[0].length);
    };
    // Two alternatives usually sit on the *same* layer — two staves, two hats — and
    // only the Blacksmith's null-shape pairs across layers. An earlier version
    // required them to differ, which threw away every ordinary either/or and kept
    // whichever half came first.
    const pair = (a, b) => {
      if (a && b) alternates.push([a, b]);
      else if (a) extras.push(a);
      else if (b) extras.push(b);
    };

    // Shape one, the plain ternary: `RandomBool() ? new QuarterStaff() : (Item)new
    // ShepherdsCrook()`. Two items, wear one.
    for (const m of [...body.matchAll(new RegExp(`\\?\\s*${NEW}\\s*:\\s*(?:\\(Item\\))?\\s*${NEW}`, "g"))]) {
      pair(item(m[1], m[2]), item(m[3], m[4]));
      consume(m);
    }
    // Shape two, the Blacksmith's: `RandomBool() ? null : new RingmailChest()`, where
    // the `null` branch means "wear the thing the next guarded AddItem names instead".
    // Narrow on purpose — it is one idiom in one place, and reading it as two separate
    // items is what put a smith in ringmail *and* an apron, which no ServUO smith is.
    for (const m of [...body.matchAll(new RegExp(`\\?\\s*(?:null\\s*:\\s*${NEW}|${NEW}\\s*:\\s*null)`, "g"))]) {
      const first = item(m[1] || m[3], m[2] || m[4]);
      consume(m);
      const next = new RegExp(`AddItem\\(\\s*${NEW}`).exec(body.slice(m.index));
      if (next) {
        pair(first, item(next[1], next[2]));
        // Blank the substitute too, at its real offset in the body.
        consume({ index: m.index + next.index, 0: next[0] });
      } else if (first) {
        extras.push(first);
      }
    }
    // Everything left is worn outright.
    const seen = new Set(extras.concat(...alternates).map((it) => it.layer));
    for (const m of [...body.matchAll(new RegExp(NEW, "g"))]) {
      const made = item(m[1], m[2]);
      if (!made || seen.has(made.layer)) continue;
      seen.add(made.layer);
      extras.push(made);
    }
  }
  return (outfitCache[profession] = { extras, alternates, shoe });
}

// ServUO's personal-name lists (Data/names.xml). The engine ships a spread of them
// as its default; the pack registers the whole thing so a full Felucca of 738
// townsfolk does not repeat.
function scrapeNames() {
  const file = path.join(SERVUO, "Data", "names.xml");
  if (!fs.existsSync(file)) return { male: [], female: [] };
  const xml = fs.readFileSync(file, "utf8");
  const list = (type) => {
    const m = new RegExp(`<namelist type="${type}">([\\s\\S]*?)</namelist>`).exec(xml);
    if (!m) return [];
    return m[1]
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.includes(" "));
  };
  return { male: list("male"), female: list("female") };
}

function convertVendors(creatures, takenTiles) {
  const xml = fs.readFileSync(path.join(SERVUO, "Spawns", "felucca.xml"), "utf8");
  const npcs = [];
  const stock = {};
  const unknown = {};
  const professions = new Set();
  // How many of each trade have been placed, so an either/or in its outfit alternates
  // down the row instead of every one of them making the same choice.
  const placedOf = {};

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
      // Case is the split, and it is about *placement* rather than about the class: a
      // lower-case token stands in a Vendors/TownsPeople region and is placed once, a
      // capitalised one sits on a spawner and is maintained. `WanderingHealer` is a
      // `BaseVendor` written capitalised, and it belongs to the spawn pass for that
      // reason — in ServUO it respawns when killed, so placing 179 invulnerable ones
      // permanently is not the same creature.
      if (name[0] !== name[0].toLowerCase()) continue;
      const prof = name.toLowerCase();
      // A lower-case monster (troll, lizardman) belongs to the spawn pass. But every
      // town class resolves to a body now too, since `BaseVendor.InitBody` is read
      // rather than dropped — so "has a body" no longer means "is a monster", and the
      // test has to say which it is. Without the second half this skipped all 710
      // townsfolk and left twenty-one.
      if (creatures[prof] && !isTownClass(prof)) continue;
      if (ESCORTABLE[prof]) continue; // an escortable: the escort pass owns it

      const banker = BANKERS.has(prof);
      const shop = banker ? [] : scrapeShop(prof);
      // A town NPC's class lives in Scripts/Mobiles/NPCs. Anything else with a class
      // file is a creature whose body simply failed to resolve — and accepting those
      // is how `the firesteed`, `the nightmare` and `the insanedryad` came to stand in
      // Britannia in a robe as body 400.
      if (!banker && !isTownClass(prof)) {
        unknown[name] = (unknown[name] || 0) + 1;
        continue;
      }

      // One NPC per tile, across the whole facet and across passes. Spreading only
      // *within* a region left 87 vendors sharing a tile with another, and since the
      // stock table is keyed by tile and consumed on the first match, the second of
      // each pair silently ended up with an empty shop. Five tiles were shared with
      // an escortable, where the quest binding and the shop crate fought over one
      // mobile.
      let x = cx + k;
      const y = cy;
      k++;
      while (takenTiles.has(`${x},${y}`)) x++;
      takenTiles.add(`${x},${y}`);

      professions.add(prof);
      const { extras, alternates, shoe } = scrapeOutfit(prof);
      // One half of each either/or, per NPC. Deterministic (`nth`, the running count
      // of this trade) rather than random, so a regenerate does not rewrite the file —
      // and alternating means a row of smiths is not all in ringmail.
      const nth = (placedOf[prof] = (placedOf[prof] || 0) + 1);
      const worn = extras.concat(alternates.map((pair) => pair[nth % pair.length]));
      const npc = {
        // The trade's own body when its class names one, else the human stand-in.
        // Nearly every town class is a `BaseVendor` and rolls a human anyway, but a
        // `MondainQuester` like `FrightenedDryad` writes `Body = 266` — and dressing a
        // dryad as a human shopkeeper is how it ended up standing in Britannia as one.
        body: (creatures[prof] && creatures[prof].body) || DEFAULT_BODY,
        notoriety: 7, // invulnerable — townsfolk are not loot
        hits: 100,
        // The *trade*, not a name. The engine puts a person in front of it — the
        // pack used to send "the blacksmith" as the whole name, so all 38 of
        // Felucca's bankers answered to "the banker".
        title: niceName(prof),
        shoe,
        x,
        y,
        z: 0,
        // Only what the trade's own InitOutfit adds. The base outfit — gender, skin,
        // hair, beard, shirt, trousers, shoes — is the engine's roll, so a street of
        // shopkeepers is not one robe repeated 738 times.
        equipment: worn,
      };
      if (banker) npc.banker = true;
      else if (shop.length) {
        npc.vendor = true;
        stock[`${x},${y}`] = shop;
      }
      npcs.push(npc);
    }
  }
  return { npcs, stock, unknown, professions };
}

// Where a townsperson sleeps, for the engine's optional `gameplay.npc_schedule`.
//
// # This is ours, and it is a derivation, not a port
//
// Neither reference has the data. ServUO's NPCs stand at their posts around the
// clock; its only scheduled-movement mechanism is a hand-placed `WayPoint` chain a
// builder walks an NPC along, and Britannia ships none for townsfolk.
//
// # The first derivation was the bug, not an approximation of it
//
// It sent each townsperson to **another townsperson's post in the same town**, on
// the reasoning that those are tiles ServUO itself stood a mobile on, so they are
// on the floor and reachable. They are. They are also, every one of them, someone
// else's workplace. Measured on the file this produced: 292 townsfolk had a night
// home, **292 of 292 landed exactly on another NPC's post**, 187 of them on a
// *vendor's* post, and 118 were mutual swaps.
//
// A vendor carries its stock crate on layer 0x1A, so the shop is wherever the
// shopkeeper is standing. At dusk the tavernkeeper walked to the innkeeper's
// counter and the innkeeper walked to the tavernkeeper's, each with its shop on
// its back, and double-clicking the person behind the smithy counter opened the
// tailor's buy window. That is not a rough edge on the idea; it is the idea.
//
// # Seats, and why they are the right data
//
// `Data/Decoration` has no bedrooms, which is what the first version concluded and
// stopped at. It does have **chairs** — `WoodenChair`, `BambooChair`,
// `WoodenChairCushion`, `FancyWoodenChairCushion`, `FootStool`, `WoodenBench`,
// `Stool`, both thrones, and the handful of beds. 401 of them in `britain.cfg`
// alone, well over a thousand across the two facets: more seats than there are
// townsfolk. Every one is indoors, inside a real room, placed by ServUO, and none
// of them is anybody's post.
//
// So: the nearest **unclaimed** seat, claimed as it is taken. Claiming is what
// makes this a matching rather than a set of independent nearest-picks, and it is
// what makes a collision impossible rather than unlikely — two townsfolk cannot
// converge on one tile, and a mutual swap has nowhere to happen.
//
// A vendor post is never a destination, seats or no seats. That single rule is
// what keeps a shopkeeper from ever being found behind someone else's counter,
// and it holds even where a town has run out of seats.
//
// The engine settles an NPC *near* its post rather than on it — `wander_step`
// only walks home while further than the two-tile wander radius — so this reads
// as people drifting to the taverns and houses at dusk, not as a town of statues
// standing on the furniture.
//
// # How near
//
// The **nearest** candidate between six and twenty tiles away. Both bounds earn
// their place. Under six and the walk is invisible — the NPC is already inside its
// two-tile wander range and never leaves. Over twenty and the engine's bounded A*
// (`PATH_BUDGET`, 400 nodes) starts failing, at which point `step_toward` falls back
// to a naive heading and the townsperson noses into a wall for the rest of the night;
// a first attempt shifted by index instead of distance produced a median walk of 79
// tiles and a worst case of 442, which is three minutes of walking through a town
// wall. Nearest-first also keeps the pathing cheap, and LOD means the towns nobody is
// standing in do not pay for it at all.
//
// Deterministic, so re-running the converter produces the same file — a random pick
// would put a fresh diff in every regenerate.
const NIGHT_HOME_MIN = 6;
const NIGHT_HOME_MAX = 20;

function assignNightHomes(npcs, regions, seats) {
  const inRect = (x, y, r) =>
    x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  // The most specific town a tile falls in — the same highest-priority-wins rule the
  // engine uses, since ServUO's nesting is flattened into a priority at conversion.
  const townAt = (x, y) => {
    let best = null;
    for (const r of regions) {
      if (!r.rects.some((rect) => inRect(x, y, rect))) continue;
      if (!best || r.priority > best.priority) best = r;
    }
    return best && best.name;
  };

  const byTown = new Map();
  for (const npc of npcs) {
    const town = townAt(npc.x, npc.y);
    if (!town) continue; // out in the wilds: no town, no home to walk to
    if (!byTown.has(town)) byTown.set(town, []);
    byTown.get(town).push(npc);
  }

  // Candidate destinations per town: every seat in it, plus — only as a fallback,
  // and only when a town has fewer seats than people — the posts of townsfolk who
  // keep no shop. A vendor's post is never offered.
  const seatsByTown = new Map();
  for (const seat of seats) {
    const town = townAt(seat.x, seat.y);
    if (!town) continue;
    if (!seatsByTown.has(town)) seatsByTown.set(town, []);
    seatsByTown.get(town).push(seat);
  }

  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const stats = { seated: 0, lodged: 0, homeless: 0 };

  // "Never a vendor's post" has to be checked against the *tile*, not against
  // where the candidate came from. ServUO stands some of its shopkeepers on the
  // furniture in their own shop, so a couple of chairs are also counters — and a
  // seat is exactly as wrong a place to send a stranger as a post is.
  const vendorTiles = new Set(npcs.filter((n) => n.vendor).map((n) => `${n.x},${n.y}`));

  for (const [town, group] of byTown) {
    const candidates = [
      ...(seatsByTown.get(town) || []).map((s) => ({ x: s.x, y: s.y, z: s.z, seat: true })),
      ...group
        .filter((n) => !n.vendor)
        .map((n) => ({ x: n.x, y: n.y, z: n.z, seat: false, owner: n })),
    ];
    const taken = new Set();
    // Sorted so the assignment does not depend on the order the XML happened to
    // list people in: the closest pairing in the town is settled first, and a
    // townsperson with only one candidate in range is not left out by someone who
    // had a dozen.
    const order = [...group].sort((a, b) => a.x - b.x || a.y - b.y);
    for (const npc of order) {
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        if (taken.has(i)) continue;
        const c = candidates[i];
        // Its own post is not somewhere to walk to, and nobody else's counter is.
        if (c.x === npc.x && c.y === npc.y) continue;
        if (vendorTiles.has(`${c.x},${c.y}`)) continue;
        // Nor is the post of someone who is already coming here. Claiming stops
        // two townsfolk converging on one tile; it does not stop them trading
        // places, which reads as two neighbours swapping houses every evening.
        if (c.owner && c.owner.night_home
            && c.owner.night_home[0] === npc.x && c.owner.night_home[1] === npc.y) continue;
        const d = dist(c, npc);
        if (d < NIGHT_HOME_MIN || d > NIGHT_HOME_MAX || d >= bestDist) continue;
        // A seat always beats a post at the same distance; `d >= bestDist` above
        // already keeps the first-found at a tie, and seats are listed first.
        best = i;
        bestDist = d;
      }
      // Nothing free at a walkable remove: this one keeps to its post, which is
      // what every NPC does with the setting off anyway.
      if (best === null) {
        stats.homeless++;
        continue;
      }
      taken.add(best);
      const c = candidates[best];
      npc.night_home = [c.x, c.y, c.z];
      if (c.seat) stats.seated++;
      else stats.lodged++;
    }
  }

  // The three things that made the old derivation wrong, asserted rather than
  // hoped for. A regression here is silent in the game — it looks like a shard
  // with confused shopkeepers, days after the file was generated.
  const posts = new Set(npcs.map((n) => `${n.x},${n.y}`));
  const vendorPosts = new Set(npcs.filter((n) => n.vendor).map((n) => `${n.x},${n.y}`));
  const homes = npcs.filter((n) => n.night_home).map((n) => `${n.night_home[0]},${n.night_home[1]}`);
  const onVendorPost = homes.filter((h) => vendorPosts.has(h)).length;
  const shared = homes.length - new Set(homes).size;
  if (onVendorPost) throw new Error(`${onVendorPost} night homes land on a vendor's post`);
  if (shared) throw new Error(`${shared} night homes are shared between two townsfolk`);
  const byPost = new Map(npcs.map((n) => [`${n.x},${n.y}`, n]));
  const swaps = npcs.filter((n) => {
    if (!n.night_home) return false;
    const other = byPost.get(`${n.night_home[0]},${n.night_home[1]}`);
    return other && other.night_home
      && other.night_home[0] === n.x && other.night_home[1] === n.y;
  }).length;
  if (swaps) throw new Error(`${swaps} pairs of townsfolk swap posts at dusk`);
  stats.onPost = homes.filter((h) => posts.has(h)).length;
  return stats;
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

function convertEscorts(takenTiles) {
  const xml = fs.readFileSync(path.join(SERVUO, "Spawns", "felucca.xml"), "utf8");
  const npcs = [];
  const tiles = {};
  const titles = new Set();
  for (const block of xml.split("<Points>").slice(1)) {
    const cx = num(tag(block, "CentreX")) ?? num(tag(block, "X"));
    const cy = num(tag(block, "CentreY")) ?? num(tag(block, "Y"));
    if (cx == null || cy == null) continue;
    let k = 0;
    for (const name of parseObjects(tag(block, "Objects2") || "")) {
      const disp = ESCORTABLE[name.toLowerCase()];
      if (!disp) continue;
      titles.add(disp);
      // The same one-NPC-per-tile rule the vendor pass follows, and the same
      // registry, so an escortable never lands on a shopkeeper: five tiles used to
      // carry both, and the quest binding and the shop crate fought over one mobile.
      let x = cx + k;
      const y = cy;
      k++;
      while (takenTiles.has(`${x},${y}`)) x++;
      takenTiles.add(`${x},${y}`);
      npcs.push({
        body: 0x0190,
        notoriety: 1, // innocent (blue) — an escortable can be attacked, unlike a vendor
        hits: 60,
        // A wandering soul is dressed by the engine like any townsperson: the
        // display name is its trade, so "a wandering healer" reads as it always did
        // while the person in front of it varies.
        title: disp,
        shoe: 1,
        x,
        y,
        z: 0,
        equipment: [],
      });
      // No fixed destination: the engine picks a random named region when the
      // escort is accepted, which is ServUO's `PickRandomDestination` — and it
      // can, because the converter also brings the regions across.
      tiles[`${x},${y}`] = "";
    }
  }
  return { npcs, tiles, titles };
}

// --------------------------------------------- 7. convert townsfolk speech

// What a trade answers, and the personal names townsfolk are drawn from.
//
// # Why this is thin, and why it is still ServUO's
//
// ServUO barely has per-trade dialogue. A `BaseVendor`'s entire vocabulary is
// cliloc 500186 ("Greetings.  Have a look around.") and 501522 ("I shall not treat
// with scum like thee!"); the keyword machinery is `VendorAI.OnSpeech` and
// XmlSpawner's `XmlDialog`, and neither ships lines for a baker. Sphere has 78
// files of them, and they are not used here.
//
// So rather than invent a personality per trade, every answer below is *derived
// from ServUO data the converter already has*: the greeting is 500186, the "what is
// thy trade" answer is built from the trade's own title, and the "what dost thou
// sell" answer lists the actual contents of that trade's SB\*.cs buy list. A shard
// that wants written dialogue edits this file's table; the engine reads it either
// way.
const TRADE_KEYWORDS = ["job", "work", "trade", "profession", "occupation"];
const WARES_KEYWORDS = ["sell", "wares", "goods", "stock", "shop", "price"];
const GREET_KEYWORDS = ["hail", "hello", "greetings", "hi", "good day"];

// A friendly list: "iron ingots, tongs and a shield".
//
// Deduplicated, because a buy list is keyed by graphic and several graphics share a
// name — a baker stocks two bread-loaf tiles, so a naive join reads "bread loaf and
// bread loaf".
function andList(names) {
  const seen = [...new Set(names)];
  if (seen.length <= 1) return seen[0] || "";
  return seen.slice(0, -1).join(", ") + " and " + seen[seen.length - 1];
}

// What an escortable answers. ServUO's `BaseEscortable` is one of the few NPC classes
// that *does* ship lines, so these are its own: 1005653 when it loses its escorter,
// 1042809 on arrival, and the "I am looking to go to X" ask. The engine says the ask,
// the loss and the arrival itself (they fire on events, not on keywords); what belongs
// in a keyword table is what a traveller answers when spoken to.
const ESCORT_SPEECH = [
  {
    keywords: ["escort", "travel", "journey", "guide", "take", "lead"],
    lines: [
      "I am looking for an escort. Wilt thou take me?",
      "I dare not travel these roads alone. Wilt thou lead me?",
    ],
  },
  {
    keywords: ["pay", "payment", "gold", "reward"],
    lines: ["Payment will be made when we arrive, and gladly."],
  },
  {
    keywords: ["job", "work", "trade", "profession", "occupation"],
    lines: ["I am but a traveller, and I seek safe passage."],
  },
];

function convertSpeech(placed, escortTitles) {
  const { male, female } = scrapeNames();
  const trades = [];
  for (const title of [...escortTitles].sort()) {
    trades.push({
      title,
      // The ask is spoken by the engine on approach (`BaseEscortable.OnMovement`), so
      // the greeting here would only double it.
      greetings: [],
      barks: ["Is there no one who will escort me?"],
      entries: ESCORT_SPEECH,
      fallback: "",
    });
  }
  // Only the trades a populated Felucca actually stands up. ServUO has 250-odd NPC
  // classes and Britannia places 60 of them; a table for the rest is a quarter of a
  // megabyte the shard parses at every load and no NPC ever reads.
  for (const prof of [...placed].sort()) {
    const title = niceName(prof);
    const shop = BANKERS.has(prof) ? [] : scrapeShop(prof);

    const entries = [
      { keywords: GREET_KEYWORDS, lines: [`Greetings, {name}.`, `Well met, {name}.`] },
      {
        keywords: TRADE_KEYWORDS,
        lines: [`I am ${title}.`, `${title.replace(/^the /, "I am the ")}, at thy service.`],
      },
    ];
    if (BANKERS.has(prof)) {
      entries.push({
        keywords: ["bank", "balance", "gold", "account", "box"],
        lines: [
          "Say 'bank' and I shall open thy box, or 'balance' to hear thy total.",
          "Thy gold is safe with me. Say 'bank'.",
        ],
      });
    } else if (shop.length) {
      // The trade's real stock, in ServUO's own words — the item names the buy list
      // already carries, so nothing here is guessed.
      const wares = [...new Set(shop.map((it) => it.name))];
    const sample = andList(wares.slice(0, 4));
      entries.push({
        keywords: WARES_KEYWORDS,
        lines: [
          `I deal in ${sample}. Say 'vendor buy' to see my wares.`,
          `Say 'vendor buy' and look them over.`,
        ],
      });
    }

    // A line called out to nobody in particular. ServUO's townsfolk are silent here
    // and its own source for street noise is the Town Crier (a news queue and a staff
    // gump, a feature of its own) — so rather than write a personality per trade,
    // these are the same derivation the wares answer uses: the trade names itself and
    // what it actually stocks. A trade with no shop has nothing to call out, and stays
    // quiet.
    const barks = shop.length
      ? [
          `${andList([...new Set(shop.map((it) => it.name))].slice(0, 3))} for sale!`,
          `${title.replace(/^the /, "")} at thy service!`,
          `Wares for sale — come, look them over!`,
        ]
      : [];

    trades.push({
      title,
      // 500186 for a shopkeeper; a plain townsperson greets by name.
      greetings: shop.length
        ? ["Greetings.  Have a look around."]
        : [`Greetings, {name}.`, `Well met, {name}.`, `Good day to thee, {name}.`],
      barks,
      entries,
      // Nor do they answer speech they do not understand — that is Sphere's
      // `DEFAULT=`, and a shopkeeper replying to every passing conversation is worse
      // than one that waits to be asked.
      fallback: "",
    });
  }
  return { trades, male, female };
}

function emitSpeech(s) {
  const tradeLines = s.trades.map((tr) => "    " + JSON.stringify(tr) + ",").join("\n");
  const body =
    header(
      "townsfolk speech & names",
      "ServUO BaseVendor clilocs + SB*.cs shop lists + Data/names.xml",
      null,
      null
    ) +
    `Pack.npcSpeech = {\n` +
    `  trades: [\n${tradeLines}\n  ],\n` +
    `  male_names: ${JSON.stringify(s.male)},\n` +
    `  female_names: ${JSON.stringify(s.female)},\n` +
    `};\n`;
  fs.writeFileSync(path.join(OUT, "speech.js"), body);
}

function emitEscorts(e) {
  const npcLines = e.npcs.map((n) => "  " + JSON.stringify(n) + ",").join("\n");
  const tileLines = Object.entries(e.tiles)
    .map(([k, dest]) => `Pack.escortTiles[${JSON.stringify(k)}] = ${JSON.stringify(dest)};`)
    .join("\n");
  const body =
    header("escortable travellers", "Spawns/felucca.xml (BaseEscortable spawns)", SPAWN_VERB, "Populate") +
    `Pack.escortTiles = Pack.escortTiles || {};\n\n` +
    `Pack.npcs["${SPAWN_VERB}"] = (Pack.npcs["${SPAWN_VERB}"] || []).concat([\n${npcLines}\n]);\n\n` +
    tileLines +
    "\n";
  fs.writeFileSync(path.join(OUT, "escorts.js"), body);
}

// ------------------------------------------------------- 6. convert regions

// ServUO's MusicName enum in declaration order (Server/Region.cs): the index is
// what the 0x6D packet carries, and the client owns the tracks. Invalid = -1
// sits before OldUlt01 = 0, so it is not in this list.
const MUSIC = [
  "OldUlt01", "Create1", "DragFlit", "OldUlt02", "OldUlt03", "OldUlt04", "OldUlt05",
  "OldUlt06", "Stones2", "Britain1", "Britain2", "Bucsden", "Jhelom", "LBCastle",
  "Linelle", "Magincia", "Minoc", "Ocllo", "Samlethe", "Serpents", "Skarabra",
  "Trinsic", "Vesper", "Wind", "Yew", "Cave01", "Dungeon9", "Forest_a", "InTown01",
  "Jungle_a", "Mountn_a", "Plains_a", "Sailing", "Swamp_a", "Tavern01", "Tavern02",
  "Tavern03", "Tavern04", "Death", "Combat1", "Combat2", "Combat3", "Approach",
  "Death2", "Victory", "BTCastle", "Nujelm", "Dungeon2", "Cove", "Moonglow",
  "Zento", "TokunoDungeon", "Taiko", "DreadHornArea", "ElfCity", "GrizzleDungeon",
  "MelisandesLair", "ParoxysmusLair", "GwennoConversation", "GoodEndting",
  "BadEndding", "BucsDen",
];
const MUSIC_INDEX = new Map(MUSIC.map((name, i) => [name.toLowerCase(), i]));

// ServUO's LightCycle constants. A dungeon is dark whatever the hour; a jail is
// dim. Everything else takes the ambient the world clock computes.
const DUNGEON_LIGHT = 26;
const JAIL_LIGHT = 9;

// What a region *type* means, in the flags the engine actually reads. Anything
// not named here is a plain named area: it shows on the crossing event and plays
// its music, and changes no rule.
function flagsForType(type) {
  const t = (type || "").toLowerCase();
  const flags = {};
  if (/guarded|town|newmagincia/.test(t)) flags.guarded = true;
  if (/dungeon|mondain/.test(t)) {
    flags.noHousing = true;
    flags.light = DUNGEON_LIGHT;
  }
  if (/jail/.test(t)) {
    flags.noTeleport = true;
    flags.noRecall = true;
    flags.light = JAIL_LIGHT;
  }
  if (/house/.test(t)) flags.noHousing = true;
  return flags;
}

// Pull the Felucca facet's XML out of Data/Regions.xml. A hand-rolled scan
// rather than an XML library: the file is one shape, and the converter has no
// dependencies by design.
function feluccaBlock(xml) {
  const open = xml.search(/<Facet\s+name="Felucca"\s*>/i);
  if (open < 0) return "";
  // Match to the closing </Facet> that balances it — facets do not nest, so the
  // next one wins.
  const rest = xml.slice(open);
  const close = rest.search(/<\/Facet>/i);
  return close < 0 ? rest : rest.slice(0, close);
}

// Every <region> in a block, with its own children removed, paired with the
// text of those children — so the parse can recurse without an XML tree.
function splitRegions(block) {
  const out = [];
  const open = /<region\b([^>]*)>/gi;
  let match;
  while ((match = open.exec(block))) {
    const attrs = match[1];
    const start = open.lastIndex;
    // Find the </region> that closes this one, counting nested opens.
    let depth = 1;
    const scan = /<region\b[^>]*>|<\/region>/gi;
    scan.lastIndex = start;
    let end = block.length;
    let inner;
    while ((inner = scan.exec(block))) {
      depth += inner[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = inner.index;
        break;
      }
    }
    out.push({ attrs, body: block.slice(start, end) });
    open.lastIndex = end;
  }
  return out;
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"));
  return m ? m[1] : null;
}

// A numeric attribute, or NaN when it is not there. `Number(null)` is *zero*,
// not NaN, which quietly turned every rectangle with no zmin into a region one
// unit tall — a town nobody standing in a cellar was ever in.
function numAttr(attrs, name) {
  const raw = attr(attrs, name);
  return raw === null || raw.trim() === "" ? NaN : Number(raw);
}

// A region's own body, with every nested <region> removed. Without this a parent
// inherits its children's rectangles (and their <zrange>), which both bloats the
// data and gives the parent ground that belongs to the child.
function ownBody(body) {
  let out = "";
  let depth = 0;
  let last = 0;
  const scan = /<region\b[^>]*>|<\/region>/gi;
  let m;
  while ((m = scan.exec(body))) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth === 0) last = scan.lastIndex;
    } else {
      if (depth === 0) out += body.slice(last, m.index);
      depth += 1;
    }
  }
  return out + body.slice(last);
}

// One region, flattened: itself plus every descendant, each a region of its own
// with a priority above its parent's. A child inherits what it does not say —
// ServUO walks the parent chain at lookup time; doing it here means the engine
// never has to.
function flattenRegion(node, parent, out) {
  const type = attr(node.attrs, "type") || (parent ? parent.type : "");
  const name = attr(node.attrs, "name") || (parent ? parent.name : "");
  const declared = numAttr(node.attrs, "priority");
  const priority = Number.isFinite(declared) && declared
    ? Math.min(declared, 250)
    : (parent ? Math.min(parent.priority + 1, 250) : 50);

  // Rectangles, with the height band a <zrange> or a rect's own zmin/zmax gives.
  const own = ownBody(node.body);
  const zrange = own.match(/<zrange\b([^>]*)\/?>/i);
  const bandMin = zrange ? numAttr(zrange[1], "min") : NaN;
  const bandMax = zrange ? numAttr(zrange[1], "max") : NaN;
  const rects = [];
  const rectRe = /<rect\b([^>]*)\/?>/gi;
  let r;
  while ((r = rectRe.exec(own))) {
    const a = r[1];
    const x = numAttr(a, "x");
    const y = numAttr(a, "y");
    const width = numAttr(a, "width");
    const height = numAttr(a, "height");
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    const zmin = numAttr(a, "zmin");
    const zmax = numAttr(a, "zmax");
    const rect = { x, y, width, height };
    const lo = Number.isFinite(zmin) ? zmin : bandMin;
    const hi = Number.isFinite(zmax) ? zmax : bandMax;
    if (Number.isFinite(lo)) rect.zMin = Math.max(-128, Math.min(127, lo));
    if (Number.isFinite(hi)) rect.zMax = Math.max(-128, Math.min(127, hi));
    rects.push(rect);
  }

  const music = own.match(/<music\b([^>]*)\/?>/i);
  const track = music ? MUSIC_INDEX.get((attr(music[1], "name") || "").toLowerCase()) : undefined;
  const flags = flagsForType(type);
  // <guards disabled="true"/> turns a guarded region's guards off — Buccaneer's
  // Den and the like, where the whole point is that nobody is coming.
  const guards = own.match(/<guards\b([^>]*)\/?>/i);
  if (guards && /true/i.test(attr(guards[1], "disabled") || "")) flags.guarded = false;

  const self = { name, type, priority, rects, flags, music: track };
  // A region with no rectangles of its own is a container in the XML, not a
  // place: its children carry the geometry.
  if (rects.length) out.push(self);
  for (const child of splitRegions(node.body)) flattenRegion(child, self, out);
  return out;
}

function convertRegions() {
  const file = path.join(SERVUO, "Data", "Regions.xml");
  if (!fs.existsSync(file)) return { regions: [], byType: {} };
  const block = feluccaBlock(fs.readFileSync(file, "utf8"));
  const flat = [];
  for (const node of splitRegions(block)) flattenRegion(node, null, flat);
  const byType = {};
  for (const r of flat) byType[r.type || "(plain)"] = (byType[r.type || "(plain)"] || 0) + 1;
  return { regions: flat, byType };
}

function emitRegions(result) {
  const fmt = (r) => {
    const parts = [`name: ${JSON.stringify(r.name)}`, `priority: ${r.priority}`];
    parts.push(`rects: [${r.rects.map((t) => JSON.stringify(t)).join(", ")}]`);
    for (const key of ["guarded", "noTeleport", "noRecall", "noHousing", "safe"]) {
      if (r.flags[key]) parts.push(`${key}: true`);
    }
    if (r.flags.light !== undefined) parts.push(`light: ${r.flags.light}`);
    if (r.music !== undefined) parts.push(`music: ${r.music}`);
    return `  { ${parts.join(", ")} },`;
  };
  const body =
    header("named regions", "Data/Regions.xml", REGION_VERB, "Regions:") +
    `\nPack.regionSets["${REGION_VERB}"] = {\n  facet: 0,\n  regions: [\n  ` +
    result.regions.map(fmt).join("\n  ") +
    `\n  ],\n};\n`;
  fs.writeFileSync(path.join(OUT, "regions.js"), body);
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

  console.log("Scraping creature bodies from Scripts ...");
  const creatures = scrapeCreatures();
  scrapeCamps();
  console.log(
    `  ${Object.keys(creatures).length} creature classes resolved to a body, ` +
      `${Object.keys(CAMP_CREATURES).length} camps expanded into their garrisons`
  );

  console.log("Scraping item graphics from Scripts/Items ...");
  scrapeItemGraphics();
  console.log(`  ${Object.keys(ITEM_GRAPHICS).length} item classes resolved to a graphic`);

  // One NPC per tile, shared between the vendor and escort passes.
  const takenTiles = new Set();

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
  const vendors = convertVendors(creatures, takenTiles);
  const shops = Object.keys(vendors.stock).length;
  console.log(`  ${vendors.npcs.length} town NPCs placed (${shops} with a shop)`);
  const unknownCount = Object.keys(vendors.unknown).length;
  if (unknownCount) {
    console.log(`  ${unknownCount} town types with no curated data (skipped), top: ${topN(vendors.unknown, 10)}`);
  }

  console.log("Converting regions from Data/Regions.xml ...");
  const regions = convertRegions();
  emitRegions(regions);

  // Vendors are emitted after the regions, because a night home is derived by
  // asking which town a post stands in.
  const homed = assignNightHomes(vendors.npcs, regions.regions, deco.seats);
  emitVendors(vendors);
  console.log(
    `  ${regions.regions.length} regions (` +
      Object.entries(regions.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ") +
      ")"
  );
  console.log(
    `  night homes (gameplay.npc_schedule): ${homed.seated} to a seat, ` +
      `${homed.lodged} to a neighbour's post, ${homed.homeless} keeping to their own; ` +
      `${homed.onPost} on any post at all, 0 on a vendor's, 0 shared`
  );

  console.log("Converting escort givers from felucca.xml ...");
  const escorts = convertEscorts(takenTiles);
  emitEscorts(escorts);
  console.log(`  ${escorts.npcs.length} escortables placed as escort-quest givers`);

  console.log("Converting townsfolk speech and names ...");
  const speech = convertSpeech(vendors.professions, escorts.titles);
  emitSpeech(speech);
  console.log(
    `  ${speech.trades.length} trades with lines, ` +
      `${speech.male.length} male and ${speech.female.length} female names`
  );

  console.log(`\nWrote ${path.relative(PACK, OUT)}/{spawns,deco,regions,vendors,escorts,speech}.js`);
}

main();
