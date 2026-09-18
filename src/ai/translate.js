import { z } from "zod";
import { jsonCall, SCREEN_RULES, aiAvailable, foldDeep } from "./client.js";
import { englishStrings } from "../i18n/index.js";

export function slugLang(name) {
  return "x-" + String(name).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

const translatableKeys = Object.keys(englishStrings).filter((k) => k !== "_meta");

// Translate the whole UI string pack into a named language. Used by the "Other"
// option at runtime (short timeout) and by scripts/generate-content.js (long timeout).
export async function translateStrings(languageName, { attempts = 2, timeoutMs = 60_000 } = {}) {
  if (!aiAvailable()) return null;
  const shape = Object.fromEntries(translatableKeys.map((k) => [k, z.string()]));
  const Schema = z.object({ language_display_name: z.string(), strings: z.object(shape) });
  const source = Object.fromEntries(translatableKeys.map((k) => [k, englishStrings[k]]));
  const example = { language_display_name: languageName, strings: { app_name: "Gaskiya", welcome: "...", "...every other key...": "..." } };

  const out = await jsonCall({
    schema: Schema, example, maxTokens: 8000, attempts, timeoutMs,
    system: `You localise a civic information USSD service called Gaskiya into ${languageName}.
${SCREEN_RULES}
- Keep placeholders like {area}, {ref}, {n}, {date}, {contact}, {country} exactly as they are.
- Keep each translation no longer than about 1.2x the English length.
- Keep "Gaskiya" as the product name.
- Use everyday spoken register, not formal or literary language.
- Return every key you were given, with the same key names, under "strings".
- Every value must be in ${languageName}. Do not switch to another language for any key.
- If ${languageName} is not a real language you can write, translate into the closest widely understood language of that community and say which in language_display_name.`,
    user: `Translate every value in this json object into ${languageName}. Return the same keys.\n\n${JSON.stringify(source, null, 1)}`,
  });
  return out ? foldDeep(out) : null;
}

const ItemSchema = z.object({ title: z.string().min(3), body: z.string().min(20), action: z.string().min(5) });

// Localise one content item. bodyBudget is the total characters the body may use
// across the allowed screens.
export async function translateItem(item, languageName, { bodyBudget = 400, attempts = 2, timeoutMs = 30_000 } = {}) {
  if (!aiAvailable()) return null;
  const out = await jsonCall({
    schema: ItemSchema, maxTokens: 2000, attempts, timeoutMs,
    example: { title: "Short title", body: "The notice, all facts kept.", action: "What the reader should do next." },
    system: `You localise official civic notices into ${languageName} for a USSD service.
${SCREEN_RULES}
- title: at most 40 characters.
- body: at most ${bodyBudget} characters. Keep every fact, date, place and number from the source. Drop filler, never facts.
- action: at most 140 characters. It tells the reader exactly what to do next.
- Keep phone numbers, USSD codes and proper names unchanged.
- The target language is ${languageName}, whatever country or town the notice is about. A notice about Kano or Nairobi is still written in ${languageName}, never in Hausa or Swahili unless that IS the target language.`,
    user: `Localise this json notice:\n${JSON.stringify({ title: item.title, body: item.body, action: item.action })}`,
  });
  return out ? foldDeep(out) : null;
}
