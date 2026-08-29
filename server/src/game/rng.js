// Deterministic seeded RNG. PRD §9/§12: the server owns the match seed, and a match must be
// reproducible from it — same seed, same market selection, same event timeline.
//
// mulberry32: small, fast, and stable across Node versions, which matters because
// reproducibility is the repo's primary debugging affordance (no test framework yet).

/** Hash an arbitrary string seed into a 32-bit integer. */
export function hashSeed(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i += 1) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Create an independent PRNG stream from a seed. Returns a function yielding [0, 1). */
export function createRng(seed) {
  let a = hashSeed(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 12);
}
