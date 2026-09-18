// Drives the state machine directly (no HTTP) and asserts the USSD contract:
// every screen fits the budget, every key on screen is handled, flows end where expected.
process.env.DB_PATH = "./data/test.db";
process.env.DEEPSEEK_API_KEY = ""; // force deterministic fallbacks
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

before(() => { for (const f of ["./data/test.db", "./data/test.db-wal", "./data/test.db-shm"]) fs.rmSync(f, { force: true }); });

const { paginate } = await import("../src/ussd/paginate.js");
const { start, handle } = await import("../src/ussd/router.js");
const { createSession } = await import("../src/ussd/session.js");
const { screenLength, toQrios } = await import("../src/ussd/adapters.js");
const { config } = await import("../src/config.js");

const fits = (screen) => assert.ok(screenLength(screen) <= config.screenMax, `screen too long (${screenLength(screen)}): ${JSON.stringify(screen)}`);
const keys = (screen) => screen.items.map((i) => i.key);

async function drive(userHash, inputs) {
  const s = createSession("t-" + Math.random(), { userHash });
  let screen = await start(s);
  fits(screen);
  for (const v of inputs) {
    if (screen.kind === "menu") assert.ok(keys(screen).includes(v), `key ${v} not on screen: ${JSON.stringify(screen)}`);
    screen = await handle(s, v);
    fits(screen);
  }
  return { s, screen };
}

test("paginate cuts on sentence boundaries and never splits words", () => {
  const text = "First sentence here. Second sentence is a bit longer than the first one. Third one ends it all now.";
  const pages = paginate(text, 60);
  assert.ok(pages.length >= 2);
  for (const p of pages) { assert.ok(p.length <= 60); assert.ok(!p.startsWith(" ")); }
  assert.equal(pages.join(" "), text);
});

test("new user: language -> country -> area -> main menu", async () => {
  const { screen } = await drive("u1", ["1", "1", "2"]);
  assert.equal(screen.kind, "menu");
  assert.match(screen.title, /Kano/);
  assert.deepEqual(keys(screen), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("returning user skips onboarding", async () => {
  await drive("u2", ["1", "1", "1"]);
  const { screen } = await drive("u2", []);
  assert.match(screen.title, /Lagos/);
});

test("front page item reads across pages and ends with source line", async () => {
  const { s, screen } = await drive("u3", ["1", "1", "2", "1", "1"]);
  let cur = screen, guard = 0;
  while (keys(cur).includes("1") && cur.items.find((i) => i.key === "1").label === "More" && guard++ < 10) { cur = await handle(s, "1"); fits(cur); }
  assert.match(cur.title, /Source: .*\d{1,2} Sept?/);
  assert.ok(keys(cur).includes("9"), "last page offers Back");
});

test("rumour check falls back to UNVERIFIED and offers to report", async () => {
  const { s, screen } = await drive("u4", ["1", "1", "2", "3", "Kano curfew removed completely they said"]);
  assert.match(screen.title, /^UNVERIFIED/);
  let cur = screen, guard = 0;
  while (cur.items[0]?.label === "More" && guard++ < 5) cur = await handle(s, "1");
  assert.ok(keys(cur).includes("1"), "offers Report it");
  const next = await handle(s, "1");
  assert.match(next.title, /Where\?/);
});

test("report desk saves a report, shows a reference and an emergency contact", async () => {
  const { screen } = await drive("u5", ["1", "1", "3", "4", "1", "1", "Armed men seen near the market gate", "1"]);
  assert.match(screen.title, /Reference BO-\d{4}/);
  assert.match(screen.title, /112/);
  fits(screen);
});

test("every UI screen in the main flows renders under budget in the Qrios shape", async () => {
  const { s } = await drive("u6", ["1", "1", "4"]);
  for (const k of ["1", "2", "5", "6", "7"]) {
    const sc = await handle(s, k); fits(sc);
    const q = toQrios(sc);
    assert.equal(q.action.type, "ShowView");
    assert.ok(["ChooserView", "InputView", "InfoView"].includes(q.action.view.type));
    await handle(s, "0");
  }
});
