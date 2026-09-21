"use strict";

/*
 * Content script:
 *  - collects visible text nodes (including open shadow roots);
 *  - translates them in batches through the background proxy;
 *  - shows in-page progress (pill) and result feedback (toasts);
 *  - restores the original text on demand;
 *  - keeps newly added nodes translated while the page is translated.
 */

(() => {
  if (window.__alwaysTranslateLoaded) {
    return;
  }
  window.__alwaysTranslateLoaded = true;

  // Strings resolve against the Firefox UI language (_locales/<lang>), en_US fallback.
  const msg = (key, args) => browser.i18n.getMessage(key, args) || key;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "CANVAS",
    "SVG", "MATH", "CODE", "PRE", "TEXTAREA", "INPUT", "SELECT", "OPTION",
  ]);

  const MAX_SEGMENT = 4200;   // single q parameter limit
  const BATCH_CHARS = 1400;   // per-request payload budget
  const BATCH_ITEMS = 16;     // per-request segment budget
  const POOL_SIZE = 3;

  let active = false;         // page currently translated (revert available)
  let busy = false;
  let lastTarget = null;
  let jobGen = 0;             // invalidates in-flight jobs after restore
  let observer = null;
  let dynamicTimer = 0;
  const originals = new Map(); // Text node -> original text
  const shadowRoots = new Set();

  // --- feedback ----------------------------------------------------------

  function report(state) {
    browser.runtime.sendMessage({ type: "at:state", state }).catch(() => {});
  }

  let pill = null;

  function showPill(text) {
    if (!pill || !pill.isConnected) {
      pill = document.createElement("div");
      pill.setAttribute("data-at-skip", "");
      Object.assign(pill.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "2147483647",
        background: "rgba(28,27,34,0.95)",
        color: "#ffffff",
        font: "13px/1.4 system-ui, sans-serif",
        padding: "10px 14px",
        borderRadius: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        maxWidth: "320px",
        pointerEvents: "none",
        opacity: "1",
        transition: "opacity .25s",
      });
      (document.body || document.documentElement).appendChild(pill);
    }
    pill.textContent = text;
    pill.style.opacity = "1";
  }

  function hidePill() {
    if (!pill) {
      return;
    }
    const el = pill;
    pill = null;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }

  function toast(text) {
    const el = document.createElement("div");
    el.setAttribute("data-at-skip", "");
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      background: "rgba(28,27,34,0.95)",
      color: "#ffffff",
      font: "13px/1.4 system-ui, sans-serif",
      padding: "10px 14px",
      borderRadius: "10px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      maxWidth: "320px",
      pointerEvents: "none",
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --- text node collection ---------------------------------------------

  function isTranslatable(node) {
    const text = node.nodeValue;
    if (!text || !text.trim() || !/\p{L}/u.test(text)) {
      return false;
    }
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-at-skip]")) {
      return false;
    }
    if (SKIP_TAGS.has(parent.tagName) || parent.closest("svg,math")) {
      return false;
    }
    if (parent.isContentEditable) {
      return false;
    }
    return !originals.has(node);
  }

  function collect(root, out) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (isTranslatable(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT),
    });
    let current;
    while ((current = walker.nextNode())) {
      out.push(current);
    }
  }

  function collectAll() {
    const out = [];
    collect(document, out);
    for (const el of document.querySelectorAll("*")) {
      if (el.shadowRoot) {
        shadowRoots.add(el.shadowRoot);
        collect(el.shadowRoot, out);
      }
    }
    return out;
  }

  // --- translation -------------------------------------------------------

  async function translateTexts(texts, tl) {
    return browser.runtime.sendMessage({ type: "at:translate-batch", items: texts, tl });
  }

  function splitLong(text, max = MAX_SEGMENT) {
    if (text.length <= max) {
      return [text];
    }
    const chunks = [];
    const sentences = text.match(/[^.!?…\n]+[.!?…]+["')\]]*\s*|[^.!?…\n]+/g) || [text];
    let current = "";
    for (const sentence of sentences) {
      if (sentence.length > max) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let i = 0; i < sentence.length; i += max) {
          chunks.push(sentence.slice(i, i + max));
        }
        continue;
      }
      if (current.length + sentence.length > max) {
        chunks.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current) {
      chunks.push(current);
    }
    return chunks;
  }

  function buildBatches(entries) {
    const batches = [];
    let current = [];
    let chars = 0;
    for (const entry of entries) {
      const parts = entry.parts;
      if (parts.length > 1 || chars + entry.text.length > BATCH_CHARS || current.length + parts.length > BATCH_ITEMS) {
        if (current.length) {
          batches.push(current);
          current = [];
          chars = 0;
        }
      }
      current.push(...parts.map(text => ({ entry, text })));
      chars += entry.text.length;
      if (chars >= BATCH_CHARS || current.length >= BATCH_ITEMS) {
        batches.push(current);
        current = [];
        chars = 0;
      }
    }
    if (current.length) {
      batches.push(current);
    }
    return batches.map(batch => ({ items: batch, size: new Set(batch.map(b => b.entry)).size }));
  }

  async function translateNodes(nodes, tl, onProgress) {
    const gen = jobGen;
    const entries = nodes.map(node => {
      const text = node.nodeValue;
      return { node, text, parts: splitLong(text) };
    });
    const batches = buildBatches(entries);
    let done = 0;
    let next = 0;

    const worker = async () => {
      while (next < batches.length && gen === jobGen) {
        const batch = batches[next++];
        const texts = batch.items.map(b => b.text);
        const resp = await translateTexts(texts, tl);
        if (gen !== jobGen) {
          return;
        }
        if (!resp || !resp.ok) {
          throw new Error((resp && resp.error) || msg("errNoResponse"));
        }
        if (resp.results.length !== texts.length) {
          throw new Error(msg("errIncomplete"));
        }
        const byEntry = new Map();
        batch.items.forEach((item, i) => {
          if (!byEntry.has(item.entry)) {
            byEntry.set(item.entry, []);
          }
          byEntry.get(item.entry).push(resp.results[i].text);
        });
        for (const [entry, parts] of byEntry) {
          const body = parts.map(s => String(s || "").trim()).filter(Boolean).join(" ");
          if (!body || !entry.node.isConnected) {
            continue;
          }
          if (!originals.has(entry.node)) {
            originals.set(entry.node, entry.text);
          }
          // Keep the node's own leading/trailing whitespace: adjacent inline
          // elements (<b>, <a>, <i>) rely on it for word separation.
          const lead = (entry.text.match(/^\s*/) || [""])[0];
          const trail = (entry.text.match(/\s*$/) || [""])[0];
          entry.node.nodeValue = lead + body + trail;
          done++;
        }
        if (onProgress) {
          onProgress(done, nodes.length);
        }
      }
    };

    const workers = [];
    for (let i = 0; i < POOL_SIZE && i < batches.length; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  // --- dynamic content ----------------------------------------------------

  function processDynamic() {
    if (!active) {
      return;
    }
    const nodes = [];
    collect(document, nodes);
    for (const root of shadowRoots) {
      collect(root, nodes);
    }
    if (nodes.length) {
      translateNodes(nodes, lastTarget).catch(() => {});
    }
  }

  function startObserver() {
    if (observer) {
      return;
    }
    observer = new MutationObserver(() => {
      clearTimeout(dynamicTimer);
      dynamicTimer = setTimeout(processDynamic, 400);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(dynamicTimer);
  }

  // --- main flow ----------------------------------------------------------

  function buildProbe(nodes) {
    return nodes
      .slice(0, 8)
      .map(node => node.nodeValue.trim().slice(0, 120))
      .join(" ")
      .slice(0, 400);
  }

  async function translatePage(tl) {
    busy = true;
    try {
      const nodes = collectAll();
      if (!nodes.length) {
        report({ kind: "nothing" });
        toast(msg("titleNothing"));
        return;
      }
      showPill(msg("pillProgress", [0, nodes.length, 0]));
      report({ kind: "progress", done: 0, total: nodes.length });

      const probeResp = await translateTexts([buildProbe(nodes)], tl);
      if (!probeResp || !probeResp.ok) {
        throw new Error((probeResp && probeResp.error) || msg("errNoResponse"));
      }
      const from = String((probeResp.results[0] && probeResp.results[0].lang) || "?").split("-")[0];
      if (from === tl.split("-")[0]) {
        hidePill();
        report({ kind: "same", lang: from });
        toast(msg("titleSame", [from]));
        return;
      }

      lastTarget = tl;
      await translateNodes(nodes, tl, (done, total) => {
        showPill(msg("pillProgress", [done, total, Math.round(done / total * 100)]));
        report({ kind: "progress", done, total });
      });
      hidePill();

      active = true;
      startObserver();
      report({ kind: "done", from, to: tl });
      toast("✓ " + msg("titleDone", [from, tl]));
    } catch (e) {
      hidePill();
      report({ kind: "error", message: String((e && e.message) || e) });
      toast(msg("titleError", [String((e && e.message) || e)]));
      if (originals.size) {
        // Partial translation applied — allow reverting what was done.
        active = true;
        startObserver();
      }
    } finally {
      busy = false;
    }
  }

  function restore(silent) {
    jobGen++; // invalidate in-flight batches
    stopObserver();
    for (const [node, text] of originals) {
      if (node.isConnected) {
        node.nodeValue = text;
      }
    }
    originals.clear();
    active = false;
    hidePill();
    report({ kind: "idle" });
    if (!silent) {
      toast(msg("toastRestore"));
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    if (message.type === "at:translate") {
      if (busy) {
        return Promise.resolve({ ok: false, busy: true });
      }
      const tl = message.tl || "en";
      if (active) {
        restore(true);
      }
      translatePage(tl);
      return Promise.resolve({ ok: true });
    }
    if (message.type === "at:restore") {
      if (busy) {
        return Promise.resolve({ ok: false, busy: true });
      }
      if (active) {
        restore();
      }
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });
})();
