# How AI was used

Two different things: AI as the tool that built Gaskiya, and AI as a component inside Gaskiya.

## 1. AI coding tools built it

Gaskiya was built with **Claude Code** (Claude Fable 5.1) in a single day, by one person. The concept, the USSD channel, the paginated "newspaper" format, the language list and the report desk were the author's; the coding assistant implemented them.

**Build stage.** Claude Code:
- fetched the Qrios developer guide and the pasted OpenAPI spec and implemented the exact callback protocol (`ChooserView` uses `title`, gateway-side validation of choices, `contextData` required, 204 on close);
- read the Qrios and DeepSeek documentation before writing integration code, so the JSON-mode calls follow DeepSeek's documented requirements (the word "json" and an example shape in the prompt, retry on empty content) and are validated with Zod;
- wrote the state machine, pagination, adapters, SQLite layer, AI modules, simulator, dashboard, generator, eval, Dockerfile, Fly config and tests;
- drove a full session over HTTP with curl against the real endpoints before writing any UI, and fixed what it found;
- wrote a `node:test` suite that asserts every screen fits the 160-character budget and every key shown is handled.

**Conventions for future sessions** live in `CLAUDE.md`.

## 2. DeepSeek runs inside the product

Model: **DeepSeek Flash** (`deepseek-flash`) through DeepSeek's OpenAI-compatible endpoint using the `openai` client. Every call uses JSON output mode (`response_format: json_object`) with an example shape in the prompt, and the result is validated against a Zod schema before use; invalid or empty output is retried once, then the deterministic fallback takes over. Temperature is 0 to 0.2 and calls are short because USSD steps time out in seconds.

| Job | When | Guard rails |
|---|---|---|
| Localise UI strings into 8 languages | offline batch (`npm run generate`) | ASCII-only rule for GSM handsets, length cap 1.2x English, placeholders preserved, defensive `asciiFold` on output |
| Localise each notice | offline batch, and background on publish | title <= 40, body <= 400, action <= 140 chars; "drop filler, never facts" |
| Localise UI for an unlisted language ("Other") | live, once per language, then cached | falls back to English with an honest message if unavailable |
| Rumour check | live, one call | must cite a real item id for any non-UNVERIFIED verdict, server re-validates; community clusters can never confirm; keyword fallback when offline |
| Report triage | after the USSD response is sent | translate to English, strip private names, set urgency, join or open a cluster; moderator decides publication |

**What the model never does:** invent a notice, publish anything, or see a phone number.

## 3. Measuring it

`npm run eval` runs 40 claims from `eval/claims.json` through the rumour checker and reports accuracy and the false-confirmed rate (claims a human would call UNVERIFIED that the system confirmed or contradicted). For a trust tool the second number matters more than the first. Results are saved under `eval/results/`.

Live result on 18 September 2026 with `deepseek-flash`:

| Metric | Value |
|---|---|
| Claims | 40 |
| Accuracy | 97.5% |
| False confirmed or contradicted | 0 |
| Wrong item cited | 0 |
| Mean latency per check | about 1.2 s |

The one miss was the safe kind: a claim the source does contradict ("you must pay to register", when the notice says aid is free) came back UNVERIFIED. The first run also exposed one mislabelled claim in the eval set, which is noted inline in `eval/claims.json`.

## 4. What went wrong and how it was fixed

Two failures during the first content generation, both caught by inspecting output rather than trusting the run:

- **Empty and truncated JSON.** DeepSeek Flash enables chain-of-thought by default at high effort and counts those tokens against `max_tokens`, so most item translations came back empty or cut off, and three languages timed out. Fix: `thinking: {type: "disabled"}` on every call (these are deterministic formatting tasks), per-call timeouts, retries with backoff, `finish_reason` checks, and a resumable generator that saves after every batch. The rerun completed all 7 languages x 15 items in under two minutes with zero warnings.
- **Language drift.** Asked for "Arabic" in Latin transliteration, the model returned Hausa for Nigerian notices and Swahili for Kenyan ones, because those are Latin-script languages of the places in the text. Fix: an explicit per-language prompt name (for example "Modern Standard Arabic written in Arabizi") and a rule that the target language never changes with the place the notice is about. Every other language pack was checked and was clean.

Both fixes and the checks that found them (ASCII-only, placeholder integrity, length budgets, non-empty fields) are now part of the generator.
