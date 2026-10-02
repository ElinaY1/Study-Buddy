/* =====================================================================
   script.js — THE CHATBOT ENGINE
   You normally don't need to edit this file. Change config.js instead.
   ===================================================================== */
(function () {
  "use strict";

  // If config.js has a typo, CONFIG won't exist. Show a helpful message.
  if (typeof CONFIG === "undefined") {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">⚠️ There is a typo in <b>config.js</b>. ' +
      "Check for a missing comma or quotation mark, then refresh the page.</p>";
    return;
  }

  // ---------- Page elements ----------
  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const chatEl = $("chat");
  const startersEl = $("starters");
  const form = $("chat-form");
  const input = $("user-input");
  const sendBtn = $("send-btn");
  const newChatBtn = $("new-chat-btn");
  const keyBtn = $("api-key-btn");
  const modal = $("key-modal");
  const keyInput = $("key-input");
  const rememberBox = $("remember-key");
  const saveKeyBtn = $("save-key-btn");
  const cancelKeyBtn = $("cancel-key-btn");
  const forgetKeyBtn = $("forget-key-btn");
  const keyStatus = $("key-status");

  const STORAGE_NAME = "chatbot_gemini_api_key";
  let memoryKey = "";   // backup in case the browser blocks storage
  let history = [];     // the conversation sent to Gemini
  let busy = false;

  // ---------- Apply settings from config.js ----------
  function applyConfig() {
    document.title = CONFIG.botName + " " + CONFIG.botEmoji;
    $("bot-emoji").textContent = CONFIG.botEmoji;
    $("bot-name").textContent = CONFIG.botName;
    $("bot-tagline").textContent = CONFIG.tagline || "";
    input.placeholder = "Message " + CONFIG.botName + "...";
    if (CONFIG.themeColor) {
      document.documentElement.style.setProperty("--theme", CONFIG.themeColor);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", CONFIG.themeColor);
    }
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>" +
      CONFIG.botEmoji + "</text></svg>";
    $("favicon").setAttribute("href", "data:image/svg+xml," + encodeURIComponent(svg));
  }

  // ---------- API key storage (every call wrapped in try/catch) ----------
  function getKey() {
    try { const k = sessionStorage.getItem(STORAGE_NAME); if (k) return k; } catch (e) {}
    try { const k = localStorage.getItem(STORAGE_NAME); if (k) return k; } catch (e) {}
    return memoryKey;
  }
  function saveKey(key, remember) {
    memoryKey = key;
    try { sessionStorage.setItem(STORAGE_NAME, key); } catch (e) {}
    try {
      if (remember) localStorage.setItem(STORAGE_NAME, key);
      else localStorage.removeItem(STORAGE_NAME);
    } catch (e) {}
  }
  function forgetKey() {
    memoryKey = "";
    try { sessionStorage.removeItem(STORAGE_NAME); } catch (e) {}
    try { localStorage.removeItem(STORAGE_NAME); } catch (e) {}
  }
  function isRemembered() {
    try { return !!localStorage.getItem(STORAGE_NAME); } catch (e) { return false; }
  }
  function updateKeyButton() {
    keyBtn.textContent = getKey() ? "🔑 Key saved" : "🔑 API key";
  }

  // ---------- API key pop-up ----------
  function openKeyModal(note) {
    const hasKey = !!getKey();
    keyInput.value = "";
    rememberBox.checked = isRemembered();
    keyStatus.textContent = note || (hasKey
      ? "✅ A key is saved. Paste a new one to replace it."
      : "No key saved yet.");
    forgetKeyBtn.hidden = !hasKey;
    modal.hidden = false;
    setTimeout(() => keyInput.focus(), 50);
  }
  function closeKeyModal() {
    modal.hidden = true;
    input.focus();
  }
  function handleSaveKey() {
    const key = keyInput.value.trim();
    if (!key) { keyStatus.textContent = "Please paste your key first."; return; }
    saveKey(key, rememberBox.checked);
    updateKeyButton();
    closeKeyModal();
  }

  keyBtn.addEventListener("click", () => openKeyModal());
  saveKeyBtn.addEventListener("click", handleSaveKey);
  cancelKeyBtn.addEventListener("click", closeKeyModal);
  forgetKeyBtn.addEventListener("click", () => {
    forgetKey();
    updateKeyButton();
    forgetKeyBtn.hidden = true;
    rememberBox.checked = false;
    keyStatus.textContent = "🗑️ Your key was removed from this browser.";
  });
  keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSaveKey(); });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeKeyModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeKeyModal(); });

  // ---------- Safe text formatting ----------
  // Step 1: escape HTML so nothing in a reply can run as code.
  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  // Step 2: turn **bold** into bold text.
  function formatInline(line) {
    return line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
  // Step 3: turn "- item" / "* item" / "1. item" lines into lists.
  function formatText(text) {
    const lines = escapeHtml(text).split("\n");
    let html = "";
    let listType = null;
    for (const raw of lines) {
      const line = raw.trim();
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const number = line.match(/^\d+[.)]\s+(.*)$/);
      const type = bullet ? "ul" : number ? "ol" : null;

      if (listType && type !== listType) { html += "</" + listType + ">"; listType = null; }

      if (type) {
        if (!listType) { html += "<" + type + ">"; listType = type; }
        html += "<li>" + formatInline((bullet || number)[1]) + "</li>";
      } else if (line !== "") {
        const heading = line.match(/^#{1,6}\s+(.*)$/);   // "## Title" → bold line
        html += heading
          ? "<p><strong>" + formatInline(heading[1]) + "</strong></p>"
          : "<p>" + formatInline(line) + "</p>";
      }
    }
    if (listType) html += "</" + listType + ">";
    return html;
  }

  // ---------- Showing messages ----------
  function scrollToBottom() {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  function makeAvatar() {
    const av = document.createElement("div");
    av.className = "avatar";
    av.setAttribute("aria-hidden", "true");
    av.textContent = CONFIG.botEmoji;
    return av;
  }
  function addMessage(role, text, isError) {
    const row = document.createElement("div");
    row.className = "message " + role + (isError ? " error" : "");
    if (role === "bot") row.appendChild(makeAvatar());
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "bot") bubble.innerHTML = formatText(text);  // safe: escaped first
    else bubble.textContent = text;                           // user text shown as-is
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
  }
  function showThinking() {
    const row = document.createElement("div");
    row.className = "message bot";
    row.appendChild(makeAvatar());
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = '<span class="dots" role="status" aria-label="Thinking"><span></span><span></span><span></span></span>';
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }
  function renderStarters() {
    startersEl.innerHTML = "";
    (CONFIG.starterQuestions || []).forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "starter";
      b.textContent = q;
      b.addEventListener("click", () => sendMessage(q));
      startersEl.appendChild(b);
    });
    startersEl.hidden = startersEl.children.length === 0;
  }

  // ---------- Talking to Gemini ----------
  function friendlyError(message) {
    const err = new Error(message);
    err.friendly = message;
    return err;
  }

  function messageForStatus(status, data) {
    const detail = (data && data.error && data.error.message) || "";
    if (status === 400 && /api.?key/i.test(detail)) {
      return "🔑 That API key doesn't seem to work. Click **API key** at the top and paste it again.";
    }
    if (status === 400) {
      return "😕 Gemini couldn't understand the request. Check your API key, and check config.js for typos.";
    }
    if (status === 403) {
      return "🔑 This API key isn't allowed to use Gemini. Click **API key** and paste a valid key from Google AI Studio.";
    }
    if (status === 404) {
      return '🔍 I couldn\'t find the model "' + CONFIG.model + '". Check the **model** name in config.js (try "gemini-flash-latest").';
    }
    if (status === 429) {
      return "⏳ Too many messages too quickly, or the free daily limit has been reached. Wait a minute and try again.";
    }
    if (status >= 500) {
      return "🛠️ Gemini's servers are having trouble right now. Please try again in a moment.";
    }
    return "😕 Something went wrong (error " + status + "). Please try again.";
  }

  async function callGemini(key) {
    const model = String(CONFIG.model || "gemini-flash-latest").trim().replace(/^models\//, "");
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":generateContent";

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CONFIG.systemInstructions }] },
          contents: history
        })
      });
    } catch (e) {
      throw friendlyError(navigator.onLine === false
        ? "📡 You seem to be offline. Check your internet connection and try again."
        : "📡 I couldn't reach Gemini. Check your internet connection and try again.");
    }

    let data = null;
    try { data = await response.json(); } catch (e) {}

    if (!response.ok) throw friendlyError(messageForStatus(response.status, data));

    // Join all the text parts, skipping "thinking" parts.
    const candidate = data && data.candidates && data.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const text = parts
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();

    if (text) return text;
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw friendlyError("🙈 I can't help with that one. Try asking a different way.");
    }
    throw friendlyError("🤔 I didn't get an answer that time. Please try asking again.");
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    newChatBtn.disabled = value;
  }

  async function sendMessage(text) {
    text = (text || "").trim();
    if (!text || busy) return;

    const key = getKey();
    if (!key) {
      openKeyModal("👋 First, paste your Gemini API key so we can start chatting.");
      return;
    }

    startersEl.hidden = true;
    addMessage("user", text);
    input.value = "";
    autoResize();
    history.push({ role: "user", parts: [{ text: text }] });

    setBusy(true);
    const thinking = showThinking();
    try {
      const reply = await callGemini(key);
      history.push({ role: "model", parts: [{ text: reply }] });
      thinking.remove();
      addMessage("bot", reply);
    } catch (err) {
      thinking.remove();
      history.pop(); // drop the failed question so the conversation stays tidy
      addMessage("bot", err.friendly || "😕 Something went wrong. Please try again.", true);
      if (!input.value) { input.value = text; autoResize(); } // put the question back to retry
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  // ---------- New chat ----------
  function newChat() {
    if (busy) return;
    history = [];
    messagesEl.innerHTML = "";
    addMessage("bot", CONFIG.welcomeMessage);
    renderStarters();
    input.value = "";
    autoResize();
    input.focus();
  }

  // ---------- Typing box ----------
  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener("keydown", (e) => {
    // Enter sends. Shift+Enter makes a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
  input.addEventListener("input", autoResize);
  newChatBtn.addEventListener("click", newChat);

  // ---------- Start ----------
  applyConfig();
  updateKeyButton();
  newChat();
})();
