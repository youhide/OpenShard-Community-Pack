"use strict";
// Escort quests — the objective kind that walks.
//
// Unlike kill/deliver, an escort is a live behaviour: an NPC follows the player
// to a town and pays on arrival. It reuses the engine's scripted-brain seam — the
// pack takes the escortable off the built-in AI with op_control, and its onTick
// (dispatched from index.js) steps it toward the escorter with op_move, the same
// server-authoritative, terrain-judged step a creature takes. op_position (the one
// read op) answers "where are we"; op_give_item pays the reward.
//
// A giver is an escortable placed on a tile that Pack.escorts maps to a
// destination and a reward. Double-click it to be led; walk it into the
// destination town and it pays you.

globalThis.Pack = globalThis.Pack || {};
Pack.escorts = Pack.escorts || {}; // "x,y" (spawn tile) -> { dest, reward }
Pack.escortGivers = Pack.escortGivers || {}; // spawned serial -> { cfg, escorter }
Pack.npcs = Pack.npcs || {};

// Felucca town centres the escort can name as a destination. Arriving within
// ARRIVE tiles of one pays the reward. Approximate, tune against the map.
const DESTS = {
  britain: [1434, 1699],
  minoc: [2477, 407],
  vesper: [2899, 676],
  trinsic: [1832, 2779],
  yew: [542, 985],
  skara: [596, 2138],
};
const ARRIVE = 8;

function eops() {
  return Deno.core.ops;
}

// (dx, dy) in {-1,0,1} -> UO direction (0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW), or
// null when already on the tile. +y is south, +x is east.
const DIR = {
  "-1,-1": 7, "0,-1": 0, "1,-1": 1,
  "-1,0": 6, "1,0": 2,
  "-1,1": 5, "0,1": 4, "1,1": 3,
};
function stepDir(from, to) {
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  if (dx === 0 && dy === 0) return null;
  return DIR[`${dx},${dy}`];
}

Pack.Escort = {
  // A spawned escortable on a giver tile: take it off the built-in AI so its
  // onTick runs, and remember what it wants.
  onSpawn(serial, x, y) {
    const cfg = Pack.escorts[`${x},${y}`];
    if (!cfg) return;
    Pack.escortGivers[serial] = { cfg, escorter: 0 };
    eops().op_control(serial);
  },

  // Double-clicked: begin (or refuse a second) escort.
  onTalk(serial, by) {
    const g = Pack.escortGivers[serial];
    if (!g) return false;
    if (!g.escorter) {
      g.escorter = by;
      eops().op_say(serial, `Lead on! I must reach ${g.cfg.dest}. You'll be paid on arrival.`, 0x35);
    } else if (g.escorter === by) {
      eops().op_say(serial, `I am with you — to ${g.cfg.dest}.`, 0x35);
    } else {
      eops().op_say(serial, "Another leads me already.", 0x35);
    }
    return true;
  },

  // Every tick while under control: follow the escorter, and pay on arrival.
  tick(serial) {
    const g = Pack.escortGivers[serial];
    if (!g || !g.escorter) return;
    const me = eops().op_position(serial);
    if (!me) return;
    const them = eops().op_position(g.escorter);
    if (!them) {
      // The escorter is gone (logged out, or out of the world): stop and wait.
      g.escorter = 0;
      return;
    }
    const dest = DESTS[g.cfg.dest];
    if (dest && Math.max(Math.abs(me[0] - dest[0]), Math.abs(me[1] - dest[1])) <= ARRIVE) {
      eops().op_give_item({ serial: g.escorter, graphic: 0x0eed, hue: 0, amount: g.cfg.reward, stackable: true });
      eops().op_say(serial, "We've arrived — my thanks! Here is your payment.", 0x35);
      g.escorter = 0;
      return;
    }
    // Trail the escorter, a tile behind: step toward them unless already adjacent.
    if (Math.max(Math.abs(me[0] - them[0]), Math.abs(me[1] - them[1])) > 1) {
      const d = stepDir(me, them);
      if (d != null) eops().op_move(serial, d);
    }
  },
};

// A sample escortable: a traveller in Britain who wants reaching Minoc, for 500
// gold. Placed by Populate Felucca; its tile names the destination.
const TRAVELLER_X = 1499;
const TRAVELLER_Y = 1629;
Pack.npcs["populate:felucca"] = (Pack.npcs["populate:felucca"] || []).concat([
  {
    body: 0x0190,
    notoriety: 7,
    hits: 100,
    name: "a wary traveller",
    x: TRAVELLER_X,
    y: TRAVELLER_Y,
    z: 0,
    equipment: [
      { graphic: 0x1f03, layer: 0x16, hue: 0x0384 }, // robe
      { graphic: 0x203b, layer: 0x0b, hue: 0x0455 }, // hair
    ],
  },
]);
Pack.escorts[`${TRAVELLER_X},${TRAVELLER_Y}`] = { dest: "minoc", reward: 500 };
