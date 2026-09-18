// The USSD state machine. Gateway-agnostic: it receives a session and the raw user
// input and returns a screen. See adapters.js for how screens reach a gateway.
import { config } from "../config.js";
import { t, LANGUAGES, promptName } from "../i18n/index.js";
import { areas, itemsFor, itemsForCountry, localise, contactsFor, areaName, formatDate, getItem } from "../content/store.js";
import * as db from "../db.js";
import { paginate, footerCost, truncate } from "./paginate.js";
import { checkRumor } from "../ai/rumor.js";
import { triageReport } from "../ai/report.js";
import { translateStrings, slugLang } from "../ai/translate.js";
import { shortRef } from "../hash.js";

const menu = (title, items) => ({ kind: "menu", title, items });
const input = (message) => ({ kind: "input", message });
const end = (message) => ({ kind: "end", message });

const CATEGORIES = ["notice", "safety", "community", "services"];
const REPORT_CATS = ["safety", "service", "rumor", "aid", "other"];
const REPORT_TO_ITEM_CAT = { safety: "safety", service: "services", rumor: "community", aid: "services", other: "notice" };
export { REPORT_TO_ITEM_CAT };

function languageName(lang) {
  const fixed = LANGUAGES.find((l) => l.code === lang);
  if (fixed) return fixed.prompt;
  const row = db.getI18n.get(lang);
  return row?.display_name || "English";
}

// ---------------------------------------------------------------- reading
// Long text is split into screens; each screen is a menu whose title is the page and
// whose items are "1 More / 0 Menu". The last page carries the caller's own options.
function startReading(s, text, { lastItems = [], onLast = null } = {}) {
  const L = (k) => t(s.lang, k);
  const nav = [{ key: "1", label: L("more") }, { key: "0", label: L("menu") }];
  const budget = config.screenMax - footerCost(nav);
  s.read = { pages: paginate(text, budget), idx: 0, lastItems, onLast };
  s.state = "READ";
  return renderRead(s);
}
function renderRead(s) {
  const L = (k) => t(s.lang, k);
  const { pages, idx, lastItems } = s.read;
  const n = pages.length;
  const counter = n > 1 ? ` (${idx + 1}/${n})` : "";
  if (idx < n - 1) return menu(pages[idx] + counter, [{ key: "1", label: L("more") }, { key: "0", label: L("menu") }]);
  return menu(pages[idx] + counter, [...lastItems, { key: "0", label: L("menu") }]);
}
async function onRead(s, v) {
  const { pages, idx, onLast } = s.read;
  if (v === "0") return home(s);
  if (idx < pages.length - 1) { if (v === "1") s.read.idx++; return renderRead(s); }
  if (onLast) { const next = await onLast(v); if (next) return next; }
  return home(s);
}

// ---------------------------------------------------------------- entry
export async function start(s) {
  const u = db.getUser(s.userHash);
  if (u?.lang) { s.lang = u.lang; s.country = u.country; s.area = u.area; }
  if (!u?.lang) return enterLang(s);
  return home(s);
}

export function home(s) {
  s.read = null; s.data = {};
  if (!s.country || !s.area) return enterCountry(s);
  return enterMain(s);
}

export async function handle(s, value) {
  const v = String(value ?? "").trim();
  switch (s.state) {
    case "LANG": return onLang(s, v);
    case "LANG_OTHER": return onLangOther(s, v);
    case "COUNTRY": return onCountry(s, v);
    case "AREA": return onArea(s, v);
    case "MAIN": return onMain(s, v);
    case "FRONT": return onList(s, v);
    case "SECTIONS": return onSections(s, v);
    case "LIST": return onList(s, v);
    case "READ": return onRead(s, v);
    case "CHECK": return onCheck(s, v);
    case "REPORT_CAT": return onReportCat(s, v);
    case "REPORT_AREA": return onReportArea(s, v);
    case "REPORT_TEXT": return onReportText(s, v);
    case "REPORT_WHEN": return onReportWhen(s, v);
    case "SETTINGS": return onSettings(s, v);
    default: return home(s);
  }
}

