/* ============================================================
   SHAMMS – KI-Chat (BYOK: eigener Schlüssel des Besuchers)
   ------------------------------------------------------------
   GRUNDREGELN
   1. Der Schlüssel des Besuchers verlässt den Browser NUR in Richtung
      des Anbieters (hier: api.openai.com). Er geht NICHT an Shamms,
      NICHT in ein Protokoll und NICHT in die Adresszeile.
   2. Es gibt KEINE Serverkomponente. Shamms zahlt nichts.
   3. Kein Fremdskript auf dieser Seite: kein CDN, kein SDK, kein Analytics.
   4. Der Schlüssel wird nur gespeichert, wenn der Nutzer es ausdrücklich will.
   ============================================================ */

export const CHAT_DEFAULTS = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  /* Belegt aus der offiziellen openai-node-Dokumentation (Beispiele dort nutzen gpt-5.5). */
  models: ["gpt-5.5"],
  maxHistoryMessages: 24,
  maxInputChars: 4000,
  maxOutputTokens: 1024,
};

/* ------------------------------------------------------------ Aufbau --- */

/** Baut Kopfzeilen und Rumpf für den Anbieter. Der Schlüssel steckt NUR im Header. */
export function buildRequest({ apiKey, model, messages }, cfg = CHAT_DEFAULTS) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("no_key");
  }
  if (!model || !cfg.models.includes(model)) {
    throw new Error("bad_model");
  }
  const clean = (messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, cfg.maxInputChars) }))
    .slice(-cfg.maxHistoryMessages);

  if (!clean.length) throw new Error("no_messages");

  return {
    url: cfg.endpoint,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey.trim(),
      },
      // Der Schlüssel steht bewusst NICHT im Rumpf.
      body: JSON.stringify({ model, messages: clean, max_tokens: cfg.maxOutputTokens }),
    },
  };
}

/** Liest die Antwort aus. Wirft "bad_response", wenn die Form nicht passt. */
export function parseResponse(json) {
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("bad_response");
  return text.trim();
}

/** Übersetzt Anbieterfehler in klare, deutsche Hinweise. */
export function mapError(status, json) {
  const apiMsg = json?.error?.message;
  const apiCode = json?.error?.code || json?.error?.type;
  if (status === 401 || apiCode === "invalid_api_key") {
    return { code: "invalid_key", text: "Der Schlüssel wurde abgelehnt. Bitte prüfe ihn auf Tippfehler und auf Leerzeichen am Anfang oder Ende." };
  }
  if (status === 403) {
    return { code: "forbidden", text: "Dieser Schlüssel darf das gewählte Modell nicht nutzen. Prüfe die Freigaben in deinem OpenAI-Konto." };
  }
  if (status === 404) {
    return { code: "model_not_found", text: "Das gewählte Modell ist für diesen Schlüssel nicht verfügbar. Wähle ein anderes Modell." };
  }
  if (status === 429) {
    return { code: "rate_limit", text: "Zu viele Anfragen oder das Guthaben deines Kontos ist aufgebraucht. Warte kurz oder prüfe dein OpenAI-Guthaben." };
  }
  if (status === 400) {
    return { code: "bad_request", text: "Die Anfrage wurde nicht akzeptiert." + (apiMsg ? " Meldung des Anbieters: " + apiMsg : "") };
  }
  if (status >= 500) {
    return { code: "provider_down", text: "Der Anbieter meldet derzeit eine Störung. Bitte später erneut versuchen." };
  }
  return { code: "unknown", text: apiMsg ? "Fehler des Anbieters: " + apiMsg : "Unbekannter Fehler (Status " + status + ")." };
}

/* ---------------------------------------------------- Umgebung prüfen --- */

export function browserSupported() {
  return typeof fetch === "function" && typeof localStorage !== "undefined";
}

/* ------------------------------------------------------- Browser-Teil --- */

