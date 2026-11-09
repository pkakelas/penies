// Matching for the landing page's search box. Text is reduced to a "key": how
// it sounds, in Latin letters. Greek and Latin spellings of a name give the
// same key, so "Χιώτης", "χιωτης", "xiotis" and "chiotis" all find each other.

const GREEK: Record<string, string> = {
  αυ: "av", ευ: "ev",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
  ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

// Spellings of one sound, in the order they are folded together. What the
// Greek letters above turn into goes through the same list ("ου" is "oy" by
// then, "μπ" is "mp", "γκ" is "gk").
const SOUNDS: [RegExp, string][] = [
  [/ou|oy/g, "u"],
  [/y/g, "i"],
  [/ai/g, "e"],
  [/ei|oi/g, "i"],
  [/gk|ng|gg/g, "g"],
  [/mp/g, "b"],
  [/nt/g, "d"],
  [/ch|kh|ks|x/g, "h"],
  [/ph/g, "f"],
  [/w/g, "o"],
  [/c/g, "k"],
  [/j/g, "tz"],
  [/v/g, "b"],
  [/([a-z])\1+/g, "$1"],
];

/** The key of a piece of text: lower case, no accents, Latin letters, one spelling per sound. */
export function searchKey(text: string): string {
  let key = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ς/g, "σ")
    .replace(/αυ|ευ|[α-ω]/g, (letters) => GREEK[letters] ?? letters);
  for (const [spelling, sound] of SOUNDS) key = key.replace(spelling, sound);
  return key;
}

/**
 * Which of the songs match what was typed in the search box: one answer per
 * key, each key being searchKey() of a song's text. Every word typed must
 * appear somewhere in the key.
 *
 * When that leaves no song, the last letter typed is given up. The word may
 * still be on its way, and half of a pair of letters has another key than the
 * pair ("vo" before "vou"); without this the list would empty for a moment.
 */
export function search(keys: string[], query: string): boolean[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const typed = words.map(searchKey);
  const having = (wanted: string[]) => keys.map((key) => wanted.every((word) => key.includes(word)));
  const exact = having(typed);
  const last = words.at(-1);
  if (exact.includes(true) || !last || last.length < 2) return exact;
  return having([...typed.slice(0, -1), searchKey(last.slice(0, -1))]);
}
