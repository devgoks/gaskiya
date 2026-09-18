import { config } from "../config.js";

// In-memory session store. Qrios keeps sessionId stable across a session, and
// operators drop sessions after ~2 minutes, so memory is the right home for this.
const sessions = new Map();

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(id); return null; }
  s.expires = Date.now() + config.sessionTtlMs;
  return s;
}

export function createSession(id, { userHash, operator = "", channel = "qrios" }) {
  const s = { id, userHash, operator, channel, state: "LANG", lang: "en", country: null, area: null, data: {}, read: null, expires: Date.now() + config.sessionTtlMs };
  sessions.set(id, s);
  return s;
}

export function endSession(id) { sessions.delete(id); }
export function sessionCount() { return sessions.size; }

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now > s.expires) sessions.delete(id);
}, 60_000).unref();
