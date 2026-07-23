"use strict";
// The quest engine — the pack side of the quest seam.
//
// The engine (core) grew four seams for this: a `MobileUsed` event so
// double-clicking an NPC reaches us, a pack-driven gump (`op_gump` +
// `GumpAnswered`), an `op_give_item` that drops a reward in the backpack, and a
// per-character quest blob the engine stores and hands back on login
// (`op_set_quest` + the `QuestLoaded` event). Everything a quest *is* — its
// title, objectives and rewards, and the logic below — lives here.
//
// A quest is data (see quests.js):
//   Pack.quests[id] = {
//     title, description,
//     objectives: [ { kind: "kill"|"deliver", target, count } ],
//     rewards:    [ { gold } | { graphic, hue, amount, stackable } ],
//   }
// A giver is an NPC placed at a tile; the tile maps to a quest id, and the
// spawned NPC's serial is matched back to it on `MobileSpawned` (the vendor-stock
// pattern). Talk to it (double-click, `MobileUsed`) to be offered the quest, and
// again once done to turn it in.

globalThis.Pack = globalThis.Pack || {};
Pack.quests = Pack.quests || {};
Pack.questGiverTiles = Pack.questGiverTiles || {}; // "x,y" -> quest id (from quests.js)
Pack.questGivers = Pack.questGivers || {}; // spawned serial -> quest id (filled on spawn)

// The gump id our offer dialog answers under — distinctive, so a reply is never
// mistaken for the admin menu's.
const OFFER_GUMP = 0x0510_0001;

// Per-player progress, in memory for the session and mirrored to the saved blob:
//   serial -> { [questId]: { counts: number[], done: bool, turnedIn: bool } }
const progress = new Map();
// Which quest a player is currently being *offered* (awaiting the gump answer).
const pendingOffer = new Map();
// Which giver a player is turning a collect quest in to, awaiting the ItemsTaken
// that says whether the hand-over went through: serial -> { giver, id }.
const pendingTurnIn = new Map();

function qops() {
  return Deno.core.ops;
}

function stateOf(player) {
  let s = progress.get(player);
  if (!s) {
    s = {};
    progress.set(player, s);
  }
  return s;
}

function persist(player) {
  qops().op_set_quest(player, JSON.stringify(progress.get(player) || {}));
}

function say(giver, text) {
  qops().op_say(giver, text, 0x3b2);
}

// The classic offer dialog: title, description, Accept / Decline.
function sendOffer(player, quest) {
  const layout =
    "{ resizepic 0 0 5054 340 220 }" +
    "{ text 20 18 1153 0 }" +
    "{ text 20 54 1153 1 }" +
    "{ button 40 172 4005 4007 1 1 1 }{ text 76 174 1153 2 }" +
    "{ button 200 172 4017 4019 1 1 2 }{ text 236 174 33 3 }";
  const lines = [quest.title, quest.description, "Accept", "Decline"];
  qops().op_gump({ serial: player, gumpId: OFFER_GUMP, x: 100, y: 100, layout, lines });
}

// The whole quest is complete when every objective's count has reached its max.
function complete(quest, entry) {
  return quest.objectives.every((o, i) => (entry.counts[i] || 0) >= o.count);
}

// A collect quest turns in at the counter, not as it is played: it "needs
// collect" when every *other* objective is done and at least one collect
// objective is still short — the moment to ask the engine to take the items.
function needsCollect(quest, entry) {
  let hasCollect = false;
  for (let i = 0; i < quest.objectives.length; i++) {
    const o = quest.objectives[i];
    const done = (entry.counts[i] || 0) >= o.count;
    if (o.kind === "collect") {
      if (!done) hasCollect = true;
    } else if (!done) {
      return false; // a non-collect objective is unmet — not ready to hand in
    }
  }
  return hasCollect;
}

function turnIn(giver, player, quest, entry) {
  entry.turnedIn = true;
  giveRewards(player, quest);
  persist(player);
  say(giver, quest.complete || "Well done! Take this for your trouble.");
}

function progressLine(quest, entry) {
  return quest.objectives
    .map((o, i) => `${describe(o)}: ${Math.min(entry.counts[i] || 0, o.count)}/${o.count}`)
    .join(", ");
}

function describe(objective) {
  if (objective.kind === "kill") return "slain";
  if (objective.kind === "deliver") return "delivered";
  return "done";
}

function giveRewards(player, quest) {
  for (const r of quest.rewards) {
    if (r.gold != null) {
      qops().op_give_item({ serial: player, graphic: 0x0eed, hue: 0, amount: r.gold, stackable: true });
    } else {
      qops().op_give_item({
        serial: player,
        graphic: r.graphic,
        hue: r.hue || 0,
        amount: r.amount || 1,
        stackable: !!r.stackable,
      });
    }
  }
}