// ---------------------------------------------------------------- language
function enterLang(s) {
  s.state = "LANG";
  const items = LANGUAGES.map((l, i) => ({ key: String(i + 1), label: l.label }));
  items.push({ key: "9", label: t("en", "other_language") });
  return menu("Gaskiya - Choose language", items);
}
async function onLang(s, v) {
  if (v === "9") { s.state = "LANG_OTHER"; return input(t(s.lang, "type_language")); }
  const l = LANGUAGES[Number(v) - 1];
  if (!l) return enterLang(s);
  s.lang = l.code;
  db.saveUser({ user_hash: s.userHash, lang: s.lang });
  return home(s);
}
async function onLangOther(s, v) {
  if (!v) return enterLang(s);
  const code = slugLang(v);
  let row = db.getI18n.get(code);
  if (!row) {
    try {
      const out = await translateStrings(v, { attempts: 1, timeoutMs: 45_000 });
      if (out) { db.putI18n.run(code, out.language_display_name, JSON.stringify(out.strings)); row = db.getI18n.get(code); }
    } catch (err) { console.error("[lang] translation failed:", err.message); }
  }
  if (!row) {
    s.lang = "en"; db.saveUser({ user_hash: s.userHash, lang: "en" });
    return startReading(s, t("en", "language_unavailable"));
  }
  s.lang = code;
  db.saveUser({ user_hash: s.userHash, lang: code });
  return home(s);
}

// ---------------------------------------------------------------- location
function enterCountry(s) {
  s.state = "COUNTRY";
  const codes = Object.keys(areas);
  return menu(t(s.lang, "choose_country"), codes.map((c, i) => ({ key: String(i + 1), label: t(s.lang, "country_" + c) })));
}
function onCountry(s, v) {
  const code = Object.keys(areas)[Number(v) - 1];
  if (!code) return enterCountry(s);
  s.data.country = code;
  return enterArea(s, 0);
}
function enterArea(s, page = 0) {
  s.state = "AREA";
  const list = Object.entries(areas[s.data.country].areas);
  const slice = list.slice(page * 8, page * 8 + 8);
  s.data.areaPage = page;
  const items = slice.map(([code, name], i) => ({ key: String(i + 1), label: name }));
  if (list.length > (page + 1) * 8) items.push({ key: "9", label: t(s.lang, "more") });
  return menu(t(s.lang, "choose_area"), items);
}
function onArea(s, v) {
  if (v === "9") return enterArea(s, s.data.areaPage + 1);
  const list = Object.entries(areas[s.data.country].areas);
  const pick = list[s.data.areaPage * 8 + Number(v) - 1];
  if (!pick) return enterArea(s, s.data.areaPage);
  s.country = s.data.country; s.area = pick[0];
  db.saveUser({ user_hash: s.userHash, country: s.country, area: s.area });
  if (s.data.afterArea === "REPORT_TEXT") return enterReportText(s);
  return enterMain(s);
}

// ---------------------------------------------------------------- main menu
function enterMain(s) {
  s.state = "MAIN"; s.read = null;
  const L = (k) => t(s.lang, k);
  return menu(t(s.lang, "main_title", { area: areaName(s.area) }), [
    { key: "1", label: L("menu_front") },
    { key: "2", label: L("menu_sections") },
    { key: "3", label: L("menu_check") },
    { key: "4", label: L("menu_report") },
    { key: "5", label: L("menu_contacts") },
    { key: "6", label: L("menu_myreports") },
    { key: "7", label: L("menu_settings") },
  ]);
}
async function onMain(s, v) {
  switch (v) {
    case "1": return enterList(s, { title: t(s.lang, "front_title", { date: formatDate(new Date().toISOString()) }), items: itemsFor(s.country, s.area, { limit: 3 }), state: "FRONT", empty: "front_empty" });
    case "2": return enterSections(s);
    case "3": s.state = "CHECK"; return input(t(s.lang, "check_prompt"));
    case "4": return enterReportCat(s);
    case "5": return enterContacts(s);
    case "6": return enterMyReports(s);
    case "7": return enterSettings(s);
    default: return enterMain(s);
  }
}

