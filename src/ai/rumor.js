import { z } from "zod";
import { jsonCall, SCREEN_RULES, aiAvailable, asciiFold } from "./client.js";

const Verdict = z.object({
  verdict: z.enum(["CONFIRMED", "CONTRADICTED", "UNVERIFIED"]),
  item_id: z.string().nullable(),
  cluster_id: z.number().int().nullable(),
  reply: z.string(),
  safety_concern: z.boolean(),
});

const STOP = new Set("the a an is are was were be been in on at to of for and or that this it they there will has have with from by about into over under not no yes".split(" "));
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

// Keyword fallback used when no API key is present or the model call fails.
export function keywordCheck(claim, items) {
  const cw = new Set(words(claim));
  let best = null, bestScore = 0;
  for (const it of items) {
    const iw = new Set(words(`${it.title} ${it.body}`));
    let score = 0;
    for (const w of cw) if (iw.has(w)) score++;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  if (best && bestScore >= 3) {
    return { verdict: "UNVERIFIED", item_id: best.id, cluster_id: null, safety_concern: false,
      reply: `A related official notice exists. Read it below and compare with what you heard.` };
  }
  return { verdict: "UNVERIFIED", item_id: null, cluster_id: null, safety_concern: false, reply: "" };
}

/**
 * Check a claim against the trusted items for the user's country plus any community
 * report clusters that have crossed the public threshold.
 * The model is told to default to UNVERIFIED. Anything else must point at an item id.
 */
export async function checkRumor({ claim, items, clusters, languageName }) {
  if (!aiAvailable()) return keywordCheck(claim, items);
  const compactItems = items.map((it) => ({ id: it.id, area: it.area, date: it.source_date, source: it.source_name, title: it.title, body: it.body }));
  const compactClusters = clusters.map((c) => ({ id: c.id, area: c.area, reports: c.count, title: c.title }));
  try {
    const out = await jsonCall({
      schema: Verdict, maxTokens: 1000, temperature: 0, attempts: 1, timeoutMs: 15_000,
      example: { verdict: "UNVERIFIED", item_id: null, cluster_id: null, reply: "No trusted source covers this yet. Treat it as a rumour.", safety_concern: false },
      system: `You verify rumours for Gaskiya, a civic information line used in areas affected by conflict and crisis.
You are given TRUSTED_ITEMS (official notices, each with a source and date) and COMMUNITY_CLUSTERS (unverified reports from other users, grouped).
Rules:
- CONFIRMED only if a trusted item clearly supports the claim. Set item_id to that item's id.
- CONTRADICTED only if a trusted item clearly says otherwise. Set item_id to that item's id.
- Otherwise UNVERIFIED with item_id null. When in doubt, UNVERIFIED. A community cluster never confirms anything.
- If a community cluster describes the same thing, set cluster_id (a number) so the user can be told others reported it. Otherwise null.
- safety_concern is true if the claim involves violence, attack, kidnapping, displacement or immediate danger.
- reply: at most 200 characters, in ${languageName}, addressed to the person. Say what the trusted source says, or that no trusted source covers it yet and to treat it as a rumour. Never repeat the rumour as if true.
${SCREEN_RULES}`,
      user: `CLAIM: ${claim}\n\nTRUSTED_ITEMS:\n${JSON.stringify(compactItems)}\n\nCOMMUNITY_CLUSTERS:\n${JSON.stringify(compactClusters)}\n\nReturn the json verdict.`,
    });
    if (!out) return keywordCheck(claim, items);
    out.reply = asciiFold(out.reply);
    // Hard guard: a non-UNVERIFIED verdict must cite a real item.
    if (out.verdict !== "UNVERIFIED" && !items.some((it) => it.id === out.item_id)) {
      out.verdict = "UNVERIFIED"; out.item_id = null;
    }
    if (out.cluster_id && !clusters.some((c) => c.id === out.cluster_id)) out.cluster_id = null;
    return out;
  } catch (err) {
    console.error("[rumor] model call failed, using keyword fallback:", err.message);
    return keywordCheck(claim, items);
  }
}
