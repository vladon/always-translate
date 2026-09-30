"use strict";

const API = typeof browser !== "undefined" ? browser : chrome;
const msg = (key, args) => API.i18n.getMessage(key, args) || key;

const listEl = document.getElementById("langs");
const searchEl = document.getElementById("search");
const subEl = document.getElementById("sub");
const currentLineEl = document.getElementById("current-line");

let chosen = null;

function langName(code) {
  const e = TARGET_LANGS.find(x => x[0] === code);
  return e ? e[1] : code;
}

function render() {
  const q = (searchEl.value || "").trim().toLowerCase();
  listEl.textContent = "";
  for (const [code, native, english] of TARGET_LANGS) {
    if (q && !native.toLowerCase().includes(q) && !english.toLowerCase().includes(q) && !code.toLowerCase().startsWith(q)) continue;
    const label = document.createElement("label");
    label.className = "lang" + (code === chosen ? " selected" : "");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "target-lang";
    radio.value = code;
    radio.checked = code === chosen;
    radio.addEventListener("change", () => {
      chosen = code;
      API.storage.local.set({ targetLang: code }).catch(() => {});
      render();
    });
    const nat = document.createElement("span");
    nat.className = "native";
    nat.textContent = native;
    const cod = document.createElement("span");
    cod.className = "code";
    cod.textContent = code;
    label.append(radio, nat, cod);
    listEl.appendChild(label);
  }
  const sel = TARGET_LANGS.find(x => x[0] === chosen);
  currentLineEl.textContent = chosen ? msg("optionsCurrent", [langName(chosen), chosen]) : "";
}

(async () => {
  subEl.textContent = msg("optionsSubtitle");
  searchEl.placeholder = msg("popupSearch");
  document.title = msg("optionsTitle");
  try {
    const { targetLang } = await API.storage.local.get("targetLang");
    chosen = targetLang || null;
  } catch (e) { chosen = null; }
  render();
  searchEl.addEventListener("input", render);
})();
