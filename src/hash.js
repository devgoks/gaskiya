import crypto from "node:crypto";
import { config } from "./config.js";

// Phone numbers never touch the database. We store a salted SHA-256 instead.
// Normalise first so +234..., 234... and 0... all map to the same user.
export function normaliseMsisdn(msisdn = "") {
  let d = String(msisdn).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = "234" + d.slice(1); // Nigerian local format
  if (d.length === 10) d = "234" + d; // bare 10 digits (Qrios format list)
  return d;
}

export function hashMsisdn(msisdn) {
  return crypto.createHash("sha256").update(config.msisdnSalt + ":" + normaliseMsisdn(msisdn)).digest("hex").slice(0, 32);
}

export function shortRef(prefix = "GK") {
  return `${prefix}-${crypto.randomInt(1000, 9999)}`;
}
