import { z } from "zod";
import { jsonCall, aiAvailable } from "./client.js";

const Triage = z.object({
  text_en: z.string(),
  category: z.enum(["safety", "service", "rumor", "aid", "other"]),
  urgency: z.enum(["low", "medium", "high"]),
  existing_cluster_id: z.number().int().nullable(),
  new_cluster_title: z.string(),
});

const TITLES = { safety: "Safety reports", service: "Public service problems", rumor: "Rumours and tension", aid: "Aid and relief issues", other: "Other reports" };

export function fallbackTriage({ text, category, areaName, openClusters }) {
  const existing = openClusters.find((c) => c.category === category);
  return {
    text_en: text,
    category,
    urgency: category === "safety" ? "high" : "medium",
    existing_cluster_id: existing ? existing.id : null,
    new_cluster_title: `${TITLES[category] || TITLES.other}: ${areaName}`,
  };
}

/**
 * Translate, classify and cluster a citizen report. Runs after the USSD response is
 * already sent, so latency here never touches the session.
 */
export async function triageReport({ text, category, languageName, areaName, openClusters }) {
  if (!aiAvailable()) return fallbackTriage({ text, category, areaName, openClusters });
  try {
    const out = await jsonCall({
      schema: Triage, maxTokens: 1000, temperature: 0,
      example: { text_en: "Armed men seen near the market gate this morning.", category: "safety", urgency: "high", existing_cluster_id: null, new_cluster_title: "Armed men reported near market gate" },
      system: `You triage anonymous citizen reports for moderators of Gaskiya, a civic information line in crisis-affected areas.
- text_en: faithful English translation of the report (it may be in ${languageName} or any language). Replace names of private individuals with [name] and phone numbers with [number]. Keep place names.
- category: one of safety, service, rumor, aid, other. The reporter chose "${category}" but correct it if clearly wrong.
- urgency: high for ongoing violence, attacks, abductions, fire, flood or medical emergency; medium for tension, threats, service failures affecting many people; low otherwise.
- Clustering: OPEN_CLUSTERS lists existing groups of similar reports in this area. If this report describes the same event or issue as one of them, return its id (a number) in existing_cluster_id. Otherwise null.
- new_cluster_title: a neutral 6 to 10 word English title describing the event, used if no existing cluster matches. Do not include names.`,
      user: `AREA: ${areaName}\nREPORT: ${text}\n\nOPEN_CLUSTERS:\n${JSON.stringify(openClusters.map((c) => ({ id: c.id, title: c.title, category: c.category, reports: c.count })))}\n\nReturn the json triage.`,
    });
    if (!out) return fallbackTriage({ text, category, areaName, openClusters });
    if (out.existing_cluster_id && !openClusters.some((c) => c.id === out.existing_cluster_id)) out.existing_cluster_id = null;
    return out;
  } catch (err) {
    console.error("[report] model call failed, using fallback triage:", err.message);
    return fallbackTriage({ text, category, areaName, openClusters });
  }
}
