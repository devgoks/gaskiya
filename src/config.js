// Central config. Everything comes from env with safe local defaults.
import fs from "node:fs";
import path from "node:path";

// Minimal .env loader so we do not need another dependency.
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const config = {
  port: Number(process.env.PORT || 8080),
  dbPath: process.env.DB_PATH || "./data/gaskiya.db",
  msisdnSalt: process.env.MSISDN_SALT || "dev-salt-change-me",
  dashboardToken: process.env.DASHBOARD_TOKEN || "",
  qriosAuthSecret: process.env.QRIOS_AUTH_SECRET || "",
  // DeepSeek, OpenAI-compatible. "deepseek-flash" is the current Flash model (DeepSeek-V4.1-Flash).
  model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
  aiBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  aiEnabled: Boolean(process.env.DEEPSEEK_API_KEY),
  // USSD screen budget. Most operators render ~160-182 chars; 160 is the safe floor.
  screenMax: Number(process.env.USSD_SCREEN_MAX || 160),
  // How many screens a single item may use before the "what to do" and source pages.
  maxBodyScreens: 3,
  // Sessions are dropped by operators after ~2 minutes. We keep state a little longer.
  sessionTtlMs: 5 * 60 * 1000,
  // Clusters become publicly visible in "Check something you heard" only above this count.
  clusterPublicThreshold: Number(process.env.CLUSTER_PUBLIC_THRESHOLD || 5),
  // Reports are purged after this many days.
  reportRetentionDays: Number(process.env.REPORT_RETENTION_DAYS || 90),
  shortcode: process.env.USSD_SHORTCODE || "*384*1#",
};