function initBrowser() {
  const root = document.getElementById("kiChat");
  if (!root) return;

  const KEY_STORE = "shamms.ki.key";
  const KEY_OPT_IN = "shamms.ki.remember";
  const chatStore = "shamms.ki.chats." + (root.dataset.tool || "default");

  const $ = (sel) => root.querySelector(sel);
  const elLog = $("#kiChatLog");
  const elForm = $("#kiChatForm");
  const elInput = $("#kiChatInput");
  const elSend = $("#kiChatSend");
  const elStatus = $("#kiChatStatus");
  const elKey = $("#kiChatKey");
  const elRemember = $("#kiChatRemember");
  const elSetup = $("#kiChatSetup");
  const elModel = $("#kiChatModel");

  let messages = [];
  let busy = false;
  let apiKey = "";

  /* --- Schlüsselverwaltung: nur mit ausdrücklicher Zustimmung speichern --- */
  try {
    if (localStorage.getItem(KEY_OPT_IN) === "1") {
      apiKey = localStorage.getItem(KEY_STORE) || "";
      if (elRemember) elRemember.checked = true;
    }
  } catch (_) {}

  function persistKey() {
    try {
      if (elRemember && elRemember.checked) {
        localStorage.setItem(KEY_STORE, apiKey);
        localStorage.setItem(KEY_OPT_IN, "1");
      } else {
        localStorage.removeItem(KEY_STORE);
        localStorage.removeItem(KEY_OPT_IN);
      }
    } catch (_) {}
  }

  function cfgNow() {
    const models = (root.dataset.models || "").split(",").map((s) => s.trim()).filter(Boolean);
    return { ...CHAT_DEFAULTS, models: models.length ? models : CHAT_DEFAULTS.models };
  }

  function setStatus(text, kind) {
    if (!elStatus) return;
    elStatus.textContent = text || "";
    elStatus.className = "kt-chat-status" + (kind ? " is-" + kind : "");
  }

  function render() {
    if (!elLog) return;
    if (!messages.length) {
      elLog.innerHTML =
        '<p class="kt-chat-hint">Stelle deine erste Frage. Der Verlauf bleibt in deinem Browser.</p>';
      return;
    }
    elLog.innerHTML = messages
      .map((m, i) => {
        const who = m.role === "user" ? "Du" : "Antwort";
        const cls = m.role === "user" ? "is-user" : "is-bot";
        return (
          '<div class="kt-msg ' + cls + '">' +
          '<div class="kt-msg-head"><span class="kt-msg-who">' + who + "</span>" +
          (m.role === "assistant"
            ? '<button type="button" class="kt-mini" data-copy="' + i + '">Kopieren</button>' +
              '<button type="button" class="kt-mini" data-save="' + i + '">Speichern</button>'
            : "") +
          "</div>" +
          '<div class="kt-msg-body">' + escapeHtml(m.content) + "</div>" +
          "</div>"
        );
      })
      .join("");
    elLog.scrollTop = elLog.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  function saveChats() {
    try {
      localStorage.setItem(chatStore, JSON.stringify(messages.slice(-cfgNow().maxHistoryMessages)));
    } catch (_) {}
  }

  function loadChats() {
    try {
      const raw = localStorage.getItem(chatStore);
      if (raw) messages = JSON.parse(raw) || [];
    } catch (_) { messages = []; }
  }

  async function send(text) {
    const cfg = cfgNow();
    messages.push({ role: "user", content: text });
    render();
    busy = true;
    elSend.disabled = true;
    setStatus("Anfrage läuft …", "busy");

    let req;
    try {
      req = buildRequest({ apiKey, model: elModel?.value || cfg.models[0], messages }, cfg);
    } catch (err) {
      busy = false;
      elSend.disabled = false;
      if (err.message === "no_key") {
        setStatus("Bitte zuerst deinen eigenen OpenAI-Schlüssel eintragen.", "err");
        if (elSetup) elSetup.open = true;
      } else {
        setStatus("Anfrage konnte nicht vorbereitet werden.", "err");
      }
      messages.pop();
      render();
      return;
    }

    try {
      const res = await fetch(req.url, req.init);
      let json = null;
      try { json = await res.json(); } catch (_) {}
      if (!res.ok) {
        const e = mapError(res.status, json);
        setStatus(e.text, "err");
      } else {
        const answer = parseResponse(json);
        messages.push({ role: "assistant", content: answer });
        setStatus("", "");
        saveChats();
      }
    } catch (err) {
      setStatus("Keine Verbindung zu api.openai.com. Prüfe deine Internetverbindung.", "err");
    } finally {
      busy = false;
      elSend.disabled = false;
      render();
    }
  }

  /* --- Ereignisse --- */
  if (elForm) {
    elForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (elInput?.value || "").trim();
      if (!text || busy) return;
      elInput.value = "";
      send(text.slice(0, cfgNow().maxInputChars));
    });
  }

  if (elInput) {
    elInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        elForm?.requestSubmit();
      }
    });
  }

  if (elLog) {
    elLog.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const copyIdx = t.dataset?.copy;
      const saveIdx = t.dataset?.save;
      if (copyIdx !== undefined) {
        const m = messages[Number(copyIdx)];
        if (!m) return;
        try {
          await navigator.clipboard.writeText(m.content);
          t.textContent = "Kopiert";
          setTimeout(() => (t.textContent = "Kopieren"), 1500);
        } catch (_) {
          setStatus("Kopieren wurde vom Browser blockiert.", "err");
        }
      }
      if (saveIdx !== undefined) {
        const m = messages[Number(saveIdx)];
        if (!m) return;
        const blob = new Blob([m.content], { type: "text/plain;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "shamms-antwort.txt";
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });
  }

  $("#kiChatNew")?.addEventListener("click", () => {
    messages = [];
    try { localStorage.removeItem(chatStore); } catch (_) {}
    render();
    setStatus("", "");
  });

  $("#kiChatClear")?.addEventListener("click", () => {
    messages = [];
    try { localStorage.removeItem(chatStore); } catch (_) {}
    render();
    setStatus("Verlauf gelöscht.", "ok");
  });

  $("#kiChatForget")?.addEventListener("click", () => {
    apiKey = "";
    if (elKey) elKey.value = "";
    if (elRemember) elRemember.checked = false;
    persistKey();
    setStatus("Schlüssel aus diesem Browser entfernt.", "ok");
  });

  $("#kiChatSavePrompt")?.addEventListener("click", () => {
    const text = (elInput?.value || "").trim();
    if (!text) { setStatus("Kein Text zum Speichern.", "err"); return; }
    const name = prompt("Name für diesen Prompt:", text.slice(0, 40));
    if (!name) return;
    try {
      const all = JSON.parse(localStorage.getItem("shamms.ki.prompts") || "[]");
      all.push({ name, text });
      localStorage.setItem("shamms.ki.prompts", JSON.stringify(all.slice(-50)));
      setStatus("Prompt gespeichert.", "ok");
    } catch (_) { setStatus("Prompt konnte nicht gespeichert werden.", "err"); }
  });

  if (elKey) {
    elKey.addEventListener("input", () => { apiKey = elKey.value; });
    elKey.addEventListener("change", () => { apiKey = elKey.value; persistKey(); });
  }
  elRemember?.addEventListener("change", persistKey);

  /* --- Prompt aus dem Shamms-Vorlagenfeld übernehmen --- */
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.dataset?.prompt) {
      if (elInput) { elInput.value = t.dataset.prompt; elInput.focus(); }
      setStatus("Vorlage eingesetzt – du kannst sie noch anpassen.", "ok");
    }
  });

  loadChats();
  render();
  if (apiKey && elKey) elKey.value = apiKey;
  if (!apiKey && elSetup) elSetup.open = true;
  setStatus("", "");
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBrowser);
  } else {
    initBrowser();
  }
}
