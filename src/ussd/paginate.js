// Split long text into USSD-sized screens, cutting on sentence boundaries first,
// then on word boundaries. Never splits a word.
export function paginate(text, max) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [clean];
  const pages = [];
  let cur = "";
  const push = () => { if (cur.trim()) pages.push(cur.trim()); cur = ""; };
  for (let s of sentences) {
    s = s.trim();
    if (s.length > max) {
      // Sentence longer than a screen: fall back to words.
      for (const w of s.split(" ")) {
        if ((cur + " " + w).trim().length > max) push();
        cur = (cur + " " + w).trim();
      }
      continue;
    }
    if ((cur + " " + s).trim().length > max) push();
    cur = (cur + " " + s).trim();
  }
  push();
  return pages;
}

// Rough size of the rendered footer so the body budget accounts for it.
export function footerCost(items) {
  return items.reduce((n, it) => n + it.key.length + 1 + it.label.length + 1, 0) + 6; // + " (2/4)"
}

export function truncate(s, n) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "~";
}
