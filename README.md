# Always Translate

[![AMO version](https://img.shields.io/amo/v/always-translate)](https://addons.mozilla.org/firefox/addon/always-translate/)
[![GitHub release](https://img.shields.io/github/v/release/vladon/always-translate)](https://github.com/vladon/always-translate/releases)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](LICENSE)

An always-visible translate button in the Firefox address bar. Pick the target language once, translate the whole page in one click — one more click restores the original.

---

## Features

- **Always visible** — the translate icon appears in the address bar on every `http`/`https` page, no fiddling with settings.
- **One-click page translation** — the whole page is translated in place, including text added dynamically (MutationObserver, open shadow roots).
- **Target language picker** — 24 languages in the popup, the choice is remembered.
- **Restore original** — click the green icon (or the popup button) to bring the page back.
- **Clear status at a glance**:

| Icon | State |
|---|---|
| blue | ready to translate |
| blinking amber | translating |
| green | translated (click to restore) |
| red | translation error |

- **Localized UI** — the popup, tooltip and in-page messages follow your Firefox interface language: 93 locales covering every Firefox interface language except a handful with no reliable translation (English fallback there). Right-to-left layout is used for Arabic, Hebrew and Persian.
- The **default target language** matches your browser language until you pick one.
- **188 target languages** — everything Google Translate supports, with in-popup search. English and Русский lead the list, the rest follows by speaker popularity.

## Install

- **Mozilla Add-ons store (recommended, gets automatic updates):** <https://addons.mozilla.org/firefox/addon/always-translate/>
- **GitHub Releases:** download the signed `.xpi` from [Releases](https://github.com/vladon/always-translate/releases) and open it with Firefox (no automatic updates on this channel).

Requires Firefox 140 or newer.

## Usage

1. Open any page — the icon appears in the address bar.
2. Click the icon, pick a target language.
3. Press **Translate** — the page is translated in place.
4. Press **Show original** (or click the green icon) to restore.

## Privacy

- Translating a page sends its **text content to Google Translate** (`translate.googleapis.com`) — that is what the extension does, and it is declared in the manifest's data-collection disclosure.
- No analytics, no tracking, no other network requests.
- Your chosen target language is stored locally (`storage.local`).

## Development

Plain WebExtension (Manifest V2), no build step, no dependencies.

```bash
npx web-ext run      # run in a temporary Firefox profile
npx web-ext lint     # validate
npx web-ext build    # produce a distributable zip
```

For manual testing load the directory as a temporary add-on via `about:debugging`.

| Path | Purpose |
|---|---|
| `background.js` | page-action lifecycle, per-tab state machine (icon/title), translation proxy, popup commands |
| `content.js` | text-node collection (incl. shadow roots), batched translation, progress pill and toasts, restore |
| `popup/` | target language picker and status |
| `_locales/` | UI translations (24 languages) |
| `icons/` | icon states |

Releases are signed by Mozilla on the AMO unlisted/listed channels and mirrored to GitHub Releases.

## License

[MPL-2.0](LICENSE)

---

## Русская версия

**Always Translate** — всегда видимая кнопка перевода в адресной строке Firefox. Выберите целевой язык один раз, переводите страницу в один клик, ещё один клик возвращает оригинал.

### Возможности

- Иконка появляется на каждой `http`/`https`-странице;
- Перевод всей страницы на месте, включая динамически добавленный текст;
- **188 целевых языков** (всё, что поддерживает Google Переводчик) с поиском по списку; Русский и English — первые, далее по популярности;
- Возврат оригинала одним кликом (зелёная иконка или кнопка попапа);
- Состояния иконки: синяя — готова, мигающая жёлтая — перевод, зелёная — переведено (клик — вернуть), красная — ошибка;
- Интерфейс попапа, подсказки и сообщения на странице — на языке интерфейса Firefox (93 локали — фактически все языки Firefox; английский как запасной; RTL для арабского, иврита и персидского);
- Целевой язык по умолчанию соответствует языку браузера.

### Установка

- Из магазина Mozilla (рекомендуется, с автообновлениями): <https://addons.mozilla.org/firefox/addon/always-translate/>
- С GitHub: скачайте подписанный `.xpi` со страницы [Releases](https://github.com/vladon/always-translate/releases) и откройте в Firefox.

Требуется Firefox 140 или новее.

### Приватность

Для перевода текст страницы отправляется в Google Переводчик (`translate.googleapis.com`). Аналитики и сторонних запросов нет, выбранный язык хранится локально.
