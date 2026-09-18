# Gaskiya

**A daily civic brief on USSD. Sourced, dated, in your language, with a next step on every item.**

*Gaskiya* is Hausa for "truth", after the historic newspaper *Gaskiya Ta Fi Kwabo*: "truth is worth more than a penny." It is an entry in the OSF x Andela hackathon *Information you can trust*, cross-track between **Stability & Social Cohesion** and **Safety, Reporting & Protection**.

Dial a shortcode on any phone, including a feature phone with no data, and read today's verified notices for your area: curfew changes, aid distribution points, vaccination drives, registration deadlines, peace-committee sittings. Every item names its source and date and ends with what to do next. Two options make it more than a newspaper: **Check something you heard** tests a rumour against trusted notices, and **Report what you are seeing** feeds a moderator desk that verifies reports and publishes them back to the front page.

```
*384*1#
Gaskiya - Choose language
1 English  2 Francais  3 Arabic  4 Portugues
5 Kiswahili  6 Hausa  7 Yoruba  8 Igbo  9 Other

Gaskiya Kano
1 Today for my area        4 Report what you are seeing
2 Sections                 5 Help contacts
3 Check something you heard 6 My reports   7 Language / area
```

## Why USSD

| Brief constraint | How Gaskiya answers it |
|---|---|
| Low bandwidth, basic devices | USSD works on every GSM phone with no data plan. Long items paginate across up to five screens with a "More" key. |
| Accessibility and inclusion | Numbered menus, one free-text step at most, plain ASCII so it renders on any handset. |
| Multilingual access | Eight fixed languages plus **Other**: type any language name and the interface is localised on the spot by DeepSeek and cached. Arabic and Yoruba/Igbo are written in the phone-friendly Latin forms people already type. |
| Trust and verification | Every item shows source name and date. The rumour checker defaults to UNVERIFIED and may only say CONFIRMED or NOT TRUE when it can cite a specific trusted item. |
| Privacy and security | Phone numbers are salted-hashed before storage. Reports carry no name. Clusters only become visible to users above a threshold of five reports. Reports auto-purge after 90 days. |
| Local relevance | Countries, areas, contacts and notices are data files. Adding a country is editing JSON, not code. |
| Clear next steps | Every item has a mandatory "What to do" line. Safety reports show an emergency contact immediately. |

## How it works

```
 phone --USSD--> Qrios gateway --POST /ussdSessionEvent/*--> Gaskiya (Node + SQLite on Fly.io)
                                                                |
   src/ussd/router.js   state machine, pagination, screens      |
   src/ussd/adapters.js Qrios JSON | Africa's Talking plain text |
   src/content/*        seed notices, areas, contacts, generated translations
   src/ai/*             DeepSeek (deepseek-flash): localise, verify rumours, triage reports
   public/dashboard     moderator desk: clusters -> verify -> publish
```

**Where the model runs and where it does not**

- *Offline, in batch:* `npm run generate` localises the UI strings and every notice into the eight languages with a strict screen-length budget. Nothing in a live session waits on this.
- *Live, two places only:* the rumour check (one structured-output call, low effort) and the one-off translation when someone picks **Other** language. Both have deterministic fallbacks, so the line keeps working if the API is down or no key is set.
- *After the response is sent:* report triage. The model translates the report to English, strips personal names, sets urgency, and either joins it to an existing cluster or opens a new one. Moderators, not the model, decide what gets verified and published.

## Run it locally

```bash
cd gaskiya
npm install
cp .env.example .env        # add DEEPSEEK_API_KEY to enable AI; works without it
npm run generate            # localise strings + notices into 8 languages (needs key; resumable)
npm run generate -- --db    # translate items published from the dashboard while AI was off
npm start                   # http://localhost:8080
```

- `/` is a phone simulator that drives the real Qrios endpoints and shows the JSON exchange.
- `/dashboard` is the moderator desk.
- `npm test` runs the state-machine tests. `npm run eval` scores the rumour checker against `eval/claims.json`.

## Connect to Qrios

Create a USSD app on the Qrios console and set its callback base URL to your deployment. Qrios will POST to `/ussdSessionEvent/new`, `/continue`, `/close` and `/abort`. Set `QRIOS_AUTH_SECRET` to the value configured on the Qrios app to require it on every callback. Protocol notes: `docs/qrios-protocol.md`.

## Deploy to Fly.io

```bash
fly launch --no-deploy --copy-config --name gaskiya
fly volumes create gaskiya_data --size 1 --region lhr
fly secrets set DEEPSEEK_API_KEY=sk-... MSISDN_SALT=$(openssl rand -hex 24) DASHBOARD_TOKEN=$(openssl rand -hex 12)
fly deploy
```

`fly.toml` keeps one machine always warm because a cold start would exceed the USSD step timeout.

## Add a country or region

1. Add the country and its areas to `src/content/areas.json`.
2. Add verified help lines with `lastVerified` dates to `src/content/contacts.json`.
3. Add notices to `src/content/seeds.json` or publish them from the dashboard.
4. Add `country_XX` to `src/i18n/en.json` and rerun `npm run generate`.
5. If the local gateway is not Qrios, add a ten-line adapter in `src/ussd/adapters.js`. An Africa's Talking-style endpoint already exists at `POST /ussd/at`.

## Trust and accuracy

- **Content provenance.** Every item stores `source_name`, `source_date` and `source_url`, and the first two are rendered on screen.
- **Verdict guard.** The rumour checker's JSON output must name a real item id for any verdict other than UNVERIFIED, and the server re-checks that id exists. A community cluster can never confirm anything; it is shown as "N people reported something similar. Not yet verified."
- **Human in the loop.** Reports become front-page items only when a moderator writes the verified text and names the source.
- **Eval.** `eval/claims.json` holds 40 claims with expected verdicts. `npm run eval` reports accuracy and, more importantly, the false-confirmed rate. Live run with `deepseek-flash` on 18 Sep 2026: 97.5% accuracy, zero false confirmations, about 1.2 s per check. Details in `AI_USAGE.md`.

## Sample content notice

The notices in `src/content/seeds.json` and the help lines in `contacts.json` are **sample data for the proof of concept**, modelled on the kind of notices these institutions publish, with realistic dates and sources. They are not live scraped data. The production path is a daily ingestion job that reads official feeds into the same item shape; the dashboard shows a banner while sample mode is on.

## Project layout

```
src/server.js          Express: Qrios callbacks, Africa's Talking endpoint, moderator API
src/ussd/router.js     state machine (language, area, front page, sections, check, report, contacts)
src/ussd/paginate.js   sentence-aware screen splitting
src/ussd/adapters.js   gateway adapters
src/ussd/session.js    in-memory sessions (2-minute operator limit)
src/ai/                DeepSeek client (OpenAI-compatible), translation, rumour check, report triage
src/content/           areas, contacts, seed notices, generated translations, store
src/i18n/              UI strings per language
src/db.js              SQLite schema and queries
scripts/               generate-content.js, eval-rumor.js
public/                simulator and dashboard
test/                  node:test suite
```

## Licence

MIT.