// ---------------------------------------------------------------- lists and items
function enterSections(s) {
  s.state = "SECTIONS";
  return menu(t(s.lang, "sections_title"), [
    ...CATEGORIES.map((c, i) => ({ key: String(i + 1), label: t(s.lang, "cat_" + c) })),
    { key: "0", label: t(s.lang, "menu") },
  ]);
}
function onSections(s, v) {
  if (v === "0") return enterMain(s);
  const cat = CATEGORIES[Number(v) - 1];
  if (!cat) return enterSections(s);
  return enterList(s, { title: t(s.lang, "cat_" + cat), items: itemsFor(s.country, s.area, { category: cat }), state: "LIST", empty: "list_empty", back: "SECTIONS" });
}
function enterList(s, { title, items, state, empty, back = "MAIN", page = 0 }) {
  s.state = state;
  s.data.list = { items, title, back, page, empty };
  if (!items.length) return startReading(s, t(s.lang, empty));
  const L = (k) => t(s.lang, k);
  const nav = [{ key: "0", label: L("menu") }];
  const slice = items.slice(page * 5, page * 5 + 5);
  const labelBudget = Math.max(14, Math.floor((config.screenMax - title.length - footerCost(nav) - 12) / slice.length) - 3);
  const menuItems = slice.map((it, i) => ({ key: String(i + 1), label: truncate(localise(it, s.lang).title, labelBudget) }));
  if (items.length > (page + 1) * 5) menuItems.push({ key: "9", label: L("more") });
  menuItems.push(...nav);
  return menu(title, menuItems);
}
function onList(s, v) {
  const l = s.data.list;
  if (v === "0") return enterMain(s);
  if (v === "9") return enterList(s, { ...l, state: s.state, page: l.page + 1 });
  const item = l.items[l.page * 5 + Number(v) - 1];
  if (!item) return enterList(s, { ...l, state: s.state });
  return showItem(s, item, () => enterList(s, { ...l, state: l.back === "SECTIONS" ? "LIST" : "FRONT" }));
}
export function itemText(s, item) {
  const L = localise(item, s.lang);
  return `${L.title}. ${L.body} ${t(s.lang, "what_to_do")}: ${L.action} ${t(s.lang, "source")}: ${item.source_name}, ${formatDate(item.source_date)}.`;
}
function showItem(s, item, back) {
  return startReading(s, itemText(s, item), {
    lastItems: [{ key: "9", label: t(s.lang, "back") }],
    onLast: (k) => (k === "9" ? back() : null),
  });
}

// ---------------------------------------------------------------- rumour check
async function onCheck(s, claim) {
  if (!claim) return enterMain(s);
  const items = itemsForCountry(s.country);
  const clusters = db.publicClustersInArea.all(s.country, s.area, config.clusterPublicThreshold);
  const out = await checkRumor({ claim, items, clusters, languageName: languageName(s.lang) });
  const item = out.item_id ? getItem(out.item_id) : null;
  const cluster = out.cluster_id ? clusters.find((c) => c.id === out.cluster_id) : null;
  db.logRumor.run({ user_hash: s.userHash, country: s.country, area: s.area, lang: s.lang, claim, verdict: out.verdict, item_id: out.item_id, reply: out.reply });

  let text = t(s.lang, "verdict_" + out.verdict) + ". " + (out.reply || t(s.lang, "check_unverified_fallback"));
  if (item) text += ` ${t(s.lang, "source")}: ${item.source_name}, ${formatDate(item.source_date)}.`;
  if (cluster) text += " " + t(s.lang, "check_reports_note", { n: cluster.count });
  if (out.safety_concern) {
    const c = contactsFor(s.country, s.area, "emergency")[0];
    if (c) text += " " + t(s.lang, "report_danger", { contact: `${c.name} ${c.number}` });
  }
  const lastItems = [{ key: "1", label: t(s.lang, "check_report_it") }];
  if (item) lastItems.push({ key: "2", label: t(s.lang, "check_read_source") });
  s.data.pendingReport = { text: claim, category: "rumor" };
  return startReading(s, text, {
    lastItems,
    onLast: (k) => {
      if (k === "1") { s.data.report = { ...s.data.pendingReport }; return enterReportArea(s); }
      if (k === "2" && item) return showItem(s, item, () => enterMain(s));
      return null;
    },
  });
}

