import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getI18n } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = {};
for (const f of fs.readdirSync(here)) {
  if (f.endsWith(".json")) packs[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(here, f), "utf8"));
}

// Fixed menu. Codes are what we store; labels are shown in the language itself so a
// speaker can find their own without reading another language first.
// `label` is what the user sees on the menu. `prompt` is the unambiguous name handed to
// the model: "Arabic" alone made it drift into Hausa or Swahili for Nigerian and Kenyan
// notices, because those are also Latin-script languages of the places in the text.
export const LANGUAGES = [
  { code: "en", label: "English", prompt: "English" },
  { code: "fr", label: "Francais", prompt: "French" },
  { code: "ar", label: "Arabic", prompt: "Arabic (Modern Standard Arabic as understood across Sudan and North Africa, written in Arabizi: Latin letters and digits as Arabic speakers type on phones, e.g. 'al-yom', '3an', '7ukuma')" },
  { code: "pt", label: "Portugues", prompt: "Portuguese (Mozambican usage)" },
  { code: "sw", label: "Kiswahili", prompt: "Swahili (Kiswahili)" },
  { code: "ha", label: "Hausa", prompt: "Hausa" },
  { code: "yo", label: "Yoruba", prompt: "Yoruba" },
  { code: "ig", label: "Igbo", prompt: "Igbo" },
];
export const promptName = (code) => LANGUAGES.find((l) => l.code === code)?.prompt || code;

export const englishStrings = packs.en;

export function hasPack(lang) { return Boolean(packs[lang]) || Boolean(getI18n.get(lang)); }

export function stringsFor(lang) {
  if (packs[lang]) return packs[lang];
  const row = getI18n.get(lang);
  if (row) {
    try { return { ...packs.en, ...JSON.parse(row.strings_json) }; } catch { /* fall through */ }
  }
  return packs.en;
}

export function t(lang, key, vars = {}) {
  const s = stringsFor(lang)[key] ?? packs.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

export function loadedPacks() { return Object.keys(packs); }
