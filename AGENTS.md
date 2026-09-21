# Repository Guidelines — Always Translate

Firefox MV2 WebExtension: always-visible translate button in the address bar, one-click in-place page translation via Google Translate. Plain JavaScript, **no build step, no dependencies, no tests, no CI** (verified — don't scaffold unprompted). Target: Firefox 140+.

## Layout

| Path | Purpose |
|---|---|
| `manifest.json` | MV2 manifest, version, gecko id `always-translate-extension@vladon.dev` |
| `background.js` | page-action lifecycle, per-tab state machine (icon/title), translation proxy to `translate.googleapis.com`, popup message router |
| `content.js` | text-node collection (incl. shadow roots), batched translation, progress pill + toasts, restore |
| `popup/` | language picker (24 target languages, native names) + status |
| `_locales/` | UI translations, 24 locales; `en_US` is `default_locale` |
| `icons/` | icon states (idle/progress×2/done/error) |

## Code conventions

- **Every user-facing string MUST go through i18n.** Use the `msg(key, args)` helper (defined in `background.js`, `content.js`, `popup/popup.js`) backed by `_locales/<locale>/messages.json`. Never hardcode user-visible text. The 24 locale files must stay key-complete — the generator/validation approach lives in git history (`ad741ac`).
- Commit style: conventional prefixes — `feat:`, `fix:`, `chore:`, `docs:`. Push straight to `main`.
- Git's `LF will be replaced by CRLF` warnings on commit are normal on this box; ignore.

## Release runbook — follow the order exactly

**Hard AMO facts (learned the hard way):**

- A version number is **globally unique per addon across listed AND unlisted channels**.
- A **deleted version number can never be reused** ("was uploaded before and deleted").
- Therefore every number is burned forever once used anywhere. **Burned so far: 1.1.2, 1.1.3, 1.1.4 (store-approved). 1.1.5 = this release. Next free: 1.1.6.**
- The store (listed) and GitHub releases share the **same build**: submit listed to AMO first, attach the approved signed file to GitHub after approval. Unlisted signing is no longer used.

**Steps:**

1. **Bump** `version` in `manifest.json` to the next free number. Commit `chore: bump version to X` and push.
2. **Lint:** `npx web-ext lint` — expect 0 errors; the single `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` warning is known and acceptable.
3. **Build:** `npx web-ext build` → `web-ext-artifacts/always_translate-X.Y.Z.zip`.
4. **Submit to AMO listed channel** (API cannot do listed — DevHub UI only, needs the user's AMO login in a spawned visible browser; a CAPTCHA may appear on first load):
   - `/developers/addon/always-translate/versions/submit/` — the wizard **silently preselects the unlisted channel**. Click `Change` → radio `On this site` → `Continue` (URL must become `.../submit/upload-listed`).
   - Upload the zip; AMO validates via AJAX (the file input clears itself — that is normal). Success markers: `See full validation report` link + hidden `input[name="upload"]` holding the uuid.
   - `Continue` → details step: fill **Release Notes** (`release_notes_en-us`) and **Notes to Reviewer** (`approval_notes` — disclose Google Translate data flow + source repo).
   - Source code step: answer **No** (plain unminified JS) → `Continue` → "You're done".
   - Quirks: use native AX clicks (isolated-world DOM clicks do nothing on zamboni); a transient 502 resets wizard state — just redo the flow.
5. **Wait for approval and verify** via AMO API v5 (JWT HS256, `iss` = key, `jti` = random uuid, `exp` ≤ 300 s; key `user:6619292:803` — the **secret is not stored anywhere, ask the user**):
   `GET /api/v5/addons/addon/always-translate-extension%40vladon.dev/versions/<ver>/`
   Done when `file.status === "public"`.
6. **Download** `file.url` (approved listed files need no auth), save as `web-ext-artifacts/always_translate-X.Y.Z-signed.xpi`, verify **sha256** equals the API's `file.hash`.
7. **GitHub release:** `gh release create vX.Y.Z <signed.xpi> --repo vladon/always-translate --target main --title "vX.Y.Z — <summary>" --notes <bullets + "sha256: ...">`. Same content as the store release notes.

**If unlisted signing is ever needed again:** `web-ext sign` is broken ("Error decoding signature" with valid credentials). Use the API directly: `POST /api/v5/addons/upload/` as multipart with fields `upload` (file) + `channel`, then `POST /api/v5/addons/addon/<guid>/versions/` with `upload=<uuid>&channel=unlisted`. Remember the version number gets burned too.

## Current state (2026-09-22)

- AMO store: **1.1.4** approved (`addons.mozilla.org/firefox/addon/always-translate`); **1.1.5** (i18n + 188 target languages + new icon) — listed submission in progress.
- GitHub: release **v1.1.4** (Latest) with the store build; v1.1.2, v1.1.0 as older releases. v1.1.5 follows after store approval.
- Unlisted: 1.1.3 signed but never published on GitHub; 1.1.2 deleted from AMO (GitHub v1.1.2 asset still installs fine).

## i18n pipeline (added in 1.1.5)

- **Target languages**: `popup/langs.js` — `[code, nativeName, englishName]` triples mirroring Google Translate's NMT language table (<https://cloud.google.com/translate/docs/languages>). Order: `ru`, `en`, then by speaker popularity, long tail alphabetical. Extend by appending entries; the popup renders them with a search filter (native/English/code substring).
- **UI locales**: `_locales/` covers 93 locales — every Firefox UI locale (verified against <https://releases.mozilla.org/pub/firefox/releases/<ver>/win64/xpi/>) except `ach`, `cak`, `trs`, `sat`, which intentionally fall back to English (no reliable translation available; help wanted).
- **Every locale file carries the same key set** (24 keys incl. `popupSearch`); key/placeholder parity is validated by the assembler (git history `887eee2`-adjacent, `.scratch/assemble.mjs` pattern: scan `$NAME$` placeholders → `placeholders: {name: {$N}}`).
- **Icon set**: `icons/icon-*.png` (32–128) rendered from `icons/icon.svg` via ImageMagick (`magick -background none icon.svg -resize NxN icon-N.png`). Path-only SVG — never use `<text>` in icons (font-dependent). Address-bar state icons stay `translate*.svg`.

## Testing & QA

No automated tests. Verify UI changes against real Firefox: load as temporary add-on (`about:debugging` or `web-ext run`); for headless DOM/i18n assertions a WebDriver BiDi client against `firefox -remote-debugging-port 9333 -remote-allow-system-access` works well (install via `webExtension.install`, scrape the moz-extension UUID from `about:debugging#/runtime/this-firefox`, open `moz-extension://<uuid>/popup/popup.html` as a tab).
