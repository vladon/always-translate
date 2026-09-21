"use strict";

const API = typeof browser !== "undefined" ? browser : chrome;

// Strings resolve against the Firefox UI language (_locales/<lang>), en_US fallback.
const msg = (key, args) => API.i18n.getMessage(key, args) || key;

// Target languages come from langs.js (TARGET_LANGS: [code, nativeName, englishName]),
// mirroring the Google Translate service the extension uses.

let selected = null;
let state = { kind: "idle" };

async function getActiveTabId() {
  let tabs = await API.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    tabs = await API.tabs.query({ active: true, lastFocusedWindow: true });
  }
  return tabs.length ? tabs[0].id : null;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    return { ok: false, error: msg("errNoTab") };
  }
  try {
    return await API.tabs.sendMessage(tabId, message);
  } catch (e) {
    return { ok: false, error: msg("errRefresh") };
  }
}

async function refresh() {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    return;
  }
  const resp = await API.runtime.sendMessage({ type: "at:get-state", tabId }).catch(() => null);
  if (resp && resp.state) {
    state = resp.state;
  }
  render();
}

function render() {
  const statusEl = document.getElementById("status");
  const action = document.getElementById("action");
  const kind = state.kind || "idle";

  let text = "";
  let busy = false;
  switch (kind) {
    case "progress":
      text = msg("titleProgress", [state.total ? Math.round(state.done / state.total * 100) : 0]);
      busy = true;
      break;
    case "done":
      text = msg("titleDone", [state.from, state.to]);
      break;
    case "error":
      text = msg("statusError", [state.message || msg("errorUnknown")]);
      break;
    case "same":
      text = msg("statusSame");
      break;
    case "nothing":
      text = msg("statusNothing");
      break;
    default:
      text = msg("popupHint");
  }

  statusEl.textContent = text;
  statusEl.classList.toggle("error", kind === "error");
  action.disabled = busy;
  action.classList.toggle("restore", kind === "done");
  action.textContent = busy ? msg("btnTranslating") : (kind === "done" ? msg("btnShowOriginal") : msg("btnTranslate"));

  for (const btn of document.querySelectorAll("button.chip")) {
    btn.classList.toggle("selected", btn.dataset.lang === selected);
  }
}

function buildLangs(filter) {
  const grid = document.getElementById("langs");
  grid.textContent = "";
  const q = (filter || "").trim().toLowerCase();
  for (const [code, native, english] of TARGET_LANGS) {
    if (q && !native.toLowerCase().includes(q) && !english.toLowerCase().includes(q) && !code.toLowerCase().startsWith(q)) {
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.lang = code;
    btn.textContent = native;
    btn.title = english + " (" + code + ")";
    btn.addEventListener("click", () => {
      selected = code;
      API.storage.local.set({ targetLang: code }).catch(() => {});
      render();
    });
    grid.appendChild(btn);
  }
}

(async () => {
  const uiLang = API.i18n.getUILanguage();
  document.documentElement.lang = uiLang;
  if (["ar", "he", "fa"].includes(uiLang.split("-")[0].toLowerCase())) {
    document.documentElement.dir = "rtl";
  }
  document.getElementById("title").textContent = msg("popupTitle");
  document.title = msg("popupTitle");
  document.getElementById("action").textContent = msg("btnTranslate");

  const searchEl = document.getElementById("search");
  searchEl.placeholder = msg("popupSearch");
  searchEl.addEventListener("input", () => buildLangs(searchEl.value));

  buildLangs();

  const stored = await API.storage.local.get("targetLang").catch(() => ({}));
  if (stored.targetLang) {
    selected = stored.targetLang;
  } else {
    const resp = await API.runtime.sendMessage({ type: "at:get-state" }).catch(() => null);
    selected = (resp && resp.targetLang) || "en";
  }

  await refresh();
  setInterval(refresh, 500);

  document.getElementById("action").addEventListener("click", async () => {
    if (state.kind === "progress") {
      return;
    }
    if (state.kind === "done") {
      await sendToActiveTab({ type: "at:restore" });
    } else if (selected) {
      await API.runtime.sendMessage({ type: "at:translate-page", lang: selected }).catch(() => {});
    }
    setTimeout(refresh, 300);
  });
})();
