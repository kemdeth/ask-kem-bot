/* ─────────────────────────────────────────
   Ask Kem — script.js
   Handles UI, sends messages to serverless
   function, renders responses.
───────────────────────────────────────── */

/* ── Theme ── */
const html = document.documentElement;
const themeBtn = document.getElementById("themeBtn");
const themeIcon = document.getElementById("themeIcon");

const saved =
  localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light");
html.setAttribute("data-theme", saved);
updateThemeIcon(saved);

themeBtn.addEventListener("click", () => {
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeIcon(next);
});

function updateThemeIcon(theme) {
  themeIcon.innerHTML =
    theme === "dark"
      ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

/* ── Elements ── */
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const suggestions = document.getElementById("suggestions");

/* ── Conversation history ── */
const history = [];

/* ── Rate limit: max 15 messages per session ── */
let msgCount = 0;
const MSG_LIMIT = 15;

/* ── Enable send button only when input has text ── */
userInput.addEventListener("input", () => {
  sendBtn.disabled = userInput.value.trim() === "";
  autoResize();
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

/* ── Suggestion buttons ── */
document.querySelectorAll(".suggestion-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    userInput.value = btn.dataset.q;
    sendBtn.disabled = false;
    handleSend();
  });
});

/* ── Main send function ── */
async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  // Client-side rate limit
  if (msgCount >= MSG_LIMIT) {
    appendBotBubble(
      "You've reached the session limit of 15 messages. Please refresh to start a new chat.",
      true,
    );
    return;
  }

  // Hide suggestions after first message
  if (suggestions) suggestions.style.display = "none";

  appendUserBubble(text);
  userInput.value = "";
  sendBtn.disabled = true;
  autoResize();
  msgCount++;

  history.push({ role: "user", content: text });

  // Show typing indicator
  const typingEl = appendTyping();

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
    });

    removeTyping(typingEl);

    if (!res.ok) {
      // Try to parse the error body for a specific message
      const err = await res.json().catch(() => ({}));

      if (res.status === 429) {
        appendBotBubble(
          "⏳ Too many requests. Please wait a moment before sending again.",
          true,
        );
      } else if (res.status === 500 && err.code === "MISSING_API_KEY") {
        appendBotBubble(
          "⚙️ The AI is not configured yet. If you're the site owner, please set your GEMINI_API_KEY in Netlify environment variables.",
          true,
        );
      } else if (res.status === 502) {
        appendBotBubble(
          "🔌 Could not reach the AI service. Please try again in a moment.",
          true,
        );
      } else {
        appendBotBubble("❌ Something went wrong. Please try again.", true);
      }

      history.pop(); // Remove the last user message on error
      return;
    }

    const data = await res.json();
    const reply = data.reply || "Sorry, I didn't get a response.";
    appendBotBubble(reply);
    history.push({ role: "assistant", content: reply });
  } catch {
    removeTyping(typingEl);
    appendBotBubble("❌ Network error. Please check your connection.", true);
    history.pop();
  }
}

/* ── DOM helpers ── */
function appendUserBubble(text) {
  const group = document.createElement("div");
  group.className = "msg-group user-group";
  group.innerHTML = `<div class="msg-bubbles"><div class="bubble user-bubble">${escapeHTML(text)}</div></div>`;
  chatWindow.appendChild(group);
  scrollBottom();
}

function appendBotBubble(text, isError = false) {
  const group = document.createElement("div");
  group.className = "msg-group bot-group";
  group.innerHTML = `
    <div class="bot-avatar" aria-hidden="true">AI</div>
    <div class="msg-bubbles">
      <div class="bubble bot-bubble${isError ? " error-bubble" : ""}">${formatReply(text)}</div>
    </div>`;
  chatWindow.appendChild(group);
  scrollBottom();
}

function appendTyping() {
  const group = document.createElement("div");
  group.className = "msg-group bot-group";
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

function scrollBottom() {
  const main = document.querySelector(".chat-main");
  if (main) main.scrollTop = main.scrollHeight;
}

/* Format reply: convert **bold**, newlines */
function formatReply(text) {
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Auto resize textarea */
function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}
