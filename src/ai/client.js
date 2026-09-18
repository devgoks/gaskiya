import OpenAI from "openai";
import { config } from "../config.js";

// DeepSeek exposes an OpenAI-compatible API. One client for the whole app.
// When DEEPSEEK_API_KEY is missing, every AI function falls back to a deterministic
// path so the USSD line keeps working end to end.
export const client = config.aiEnabled
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: config.aiBaseUrl, timeout: 25_000, maxRetries: 0 })
  : null;
export const MODEL = config.model;
export const aiAvailable = () => client !== null;

// USSD gateways carry the GSM 7-bit basic set. Anything else renders as garbage on
// many handsets, so every string the model writes for a screen follows this rule.
export const SCREEN_RULES = `Write for a USSD phone screen.
- Use only plain ASCII letters, digits and basic punctuation. No accents, no diacritics, no emoji. Write "Francais" not "Français", "E ku aaro" not "Ẹ kú àárọ̀".
- For Arabic, write in the Latin-letter transliteration people commonly type on phones (Arabizi), not Arabic script.
- Be short. Every character costs screen space.
- Never invent facts, numbers, dates or contacts that are not in the material you are given.`;

/**
 * One JSON-mode call, validated against a zod schema.
 * DeepSeek JSON mode needs the word "json" and an example shape in the prompt and can
 * return empty content, so we retry with a short backoff before giving up.
 */
export async function jsonCall({ system, user, schema, example, maxTokens = 2000, temperature = 0.2, attempts = 2, timeoutMs = 20_000 }) {
  if (!client) return null;
  const sys = `${system}\n\nRespond with a single JSON object only, no prose, no code fences. Use exactly this json shape:\n${JSON.stringify(example)}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * (attempt - 1)));
    let res;
    try {
      res = await client.chat.completions.create({
        model: MODEL,
        temperature,
        max_tokens: maxTokens,
        // These are deterministic formatting tasks. DeepSeek turns chain-of-thought on by
        // default at high effort and its tokens count against max_tokens, which left the
        // answer empty or truncated. Off is faster, cheaper and more reliable here.
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }, { timeout: timeoutMs });
    } catch (err) {
      console.warn(`[ai] request failed (attempt ${attempt}/${attempts}): ${err.message}`);
      continue;
    }
    const choice = res.choices?.[0];
    const raw = choice?.message?.content?.trim();
    if (!raw) { console.warn(`[ai] empty content from ${MODEL} (attempt ${attempt}/${attempts}, finish=${choice?.finish_reason})`); continue; }
    if (choice.finish_reason === "length") { console.warn(`[ai] output truncated at max_tokens=${maxTokens} (attempt ${attempt}/${attempts})`); continue; }
    let parsed;
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
    catch { console.warn(`[ai] invalid JSON (attempt ${attempt}/${attempts}): ${raw.slice(0, 100)}`); continue; }
    const check = schema.safeParse(parsed);
    if (check.success) return check.data;
    console.warn(`[ai] schema mismatch (attempt ${attempt}/${attempts}): ${check.error.issues.map((i) => i.path.join(".") + " " + i.message).slice(0, 3).join("; ")}`);
  }
  return null;
}

// Defensive post-processing: even with the rule above, fold any stray accented
// characters to their base letter so nothing non-GSM reaches a handset.
export function asciiFold(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, (ch) => ({ "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "..." }[ch] ?? ""));
}
export function foldDeep(v) {
  if (typeof v === "string") return asciiFold(v);
  if (Array.isArray(v)) return v.map(foldDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, foldDeep(x)]));
  return v;
}