// ---------------------------------------------------------------- report desk
function enterReportCat(s) {
  s.state = "REPORT_CAT"; s.data.report = {};
  return menu(t(s.lang, "report_cat_title"), [
    ...REPORT_CATS.map((c, i) => ({ key: String(i + 1), label: t(s.lang, "rcat_" + c) })),
    { key: "0", label: t(s.lang, "menu") },
  ]);
}
function onReportCat(s, v) {
  if (v === "0") return enterMain(s);
  const cat = REPORT_CATS[Number(v) - 1];
  if (!cat) return enterReportCat(s);
  s.data.report.category = cat;
  return enterReportArea(s);
}
function enterReportArea(s) {
  s.state = "REPORT_AREA";
  return menu(t(s.lang, "report_area_confirm", { area: areaName(s.area) }), [
    { key: "1", label: t(s.lang, "yes") }, { key: "2", label: t(s.lang, "change") }, { key: "0", label: t(s.lang, "menu") },
  ]);
}
function onReportArea(s, v) {
  if (v === "0") return enterMain(s);
  if (v === "2") { s.data.afterArea = "REPORT_TEXT"; s.data.country = s.country; return enterArea(s, 0); }
  return enterReportText(s);
}
function enterReportText(s) {
  if (s.data.report?.text) return enterReportWhen(s);
  s.state = "REPORT_TEXT";
  return input(t(s.lang, "report_text_prompt"));
}
function onReportText(s, v) {
  if (!v) return enterReportText(s);
  s.data.report.text = v;
  return enterReportWhen(s);
}
function enterReportWhen(s) {
  s.state = "REPORT_WHEN";
  return menu(t(s.lang, "report_when_title"), [
    { key: "1", label: t(s.lang, "when_now") }, { key: "2", label: t(s.lang, "when_today") }, { key: "3", label: t(s.lang, "when_week") },
  ]);
}
async function onReportWhen(s, v) {
  const when = { 1: "now", 2: "today", 3: "week" }[v];
  if (!when) return enterReportWhen(s);
  const r = s.data.report;
  const ref = shortRef(s.area.split("-")[1] || "GK");
  const id = db.createReport({ ref, user_hash: s.userHash, country: s.country, area: s.area, category: r.category, text: r.text, when_text: when, lang: s.lang });
  scheduleTriage(id, { text: r.text, category: r.category, country: s.country, area: s.area, lang: s.lang });

  let text = t(s.lang, "report_done", { ref });
  if (r.category === "safety" || when === "now") {
    const c = contactsFor(s.country, s.area, "emergency")[0] || contactsFor(s.country, s.area)[0];
    if (c) text += " " + t(s.lang, "report_danger", { contact: `${c.name} ${c.number}` });
  }
  s.data.report = {};
  return startReading(s, text, {
    lastItems: [{ key: "1", label: t(s.lang, "menu_contacts") }],
    onLast: (k) => (k === "1" ? enterContacts(s) : null),
  });
}
// Runs after the USSD response has gone out. Never blocks a screen.
function scheduleTriage(id, { text, category, country, area, lang }) {
  setImmediate(async () => {
    try {
      const openClusters = db.openClustersInArea.all(country, area);
      const out = await triageReport({ text, category, languageName: languageName(lang), areaName: areaName(area), openClusters });
      const clusterId = db.attachToCluster({ existingId: out.existing_cluster_id, country, area, category: out.category, title: out.new_cluster_title });
      db.updateReportAi.run({ id, text_en: out.text_en, urgency: out.urgency, ai_category: out.category, cluster_id: clusterId });
    } catch (err) { console.error("[triage] failed for report", id, err.message); }
  });
}

// ---------------------------------------------------------------- contacts, my reports, settings
function enterContacts(s) {
  const list = contactsFor(s.country, s.area);
  const lines = list.map((c) => `${c.name}: ${c.number} (${t(s.lang, "contacts_verified", { date: formatDate(c.lastVerified) })})`);
  const text = `${t(s.lang, "contacts_title", { country: t(s.lang, "country_" + s.country) })}. ` + lines.join(". ") + ".";
  return startReading(s, text);
}
function enterMyReports(s) {
  const rows = db.listUserReports.all(s.userHash);
  if (!rows.length) return startReading(s, t(s.lang, "myreports_empty"));
  const statusOf = (r) => r.cluster_status === "verified" ? "status_verified" : r.cluster_status === "dismissed" ? "status_dismissed" : r.status === "triaged" ? "status_triaged" : "status_new";
  const lines = rows.map((r) => `${r.ref} ${formatDate(r.created_at)}: ${t(s.lang, statusOf(r))}`);
  return startReading(s, `${t(s.lang, "myreports_title")}. ` + lines.join(". ") + ".");
}
function enterSettings(s) {
  s.state = "SETTINGS";
  return menu(t(s.lang, "settings_title"), [
    { key: "1", label: t(s.lang, "settings_lang") }, { key: "2", label: t(s.lang, "settings_area") }, { key: "0", label: t(s.lang, "menu") },
  ]);
}
function onSettings(s, v) {
  if (v === "1") return enterLang(s);
  if (v === "2") return enterCountry(s);
  return enterMain(s);
}

export function errorScreen(lang = "en") { return end(t(lang, "error")); }
