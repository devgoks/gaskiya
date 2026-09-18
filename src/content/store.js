import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbItems, getTranslation } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), "utf8"));

export const areas = read("areas.json");
export const contacts = read("contacts.json");
const seeds = read("seeds.json").items.map((it) => ({
  ...it, origin: "seed",
  source_name: it.source.name, source_date: it.source.date, source_url: it.source.url,
}));

// Pre-generated translations for the fixed language set live in content/generated/<lang>.json
const generatedDir = path.join(here, "generated");
const generated = {};
if (fs.existsSync(generatedDir)) {
  for (const f of fs.readdirSync(generatedDir)) {
    if (f.endsWith(".json")) generated[f.replace(".json", "")] = read(path.join("generated", f));
  }
}
export const generatedLanguages = () => Object.keys(generated);

export function allItems() {
  const fromDb = dbItems.all();
  return [...fromDb, ...seeds];
}

export function itemsFor(country, area, { category = null, limit = 50 } = {}) {
  return allItems()
    .filter((it) => it.country === country && (it.area === area || it.area === "ALL"))
    .filter((it) => !category || it.category === category)
    .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || String(b.source_date).localeCompare(String(a.source_date)))
    .slice(0, limit);
}

export function itemsForCountry(country) {
  return allItems().filter((it) => it.country === country);
}

export function getItem(id) {
  return allItems().find((it) => it.id === id) || null;
}

// Returns {title, body, action} in the requested language, falling back to English.
export function localise(item, lang) {
  if (!lang || lang === "en") return { title: item.title, body: item.body, action: item.action };
  const g = generated[lang]?.[item.id];
  if (g) return g;
  const t = getTranslation.get(item.id, lang);
  if (t) return { title: t.title, body: t.body, action: t.action };
  return { title: item.title, body: item.body, action: item.action };
}

export function contactsFor(country, area, tag = null) {
  return (contacts[country] || [])
    .filter((c) => !c.area || c.area === area)
    .filter((c) => !tag || c.tags.includes(tag));
}

export function areaName(code) {
  for (const c of Object.values(areas)) if (c.areas[code]) return c.areas[code];
  return code === "ALL" ? "National" : code;
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
