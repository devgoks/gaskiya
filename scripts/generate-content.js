// Batch step: localise the UI strings and every seed item into the fixed language set.
// Runs offline, never in a USSD session. Resumable: existing translations are kept and
// only missing ones are requested, so rerunning fills gaps.
//   node scripts/generate-content.js            # all languages, strings + items
//   node scripts/generate-content.js --lang ha  # one language
//   node scripts/generate-content.js --only strings|items
//   node scripts/generate-content.js --force    # redo everything
//   node scripts/generate-content.js --fix-budgets  # redo only items whose title/body/action exceed the screen budgets
//   node scripts/generate-content.js --db          # translate moderator-published items in the DB that lack translations
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../src/i18n/index.js";
import { translateStrings, translateItem } from "../src/ai/translate.js";
import { aiAvailable, MODEL } from "../src/ai/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const onlyLang = opt("--lang"), only = opt("--only"), force = args.includes("--force"), fixBudgets = args.includes("--fix-budgets"), dbMode = args.includes("--db");
const BUDGET = { title: 40, body: 420, action: 140 };
const ATTEMPTS = 3, STRINGS_TIMEOUT = 120_000, ITEM_TIMEOUT = 45_000, ITEM_BATCH = 3, LANG_PARALLEL = 2;

if (!aiAvailable()) { console.error("DEEPSEEK_API_KEY is not set. Nothing generated; the app falls back to English."); process.exit(1); }
const seeds = JSON.parse(fs.readFileSync(path.join(root, "src/content/seeds.json"), "utf8")).items;

// --db: items published from the moderator desk while AI was off have no translations.
if (dbMode) {
  const db = await import("../src/db.js");
  const items = db.dbItems.all();
  const langs = LANGUAGES.filter((l) => l.code !== "en" && (!onlyLang || l.code === onlyLang));
  let done = 0, failed = 0;
  for (const it of items) for (const l of langs) {
    if (!force && db.getTranslation.get(it.id, l.code)) continue;
    const out = await translateItem(it, l.prompt, { attempts: ATTEMPTS, timeoutMs: ITEM_TIMEOUT }).catch(() => null);
    if (out) { db.upsertTranslation.run(it.id, l.code, out.title, out.body, out.action); done++; } else failed++;
    console.log(`[db] ${it.id} ${l.code}: ${out ? "ok" : "FAILED"}`);
  }
  console.log(`db items=${items.length} translated=${done} failed=${failed}`);
  process.exit(failed ? 1 : 0);
}
const targets = LANGUAGES.filter((l) => l.code !== "en" && (!onlyLang || l.code === onlyLang));
console.log(`model=${MODEL} languages=${targets.map((l) => l.code).join(",")} items=${seeds.length} ${force ? "(force)" : "(resume)"}`);
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const summary = {};

async function doLanguage(l) {
  const t0 = Date.now();
  const stringsPath = path.join(root, `src/i18n/${l.code}.json`);
  const itemsPath = path.join(root, `src/content/generated/${l.code}.json`);
  summary[l.code] = { strings: "skipped", items: "skipped" };

  if (only !== "items") {
    if (!force && readJson(stringsPath)) { summary[l.code].strings = "kept"; console.log(`[${l.code}] strings: already present`); }
    else {
      const out = await translateStrings(l.prompt, { attempts: ATTEMPTS, timeoutMs: STRINGS_TIMEOUT });
      if (!out) { summary[l.code].strings = "FAILED"; console.error(`[${l.code}] strings: FAILED after ${ATTEMPTS} attempts`); }
      else {
        const pack = { _meta: { name: out.language_display_name, code: l.code, generated_at: new Date().toISOString(), model: MODEL }, ...out.strings };
        fs.writeFileSync(stringsPath, JSON.stringify(pack, null, 2));
        summary[l.code].strings = `${Object.keys(out.strings).length} keys`;
        console.log(`[${l.code}] strings: ${Object.keys(out.strings).length} keys`);
      }
    }
  }
  if (only !== "strings") {
    fs.mkdirSync(path.dirname(itemsPath), { recursive: true });
    const result = (!force && readJson(itemsPath)) || {};
    const over = (r) => r && (r.title.length > BUDGET.title || r.body.length > BUDGET.body || r.action.length > BUDGET.action);
    if (fixBudgets) for (const it of seeds) if (over(result[it.id])) delete result[it.id];
    const todo = seeds.filter((it) => !result[it.id]);
    for (let i = 0; i < todo.length; i += ITEM_BATCH) {
      const batch = todo.slice(i, i + ITEM_BATCH);
      const outs = await Promise.all(batch.map((it) => translateItem(it, l.prompt, { attempts: ATTEMPTS, timeoutMs: ITEM_TIMEOUT }).catch((e) => { console.error(`[${l.code}] ${it.id}: ${e.message}`); return null; })));
      batch.forEach((it, j) => { if (outs[j]) result[it.id] = outs[j]; });
      fs.writeFileSync(itemsPath, JSON.stringify(result, null, 2)); // save progress after every batch
      console.log(`[${l.code}] items ${Object.keys(result).length}/${seeds.length}`);
    }
    const missing = seeds.filter((it) => !result[it.id]).map((it) => it.id);
    const long = Object.values(result).filter((r) => r.body.length > 420).length;
    summary[l.code].items = `${Object.keys(result).length}/${seeds.length}${missing.length ? " missing " + missing.join(",") : ""}${long ? ` (${long} over body budget)` : ""}`;
    console.log(`[${l.code}] done: ${summary[l.code].items} in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}

// A few languages at a time keeps us under rate limits and timeouts.
for (let i = 0; i < targets.length; i += LANG_PARALLEL) {
  const group = targets.slice(i, i + LANG_PARALLEL);
  const results = await Promise.allSettled(group.map(doLanguage));
  results.forEach((r, j) => { if (r.status === "rejected") { summary[group[j].code] = { error: r.reason?.message }; console.error(`[${group[j].code}] FAILED: ${r.reason?.message}`); } });
}
console.log("\nSUMMARY");
for (const [code, s] of Object.entries(summary)) console.log(`  ${code}: strings=${s.strings ?? "-"} items=${s.items ?? "-"}${s.error ? " error=" + s.error : ""}`);
