"use strict";

const API = typeof browser !== "undefined" ? browser : chrome;

const LANGS = [
  ["ru", "Русский"], ["en", "English"], ["uk", "Українська"],
  ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"],
  ["it", "Italiano"], ["pt", "Português"], ["pl", "Polski"],
  ["tr", "Türkçe"], ["zh-CN", "中文"], ["ja", "日本語"],
  ["ko", "한국어"], ["ar", "العربية"], ["hi", "हिन्दी"],
  ["id", "Indonesia"], ["vi", "Tiếng Việt"], ["th", "ไทย"],
  ["nl", "Nederlands"], ["cs", "Čeština"], ["sv", "Svenska"],
  ["el", "Ελληνικά"], ["he", "עברית"], ["fa", "فارسی"],
];

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
    return { ok: false, error: "нет активной вкладки" };
  }
  try {
    return await API.tabs.sendMessage(tabId, message);
  } catch (e) {
    return { ok: false, error: "обновите страницу" };
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
      text = `Перевод… ${state.total ? Math.round(state.done / state.total * 100) : 0}%`;
      busy = true;
      break;
    case "done":
      text = `Переведено: ${state.from} → ${state.to}`;
      break;
    case "error":
      text = `Ошибка: ${state.message || "неизвестно"}`;
      break;
    case "same":
      text = "Страница уже на выбранном языке";
      break;
    case "nothing":
      text = "Нет текста для перевода";
      break;
    default:
      text = "Выберите язык и нажмите «Перевести»";
  }

  statusEl.textContent = text;
  statusEl.classList.toggle("error", kind === "error");
  action.disabled = busy;
  action.classList.toggle("restore", kind === "done");
  action.textContent = busy ? "Перевод…" : (kind === "done" ? "Показать оригинал" : "Перевести");

  for (const btn of document.querySelectorAll("button.chip")) {
    btn.classList.toggle("selected", btn.dataset.lang === selected);
  }
}

function buildLangs() {
  const grid = document.getElementById("langs");
  for (const [code, label] of LANGS) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.lang = code;
    btn.textContent = label;
    btn.title = code;
    btn.addEventListener("click", () => {
      selected = code;
      API.storage.local.set({ targetLang: code }).catch(() => {});
      render();
    });
    grid.appendChild(btn);
  }
}

(async () => {
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
