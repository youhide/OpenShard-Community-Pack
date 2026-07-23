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

  // Double-clicked: begin (or refuse a second) escort. The destination is picked
  // at random on accept (ServUO's PickRandomDestination) unless the tile fixes
  // one; the reward may be a fixed number or a [min, max] range.
  onTalk(serial, by) {
    const g = Pack.escortGivers[serial];
    if (!g) return false;
    if (!g.escorter) {
      g.escorter = by;
      g.dest = g.cfg.dest || randomDest();
      eops().op_say(serial, `Lead on! I must reach ${g.dest}. You'll be paid on arrival.`, 0x35);
    } else if (g.escorter === by) {
      eops().op_say(serial, `I am with you — to ${g.dest}.`, 0x35);
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
    const dest = DESTS[g.dest];
    if (dest && Math.max(Math.abs(me[0] - dest[0]), Math.abs(me[1] - dest[1])) <= ARRIVE) {
      eops().op_give_item({ serial: g.escorter, graphic: 0x0eed, hue: 0, amount: reward(g.cfg.reward), stackable: true });
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

function randomDest() {
  const towns = Object.keys(DESTS);
  return towns[Math.floor(Math.random() * towns.length)];
}

function reward(r) {
  if (Array.isArray(r)) return r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
  return r;
}

// The escortables themselves are generated (felucca/_generated/escorts.js) from
// ServUO's BaseEscortable spawns; this file is the behaviour only.
