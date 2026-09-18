# Gaskiya - notes for AI coding sessions

USSD civic brief for the OSF x Andela hackathon. Node 20, ES modules, Express, better-sqlite3, openai (pointed at DeepSeek).

## Rules that are not obvious from the code
- Every screen must render <= 160 chars including menu items. `test/ussd.test.js` enforces it; run `npm test` after touching `router.js`, `paginate.js` or `en.json`.
- Screen text is plain ASCII. Model prompts carry `SCREEN_RULES`; outputs pass through `asciiFold`.
- No model call on a screen except the rumour check and the one-off "Other language" translation. Anything else runs offline or after the response (`setImmediate`).
- `ChooserView` uses `title`, not `message`. Qrios validates menu choices itself. `contextData` is required on every response.
- Phone numbers never reach the DB. Use `hashMsisdn`.
- Model is DeepSeek `deepseek-flash` via the OpenAI-compatible endpoint (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`). All model calls go through `jsonCall` in `src/ai/client.js`: JSON mode + Zod validation + retries, with `thinking: {type: "disabled"}` because reasoning tokens eat `max_tokens` and leave JSON empty or truncated. Do not add other SDKs.
- Pass `LANGUAGES[i].prompt`, never `.label`, to the model. "Arabic" alone drifted into Hausa/Swahili for Nigerian/Kenyan notices.
- `npm run generate` is resumable; `--fix-budgets` redoes over-length items, `--db` backfills dashboard-published items.
- Content and contacts are sample data; keep the dashboard banner until a real ingestion job exists.

## Commands
`npm start` · `npm test` · `npm run generate` (needs key) · `npm run eval` · `fly deploy`
