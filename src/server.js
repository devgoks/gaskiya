import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import * as db from "./db.js";
import { hashMsisdn } from "./hash.js";
import { createSession, getSession, endSession, sessionCount } from "./ussd/session.js";
import * as router from "./ussd/router.js";
import { toQrios, toPlainText, screenLength } from "./ussd/adapters.js";
import { aiAvailable, MODEL } from "./ai/client.js";
import { translateItem } from "./ai/translate.js";
import { LANGUAGES, loadedPacks } from "./i18n/index.js";
import { generatedLanguages, areaName } from "./content/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(here, "..", "public")));

// ------------------------------------------------------------------ Qrios callbacks
function qriosAuth(req, res, next) {
  if (config.qriosAuthSecret && req.get("authorization") !== config.qriosAuthSecret) return res.status(401).json({ error: "unauthorized" });
  next();
}
const log = (tag, sid, screen) => console.log(`[ussd] ${tag} ${sid.slice(0, 8)} -> ${screen.kind} ${screenLength(screen)}ch`);

app.post("/ussdSessionEvent/new", qriosAuth, async (req, res) => {
  const { sessionId, msisdn, operator } = req.body || {};
  if (!sessionId || !msisdn) return res.status(400).json({ error: "sessionId and msisdn required" });
  const s = createSession(sessionId, { userHash: hashMsisdn(msisdn), operator, channel: "qrios" });
  try {
    const screen = await router.start(s);
    log("new", sessionId, screen);
    res.json(toQrios(screen));
  } catch (err) {
    console.error(err);
    res.json(toQrios(router.errorScreen(s.lang)));
  }
});

app.post("/ussdSessionEvent/continue", qriosAuth, async (req, res) => {
  const { sessionId, result } = req.body || {};
  const s = sessionId && getSession(sessionId);
  if (!s) return res.json(toQrios({ kind: "end", message: "Session expired. Please dial again." }));
  try {
    const value = result?.type === "InputResult" ? result.value : "";
    // Gateways (and eager thumbs) can send a second input before the first answer is
    // back. Chain them so one session never runs two handlers concurrently.
    const run = () => router.handle(s, value);
    const screen = await (s.lock = (s.lock || Promise.resolve()).then(run, run));
    log("continue", sessionId, screen);
    if (screen.kind === "end") endSession(sessionId);
    res.json(toQrios(screen));
  } catch (err) {
    console.error(err);
    endSession(sessionId);
    res.json(toQrios(router.errorScreen(s.lang)));
  }
});

app.post(["/ussdSessionEvent/close", "/ussdSessionEvent/abort"], qriosAuth, (req, res) => {
  const { sessionId, reason } = req.body || {};
  if (sessionId) endSession(sessionId);
  console.log(`[ussd] closed ${String(sessionId).slice(0, 8)} reason=${reason?.type}`);
  res.status(204).end();
});

// ------------------------------------------------------------------ Africa's Talking style (second gateway, plain text)
app.post("/ussd/at", express.urlencoded({ extended: false }), async (req, res) => {
  const { sessionId, phoneNumber, text = "" } = req.body || {};
  let s = getSession(sessionId);
  let screen;
  if (!s) { s = createSession(sessionId, { userHash: hashMsisdn(phoneNumber), channel: "at" }); screen = await router.start(s); }
  else { const parts = String(text).split("*"); screen = await router.handle(s, parts[parts.length - 1]); }
  if (screen.kind === "end") endSession(sessionId);
  res.type("text/plain").send(toPlainText(screen));
});

