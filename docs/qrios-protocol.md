# Qrios USSD callback protocol (as implemented)

Source: Qrios "USSD API documentation" OpenAPI 1.6.0. Qrios calls **our** server; we never call Qrios for a dialled session.

| Event | Qrios POSTs to | Body highlights | We answer |
|---|---|---|---|
| Session start | `/ussdSessionEvent/new` | `sessionId`, `msisdn`, `operator` (mtn/airtel/glo/etisalat), `input.type` = `Dial` (with `shortcodeString`), `Push` or `Redirect` | 200 + `UssdSessionCommand` |
| User input | `/ussdSessionEvent/continue` | `sessionId`, `result.type` = `InputResult`, `result.value` (raw text), `contextData` | 200 + `UssdSessionCommand` |
| Graceful close | `/ussdSessionEvent/close` | `reason.type` = `End` / `Abandon` / `Timeout` | 204 |
| Abort | `/ussdSessionEvent/abort` | `reason.type` = `InternalError` etc. | 204 |

Optional `Authorization` header carries the secret configured on the Qrios app. Set `QRIOS_AUTH_SECRET` to enforce it.

## Response shape

```json
{ "action": { "type": "ShowView", "view": { ... } }, "contextData": "gaskiya" }
```

| View | Fields | Session |
|---|---|---|
| `ChooserView` | `title`, `items[] {accessKey, label}`, optional `separator` | continues. **Qrios rejects invalid choices itself** and re-prompts, so `result.value` always matches an `accessKey`. |
| `InputView` | `message` | continues, free text comes back in `result.value` |
| `InfoView` | `message` | ends. Qrios then POSTs `/close` with `End`. |

`contextData` is required on every response and echoed back on the next request. We keep state server-side keyed by `sessionId`, so it is a constant.

## Limits we design for

- Operators end sessions after about two minutes: every screen must render in well under a second, so no model call happens on a screen except the rumour check and the one-off "Other language" translation.
- Screen size is not specified by Qrios; handsets commonly show 160 to 182 characters. We budget 160 (`USSD_SCREEN_MAX`).
- Character set is effectively GSM 7-bit basic on many handsets: all screen text is plain ASCII.

## Mapping in code

`src/ussd/adapters.js` turns a gateway-agnostic screen (`menu` / `input` / `end`) into the Qrios JSON. `POST /ussd/at` shows the same app on an Africa's Talking-style plain-text gateway, which is how the service moves to a country where Qrios does not operate.
