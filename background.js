"use strict";

/*
 * Background page:
 *  - keeps the page_action icon visible on every http/https tab;
 *  - tracks per-tab translation state and reflects it in the icon/title
 *    (blue = ready, blinking amber = translating, green = translated, red = error);
 *  - remembers the chosen target language (storage.local);
 *  - proxies translation requests to translate.googleapis.com
 *    (content scripts cannot reliably cross-origin fetch under page CSP);
 *  - serves the popup: state queries and translate/restore commands.
 */

const API = typeof browser !== "undefined" ? browser : chrome;
const SUPPORTED_URL = /^https?:/i;

// Firefox for Android has no pageAction namespace; the browserAction toolbar
// button exists on both platforms and mirrors the address-bar icon state.
const PAGE_ACTION = API.pageAction || null;
const BROWSER_ACTION = API.browserAction || null;

// Strings resolve against the Firefox UI language (_locales/<lang>), en_US fallback.
const msg = (key, args) => API.i18n.getMessage(key, args) || key;

const ICONS = {
  idle: "icons/translate.svg",
  progress: ["icons/translate-progress-1.svg", "icons/translate-progress-2.svg"],
  done: "icons/translate-active.svg",
  error: "icons/translate-error.svg",
};

// Per-tab UI state reported by the content script.
// kinds: idle | progress | done | error | same | nothing
const tabState = new Map();     // tabId -> state
const animTimers = new Map();   // tabId -> interval handle for the progress animation

async function getTargetLang() {
  try {
    const { targetLang } = await API.storage.local.get("targetLang");
    if (targetLang) {
      return targetLang;
    }
  } catch (e) { /* storage unavailable — fall back to UI language */ }
  const ui = API.i18n.getUILanguage().split("-")[0].toLowerCase();
  return ui === "zh" ? "zh-CN" : ui;
}

function stopAnim(tabId) {
  const timer = animTimers.get(tabId);
  if (timer) {
    clearInterval(timer);
    animTimers.delete(tabId);
  }
}

function applyState(tabId) {
  const state = tabState.get(tabId) || { kind: "idle" };
  stopAnim(tabId);
  let title = msg("defaultTitle");
  let icon = ICONS.idle;

  switch (state.kind) {
    case "progress": {
      const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      title = msg("titleProgress", [pct]);
      const frames = ICONS.progress;
      let frame = 0;
      icon = frames[0];
      animTimers.set(tabId, setInterval(() => {
        frame = (frame + 1) % frames.length;
        if (PAGE_ACTION) PAGE_ACTION.setIcon({ tabId, path: frames[frame] }).catch(() => {});
        if (BROWSER_ACTION) BROWSER_ACTION.setIcon({ tabId, path: frames[frame] }).catch(() => {});
      }, 400));
      break;
    }
    case "done":
      title = msg("titleDone", [state.from, state.to]);
      icon = ICONS.done;
      break;
    case "error":
      title = msg("titleError", [state.message]);
      icon = ICONS.error;
      break;
    case "same":
      title = msg("titleSame", [state.lang || "?"]);
      break;
    case "nothing":
      title = msg("titleNothing");
      break;
  }

  if (PAGE_ACTION) {
    PAGE_ACTION.setTitle({ tabId, title });
    PAGE_ACTION.setIcon({ tabId, path: icon });
  }
  if (BROWSER_ACTION) {
    BROWSER_ACTION.setTitle({ tabId, title }).catch(() => {});
    BROWSER_ACTION.setIcon({ tabId, path: icon }).catch(() => {});
  }
}

function refreshTabVisibility(tabId, url) {
  if (!PAGE_ACTION) {
    return;
  }
  if (SUPPORTED_URL.test(url || "")) {
    PAGE_ACTION.show(tabId).catch(() => {});
  } else {
    PAGE_ACTION.hide(tabId).catch(() => {});
  }
}

// --- page action lifecycle -------------------------------------------------

API.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status === "loading") {
    tabState.delete(tabId);
    stopAnim(tabId);
  }
  refreshTabVisibility(tabId, changeInfo.url || tab.url);
  applyState(tabId);
});

API.tabs.onRemoved.addListener(tabId => {
  tabState.delete(tabId);
  stopAnim(tabId);
});

API.tabs.query({}).then(tabs => {
  for (const tab of tabs) {
    refreshTabVisibility(tab.id, tab.url);
    applyState(tab.id);
  }
}).catch(() => {});

// --- translation proxy -----------------------------------------------------

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/t";

async function fetchWithRetry(url, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url.toString(), {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    }
  }
  throw lastError;
}

async function handleTranslate(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const tl = payload.tl || (await getTargetLang());
  if (!items.length) {
    return { ok: true, results: [] };
  }
  try {
    const url = new URL(TRANSLATE_URL);
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", tl);
    url.searchParams.set("ie", "UTF-8");
    url.searchParams.set("oe", "UTF-8");
    for (const text of items) {
      url.searchParams.append("q", text);
    }
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data) || data.length !== items.length) {
      throw new Error(msg("errBadResponse"));
    }
    const results = data.map(entry =>
      Array.isArray(entry)
        ? { text: String(entry[0] ?? ""), lang: entry[1] || null }
        : { text: String(entry ?? ""), lang: null }
    );
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// --- message router --------------------------------------------------------

async function getActiveTabId() {
  let tabs = await API.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    tabs = await API.tabs.query({ active: true, lastFocusedWindow: true });
  }
  return tabs.length ? tabs[0].id : null;
}

async function forwardToTab(tabId, message) {
  try {
    return await API.tabs.sendMessage(tabId, message);
  } catch (e) {
    return { ok: false, error: msg("errRefresh") };
  }
}

API.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  // Content script -> background: proxy a batch to the translation service.
  if (message.type === "at:translate-batch") {
    return handleTranslate(message);
  }

  // Content script -> background: progress/result state updates.
  if (message.type === "at:state" && sender.tab) {
    tabState.set(sender.tab.id, message.state || { kind: "idle" });
    applyState(sender.tab.id);
    return undefined;
  }

  // Popup -> background.
  if (message.type === "at:get-state") {
    return (async () => {
      const tabId = typeof message.tabId === "number"
        ? message.tabId
        : await getActiveTabId();
      return {
        state: (tabId != null && tabState.get(tabId)) || { kind: "idle" },
        targetLang: await getTargetLang(),
      };
    })();
  }

  if (message.type === "at:translate-page") {
    return (async () => {
      const tabId = await getActiveTabId();
      if (tabId == null) {
        return { ok: false, error: msg("errNoTab") };
      }
      if (message.lang) {
        await API.storage.local.set({ targetLang: message.lang });
      }
      return forwardToTab(tabId, { type: "at:translate", tl: message.lang });
    })();
  }

  if (message.type === "at:restore-page") {
    return (async () => {
      const tabId = await getActiveTabId();
      if (tabId == null) {
        return { ok: false, error: msg("errNoTab") };
      }
      return forwardToTab(tabId, { type: "at:restore" });
    })();
  }

  return undefined;
});