// ------------------------------------------------------------------ moderator API
function dashAuth(req, res, next) {
  if (config.dashboardToken && req.get("x-dashboard-token") !== config.dashboardToken) return res.status(401).json({ error: "unauthorized" });
  next();
}
app.get("/api/stats", dashAuth, (req, res) => res.json({ ...db.stats(), sessions: sessionCount(), ai: aiAvailable(), model: MODEL, languages_fixed: LANGUAGES.map((l) => l.code), packs: loadedPacks(), generated: generatedLanguages(), custom_languages: db.listI18n.all(), sample_content: true }));
app.get("/api/reports", dashAuth, (req, res) => res.json(db.listReports.all().map((r) => ({ ...r, area_name: areaName(r.area) }))));
app.get("/api/clusters", dashAuth, (req, res) => res.json(db.listClusters.all().map((c) => ({ ...c, area_name: areaName(c.area), reports: db.reportsInCluster.all(c.id).map((r) => ({ id: r.id, ref: r.ref, text: r.text, text_en: r.text_en, urgency: r.urgency, lang: r.lang, when_text: r.when_text, created_at: r.created_at })) }))));
app.get("/api/rumors", dashAuth, (req, res) => res.json(db.listRumors.all()));
app.get("/api/items", dashAuth, (req, res) => res.json(db.dbItems.all()));

app.post("/api/clusters/:id/dismiss", dashAuth, (req, res) => {
  db.setClusterStatus.run("dismissed", Number(req.params.id));
  res.json({ ok: true });
});

// Verify a cluster: the moderator writes (or edits the AI draft of) a sourced item and it
// goes live on the front page for that area. Translations are generated in the background.
app.post("/api/clusters/:id/verify", dashAuth, async (req, res) => {
  const c = db.getCluster.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: "no such cluster" });
  const { title, body, action, source_name, source_date, source_url = "", area = c.area, priority = 1 } = req.body || {};
  if (!title || !body || !action || !source_name) return res.status(400).json({ error: "title, body, action, source_name required" });
  const id = `mod-${c.id}-${Date.now().toString(36)}`;
  const category = router.REPORT_TO_ITEM_CAT[c.category] || "notice";
  db.insertItem.run({ id, country: c.country, area, category, priority, title, body, action, source_name, source_date: source_date || new Date().toISOString().slice(0, 10), source_url, origin: "moderator", cluster_id: c.id });
  db.setClusterStatus.run("verified", c.id);
  res.json({ ok: true, id, translating: aiAvailable() });
  if (aiAvailable()) {
    for (const l of LANGUAGES.filter((l) => l.code !== "en")) {
      translateItem({ title, body, action }, l.prompt).then((out) => out && db.upsertTranslation.run(id, l.code, out.title, out.body, out.action)).catch((e) => console.error("[translate]", l.code, e.message));
    }
  }
});

// Publish an item directly (a moderator adding a notice from a trusted source).
app.post("/api/items", dashAuth, (req, res) => {
  const { country, area = "ALL", category = "notice", priority = 3, title, body, action, source_name, source_date, source_url = "" } = req.body || {};
  if (!country || !title || !body || !action || !source_name) return res.status(400).json({ error: "country, title, body, action, source_name required" });
  const id = `mod-${Date.now().toString(36)}`;
  db.insertItem.run({ id, country, area, category, priority, title, body, action, source_name, source_date: source_date || new Date().toISOString().slice(0, 10), source_url, origin: "moderator", cluster_id: null });
  res.json({ ok: true, id });
  if (aiAvailable()) {
    for (const l of LANGUAGES.filter((l) => l.code !== "en")) {
      translateItem({ title, body, action }, l.prompt).then((out) => out && db.upsertTranslation.run(id, l.code, out.title, out.body, out.action)).catch((e) => console.error("[translate]", l.code, e.message));
    }
  }
});

app.get("/dashboard", (req, res) => res.sendFile(path.join(here, "..", "public", "dashboard.html")));
app.get("/health", (req, res) => res.json({ ok: true, ai: aiAvailable(), sessions: sessionCount() }));

// ------------------------------------------------------------------ housekeeping
function purge() {
  const n = db.purgeOldReports.run(`-${config.reportRetentionDays} days`).changes;
  if (n) console.log(`[retention] purged ${n} reports older than ${config.reportRetentionDays} days`);
}
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Gaskiya listening on :${config.port}  ai=${aiAvailable() ? MODEL : "off (no DEEPSEEK_API_KEY, using fallbacks)"}  packs=${loadedPacks().join(",")}`);
});
