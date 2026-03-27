/* ─────────────────────────────────────────
   Ask Kem — script.js  (FIXED)
   Handles UI, sends messages to serverless
   function, renders responses with strict error handling.
───────────────────────────────────────── */

/* ── Theme Toggling ── */
const html = document.documentElement;
const themeBtn = document.getElementById("themeBtn");
const themeIcon = document.getElementById("themeIcon");

const savedTheme =
  localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light");

html.setAttribute("data-theme", savedTheme);
updateThemeIcon(savedTheme);

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const nextTheme =
      html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", nextTheme);
    localStorage.setItem("theme", nextTheme);
    updateThemeIcon(nextTheme);
  });
}

function updateThemeIcon(theme) {
  if (!themeIcon) return;
  themeIcon.innerHTML =
    theme === "dark"
      ? // Sun icon — shown when in dark mode (click to go light)
        '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
      : // Moon icon — shown when in light mode (click to go dark)
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
}

/* ── DOM Elements & State ── */
// FIX: target #chatWindow (the inner scroll container), not .chat-main
const chatWindow = document.getElementById("chatWindow");
const chatMain = document.querySelector(".chat-main");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const suggestionsEl = document.getElementById("suggestions");
const suggestionBtns = document.querySelectorAll(".suggestion-btn");

let chatHistory = [];
let suggestionsHidden = false;

/* ── HTML Escaping ── */
function escapeHTML(str) {
  return String(str).replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[tag] || tag,
  );
}

/* ── Format AI Reply (markdown-lite) ── */
function formatReply(text) {
  return (
    escapeHTML(text)
      // Markdown links — must run before URL auto-linking
      .replace(
        /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      // Bare URLs
      .replace(
        /(^|[\s>])(https?:\/\/[^\s<"]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>',
      )
      // Emails
      .replace(
        /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,
        '<a href="mailto:$1">$1</a>',
      )
      // Bold before italic so **text** doesn't get partially matched by *
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Line breaks
      .replace(/\n/g, "<br>")
  );
}

/* ── Scroll to bottom of chat ── */
function scrollBottom() {
  if (chatMain) chatMain.scrollTop = chatMain.scrollHeight;
}

/* ── Hide suggestion chips after first message ── */
function hideSuggestions() {
  if (!suggestionsHidden && suggestionsEl) {
    suggestionsEl.style.display = "none";
    suggestionsHidden = true;
  }
}

/* ── Append a message bubble to #chatWindow ──
   FIX: uses correct CSS classes (.msg-group, .bot-group/.user-group,
        .bubble, .bot-bubble/.user-bubble) that actually exist in style.css.
   FIX: appends into #chatWindow, not <main>.
*/
function appendMessage(text, sender, isError = false) {
  if (!chatWindow) return null;

  const isUser = sender === "user";
  const group = document.createElement("div");
  group.className = `msg-group ${isUser ? "user-group" : "bot-group"}`;

  const bubbleClass = isUser
    ? "bubble user-bubble"
    : `bubble bot-bubble${isError ? " error-bubble" : ""}`;

  const content =
    sender === "ai" && !isError ? formatReply(text) : escapeHTML(text);

  if (isUser) {
    group.innerHTML = `
      <div class="msg-bubbles">
        <div class="${bubbleClass}">${content}</div>
      </div>`;
  } else {
    group.innerHTML = `
      <div class="bot-avatar" aria-hidden="true">AI</div>
      <div class="msg-bubbles">
        <div class="${bubbleClass}">${content}</div>
      </div>`;
  }

  chatWindow.appendChild(group);
  scrollBottom();
  return group;
}

/* ── Typing indicator ──
   FIX: uses .typing-bubble / .typing-dot classes that match style.css animations.
   FIX: appends into #chatWindow.
*/
function showTyping() {
  if (!chatWindow) return null;

  const group = document.createElement("div");
  group.className = "msg-group bot-group typing-group";
  group.innerHTML = `
    <div class="bot-avatar" aria-hidden="true">AI</div>
    <div class="msg-bubbles">
      <div class="typing-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>`;

  chatWindow.appendChild(group);
  scrollBottom();
  return group;
}

function removeTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ── Auto-resize textarea as user types ── */
function autoResize() {
  if (!userInput) return;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

/* ── Main Send Logic ── */
async function handleSend(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Hide suggestion chips on first message
  hideSuggestions();

  // Render user message
  appendMessage(trimmed, "user");
  userInput.value = "";
  autoResize();
  sendBtn.disabled = true;

  // Show typing indicator
  const typingEl = showTyping();

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed, history: chatHistory }),
    });

    removeTyping(typingEl);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error(
          "🚦 You're sending messages too fast. Please wait a moment.",
        );
      } else if (res.status === 504) {
        throw new Error(
          "⏳ The AI took too long to respond. Please try again.",
        );
      } else if (res.status === 500) {
        throw new Error(
          "🛠️ Something went wrong on the server. Please try again later.",
        );
      } else {
        throw new Error(
          data.error || "🔌 Couldn't reach the AI. Please try again.",
        );
      }
    }

    if (!data.reply) throw new Error("Received an empty response from the AI.");

    appendMessage(data.reply, "ai");

    // Save to conversation history
    chatHistory.push({ role: "user", content: trimmed });
    chatHistory.push({ role: "model", content: data.reply });

    // Keep last 6 exchanges (12 entries) to stay token-efficient
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);
  } catch (err) {
    removeTyping(typingEl);
    appendMessage(err.message, "ai", true);
  } finally {
    sendBtn.disabled = userInput.value.trim().length === 0;
    userInput.focus();
  }
}

/* ── Event Listeners ── */
if (sendBtn && userInput) {
  sendBtn.addEventListener("click", () => handleSend(userInput.value));

  userInput.addEventListener("keydown", (e) => {
    // FIX: use keydown instead of keypress (keypress is deprecated)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(userInput.value);
    }
  });

  userInput.addEventListener("input", () => {
    sendBtn.disabled = userInput.value.trim().length === 0;
    autoResize();
  });
}

// Suggestion buttons
suggestionBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const query = btn.getAttribute("data-q");
    if (query) handleSend(query);
  });
});
