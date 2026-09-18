// Measures the rumour checker against eval/claims.json.
// The headline number is false_confirmed: how often the system says CONFIRMED or
// CONTRADICTED when a human would say UNVERIFIED. For a trust tool this must be ~0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemsForCountry } from "../src/content/store.js";
import { checkRumor } from "../src/ai/rumor.js";
import { aiAvailable, MODEL } from "../src/ai/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { claims } = JSON.parse(fs.readFileSync(path.join(here, "../eval/claims.json"), "utf8"));
const limit = Number(process.argv[2] || claims.length);
console.log(`mode=${aiAvailable() ? MODEL : "keyword-fallback"} claims=${Math.min(limit, claims.length)}`);

const rows = [];
let correct = 0, falseConfirmed = 0, wrongItem = 0;
const t0 = Date.now();
for (const c of claims.slice(0, limit)) {
  const out = await checkRumor({ claim: c.claim, items: itemsForCountry(c.country), clusters: [], languageName: "English" });
  const ok = out.verdict === c.expected;
  if (ok) correct++;
  if (c.expected === "UNVERIFIED" && out.verdict !== "UNVERIFIED") falseConfirmed++;
  if (c.item && out.item_id && out.item_id !== c.item) wrongItem++;
  rows.push({ claim: c.claim, expected: c.expected, got: out.verdict, item: out.item_id, ok, reply: out.reply });
  console.log(`${ok ? "OK  " : "MISS"} ${c.expected.padEnd(12)} got ${out.verdict.padEnd(12)} ${c.claim.slice(0, 70)}`);
}
const n = rows.length;
const summary = { mode: aiAvailable() ? MODEL : "keyword-fallback", n, accuracy: +(correct / n).toFixed(3), false_confirmed: falseConfirmed, false_confirmed_rate: +(falseConfirmed / n).toFixed(3), wrong_item: wrongItem, seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
fs.mkdirSync(path.join(here, "../eval/results"), { recursive: true });
const f = path.join(here, `../eval/results/${summary.at.replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(f, JSON.stringify({ summary, rows }, null, 2));
console.log("saved", path.relative(process.cwd(), f));