const Quests = {
  // A spawned NPC announced its serial: if it stands on a giver tile, remember it.
  onSpawn(serial, x, y) {
    const id = Pack.questGiverTiles[`${x},${y}`];
    if (id) Pack.questGivers[serial] = id;
  },

  // Double-clicked (or spoken to) a giver: offer the quest, turn it in, or remind.
  onTalk(giverSerial, playerSerial) {
    const id = Pack.questGivers[giverSerial];
    if (!id) return false;
    const quest = Pack.quests[id];
    if (!quest) return false;
    const st = stateOf(playerSerial);
    const entry = st[id];

    if (!entry) {
      // Not started — offer it.
      pendingOffer.set(playerSerial, id);
      sendOffer(playerSerial, quest);
    } else if (entry.turnedIn) {
      say(giverSerial, "You have my thanks already, friend.");
    } else if (complete(quest, entry)) {
      // Every objective already met (kill/deliver) — reward and close it out.
      turnIn(giverSerial, playerSerial, quest, entry);
    } else if (needsCollect(quest, entry)) {
      // A collect quest hands in here: ask the engine to take the items,
      // all-or-nothing; the ItemsTaken it reports drives the reward next tick.
      pendingTurnIn.set(playerSerial, { giver: giverSerial, id });
      for (const o of quest.objectives) {
        if (o.kind === "collect") qops().op_take_item(playerSerial, o.target, o.count);
      }
      say(giverSerial, "Let me see what you've brought...");
    } else {
      say(giverSerial, `Not yet: ${progressLine(quest, entry)}.`);
    }
    return true;
  },

  // The engine answered an op_take_item: the collect hand-over went through, or
  // the player was short. Satisfy the matching objective and, if the quest is now
  // whole, pay the reward.
  onItemsTaken(playerSerial, graphic, taken) {
    const p = pendingTurnIn.get(playerSerial);
    if (!p) return;
    const quest = Pack.quests[p.id];
    const st = progress.get(playerSerial);
    const entry = st && st[p.id];
    if (!quest || !entry) return;
    quest.objectives.forEach((o, i) => {
      if (o.kind === "collect" && o.target === graphic && taken >= o.count) {
        entry.counts[i] = o.count;
      }
    });
    persist(playerSerial);
    if (complete(quest, entry)) {
      pendingTurnIn.delete(playerSerial);
      turnIn(p.giver, playerSerial, quest, entry);
    } else if (taken === 0) {
      say(p.giver, "You have not brought me all I asked for.");
    }
  },

  // Spoke near a giver: the speech trigger. If the words hold "quest" and a giver
  // stands within a few tiles, treat it like a double-click on that giver. Uses
  // op_position (the one read op) to resolve "who is near me", as the banker does.
  onSpeech(playerSerial, text) {
    if (!/\bquest\b/i.test(text || "")) return;
    const me = qops().op_position(playerSerial);
    if (!me) return;
    for (const serial of Object.keys(Pack.questGivers)) {
      const g = qops().op_position(Number(serial));
      if (!g) continue;
      if (Math.max(Math.abs(g[0] - me[0]), Math.abs(g[1] - me[1])) <= 3) {
        this.onTalk(Number(serial), playerSerial);
        return;
      }
    }
  },

  // The offer dialog was answered.
  onGump(playerSerial, gumpId, button) {
    if (gumpId !== OFFER_GUMP) return false;
    const id = pendingOffer.get(playerSerial);
    pendingOffer.delete(playerSerial);
    if (!id || button !== 1) return true; // Declined or closed.
    const quest = Pack.quests[id];
    if (!quest) return true;
    const st = stateOf(playerSerial);
    if (!st[id]) {
      st[id] = { counts: quest.objectives.map(() => 0), done: false, turnedIn: false };
      persist(playerSerial);
    }
    return true;
  },

  // A creature died, credited to `killerSerial`: advance matching kill objectives.
  onKill(killerSerial, body) {
    if (!killerSerial) return;
    this.advance(killerSerial, "kill", body);
  },

  // A quest item was used/delivered by `playerSerial`.
  onDeliver(playerSerial, graphic) {
    this.advance(playerSerial, "deliver", graphic);
  },

  // Bump every active objective of `kind` whose target matches, and save if any did.
  advance(playerSerial, kind, target) {
    const st = progress.get(playerSerial);
    if (!st) return;
    let changed = false;
    for (const id of Object.keys(st)) {
      const entry = st[id];
      if (entry.turnedIn) continue;
      const quest = Pack.quests[id];
      if (!quest) continue;
      quest.objectives.forEach((o, i) => {
        if (o.kind === kind && o.target === target && (entry.counts[i] || 0) < o.count) {
          entry.counts[i] = (entry.counts[i] || 0) + 1;
          changed = true;
        }
      });
    }
    if (changed) persist(playerSerial);
  },

  // A player logged in with a saved quest blob: rebuild their progress.
  restore(playerSerial, blob) {
    try {
      progress.set(playerSerial, JSON.parse(blob) || {});
    } catch (_e) {
      // A malformed blob is dropped rather than crashing the login.
    }
  },
};

Pack.Quests = Quests;
