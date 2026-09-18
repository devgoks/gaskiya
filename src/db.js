import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_hash TEXT PRIMARY KEY,
  lang TEXT, country TEXT, area TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  country TEXT, area TEXT,
  category TEXT, text TEXT, when_text TEXT, lang TEXT,
  text_en TEXT, urgency TEXT, ai_category TEXT,
  cluster_id INTEGER,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT, area TEXT, category TEXT,
  title TEXT,
  count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  country TEXT, area TEXT, category TEXT,
  priority INTEGER DEFAULT 5,
  title TEXT, body TEXT, action TEXT,
  source_name TEXT, source_date TEXT, source_url TEXT,
  origin TEXT DEFAULT 'moderator',
  cluster_id INTEGER,
  published_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS item_translations (
  item_id TEXT, lang TEXT,
  title TEXT, body TEXT, action TEXT,
  PRIMARY KEY (item_id, lang)
);
CREATE TABLE IF NOT EXISTS i18n_cache (
  lang TEXT PRIMARY KEY,
  display_name TEXT,
  strings_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rumor_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_hash TEXT, country TEXT, area TEXT, lang TEXT,
  claim TEXT, verdict TEXT, item_id TEXT, reply TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- users ----------
const getUserStmt = db.prepare("SELECT * FROM users WHERE user_hash = ?");
const upsertUserStmt = db.prepare(`
  INSERT INTO users (user_hash, lang, country, area) VALUES (@user_hash, @lang, @country, @area)
  ON CONFLICT(user_hash) DO UPDATE SET
    lang = COALESCE(excluded.lang, users.lang),
    country = COALESCE(excluded.country, users.country),
    area = COALESCE(excluded.area, users.area),
    updated_at = datetime('now')`);
export const getUser = (h) => getUserStmt.get(h);
export const saveUser = (u) => upsertUserStmt.run({ lang: null, country: null, area: null, ...u });

// ---------- reports & clusters ----------
const insertReport = db.prepare(`INSERT INTO reports (ref, user_hash, country, area, category, text, when_text, lang)
  VALUES (@ref, @user_hash, @country, @area, @category, @text, @when_text, @lang)`);
export const createReport = (r) => insertReport.run(r).lastInsertRowid;
export const updateReportAi = db.prepare(`UPDATE reports SET text_en=@text_en, urgency=@urgency, ai_category=@ai_category, cluster_id=@cluster_id, status='triaged' WHERE id=@id`);
export const listReports = db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 200");
export const listUserReports = db.prepare("SELECT r.*, c.status AS cluster_status FROM reports r LEFT JOIN clusters c ON c.id = r.cluster_id WHERE r.user_hash = ? ORDER BY r.created_at DESC LIMIT 10");
export const getReport = db.prepare("SELECT * FROM reports WHERE id = ?");
export const purgeOldReports = db.prepare("DELETE FROM reports WHERE created_at < datetime('now', ?)");

export const openClustersInArea = db.prepare("SELECT * FROM clusters WHERE country = ? AND (area = ? OR area = 'ALL') AND status = 'open' ORDER BY updated_at DESC LIMIT 20");
export const publicClustersInArea = db.prepare("SELECT * FROM clusters WHERE country = ? AND (area = ? OR area = 'ALL') AND status = 'open' AND count >= ? ORDER BY count DESC LIMIT 10");
export const listClusters = db.prepare("SELECT * FROM clusters ORDER BY updated_at DESC LIMIT 200");
export const getCluster = db.prepare("SELECT * FROM clusters WHERE id = ?");
const insertCluster = db.prepare("INSERT INTO clusters (country, area, category, title, count) VALUES (?, ?, ?, ?, 1)");
const bumpCluster = db.prepare("UPDATE clusters SET count = count + 1, updated_at = datetime('now') WHERE id = ?");
export function attachToCluster({ existingId, country, area, category, title }) {
  if (existingId && getCluster.get(existingId)) { bumpCluster.run(existingId); return existingId; }
  return insertCluster.run(country, area, category, title).lastInsertRowid;
}
export const setClusterStatus = db.prepare("UPDATE clusters SET status = ?, updated_at = datetime('now') WHERE id = ?");
export const reportsInCluster = db.prepare("SELECT * FROM reports WHERE cluster_id = ? ORDER BY created_at DESC");

// ---------- items ----------
export const insertItem = db.prepare(`INSERT OR REPLACE INTO items (id, country, area, category, priority, title, body, action, source_name, source_date, source_url, origin, cluster_id)
  VALUES (@id, @country, @area, @category, @priority, @title, @body, @action, @source_name, @source_date, @source_url, @origin, @cluster_id)`);
export const dbItems = db.prepare("SELECT * FROM items ORDER BY published_at DESC");
export const upsertTranslation = db.prepare(`INSERT OR REPLACE INTO item_translations (item_id, lang, title, body, action) VALUES (?, ?, ?, ?, ?)`);
export const getTranslation = db.prepare("SELECT * FROM item_translations WHERE item_id = ? AND lang = ?");

// ---------- i18n cache (for "Other" languages) ----------
export const getI18n = db.prepare("SELECT * FROM i18n_cache WHERE lang = ?");
export const putI18n = db.prepare("INSERT OR REPLACE INTO i18n_cache (lang, display_name, strings_json) VALUES (?, ?, ?)");
export const listI18n = db.prepare("SELECT lang, display_name, created_at FROM i18n_cache");

// ---------- rumor log ----------
export const logRumor = db.prepare(`INSERT INTO rumor_checks (user_hash, country, area, lang, claim, verdict, item_id, reply) VALUES (@user_hash, @country, @area, @lang, @claim, @verdict, @item_id, @reply)`);
export const listRumors = db.prepare("SELECT * FROM rumor_checks ORDER BY created_at DESC LIMIT 200");

export const stats = () => ({
  users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
  reports: db.prepare("SELECT COUNT(*) c FROM reports").get().c,
  clusters: db.prepare("SELECT COUNT(*) c FROM clusters WHERE status='open'").get().c,
  rumors: db.prepare("SELECT COUNT(*) c FROM rumor_checks").get().c,
  published: db.prepare("SELECT COUNT(*) c FROM items").get().c,
  languages: db.prepare("SELECT COUNT(*) c FROM i18n_cache").get().c,
});
