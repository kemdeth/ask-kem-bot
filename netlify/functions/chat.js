/*
  netlify/functions/chat.js
  ─────────────────────────────────────────────────────
  KEM DETH PORTFOLIO — FINAL CLEAN VERSION (2026)
  ─────────────────────────────────────────────────────
  Model fallback chain (Updated for June 2026 deprecations):
    1. gemini-3.5-flash        → primary — latest 2026 stable GA
    2. gemini-3.1-flash-lite   → fallback — super fast stable
    3. gemini-2.5-flash        → fallback — robust stable
    4. gemini-2.5-flash-lite   → fallback — low latency stable
  ─────────────────────────────────────────────────────
*/

const MAX_PER_HOUR   = 500;
const MAX_PER_MINUTE = 10;
const HOUR_MS        = 60 * 60 * 1000;
const MINUTE_MS      = 60 * 1000;
const MAX_HISTORY    = 12;

// ── MODEL FALLBACK CHAIN ──────────────────────────────────────────────────────
const MODELS = [
  "gemini-3.5-flash",        // primary — fast, latest stable GA
  "gemini-3.1-flash-lite",   // fallback — ultra fast stable
  "gemini-2.5-flash",        // fallback — robust older stable
  "gemini-2.5-flash-lite",   // fallback — light-weight last resort
];

// ── IN-MEMORY RATE LIMIT STORE ────────────────────────────────────────────────
const ipHistory = {};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getIP(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    "unknown"
  );
}

function checkRateLimit(ip) {
  const now     = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);
  const recentMinute = history.filter((t) => now - t < MINUTE_MS);
  ipHistory[ip] = history; // update cleaned list

  if (recentMinute.length >= MAX_PER_MINUTE) return "minute";
  if (history.length    >= MAX_PER_HOUR)    return "hour";
  return null;
}

function recordRequest(ip) {
  const now     = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);
  history.push(now);
  ipHistory[ip] = history;
}

// ── CORS WHITELIST ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://kem-deth.netlify.app",
  "https://ask-kem-bot.netlify.app",
  "http://localhost:8888",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3999",  // Netlify dev static server port
];

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
# IDENTITY
You are **Ask Kem** — a sharp, confident AI assistant built into Kem Deth's personal portfolio.
Your sole purpose is to represent Kem to recruiters, collaborators, and visitors in the most compelling, honest, and efficient way possible.
Think of yourself as a knowledgeable talent agent who knows Kem inside out.

---

# KEM DETH — FULL PROFILE

## Education
- **Year 3 Computer Science** student at the **Royal University of Phnom Penh (RUPP)**
- Expected graduation: **2026**

## Technical Skills
- **Frontend**: HTML5, CSS3, JavaScript (ES6+) — expert level
- **Backend**: PHP, Laravel — proficient
- **Database**: MySQL, RESTful API design, API Authentication
- **Tooling**: Git, GitHub, Netlify, Node.js, Gemini API

## Key Achievements
- 🏆 **95+ Lighthouse score** on his portfolio (Performance, SEO, Accessibility)
- 🤖 Built this **AI Portfolio Assistant** from scratch using Node.js + Gemini API
- 🚀 Deployed full-stack projects live with CI/CD on Netlify

## Availability
- Actively seeking **Internship** or **Junior Developer** roles
- Available to start **immediately**
- Open to **remote** or **on-site** opportunities in Phnom Penh

## Contact
- 📞 Phone: **096 930 4491**
- 📧 Email: **kemdeth25@gmail.com**
- ✈️ Telegram: [@KEMDETH](https://t.me/KEMDETH)

---

# RESPONSE RULES

## Tone & Persona
- Be confident, warm, and professional — like a sharp recruiter who believes in their candidate
- Never sound robotic or generic. Sound human and direct
- Use "Kem" naturally in conversation, not "the candidate" or "he/him" excessively

## Response Length & Format
- **Short factual questions** → 1–3 sentences max. No bullet list needed
- **Skill or project questions** → Use bullet points with **bold** tech keywords
- **Contact requests** → Always end with all 3 contact options in one clean block
- **Comparison or "why hire" questions** → Lead with the strongest differentiator, then support with 2–3 facts
- Never write walls of text. Prioritize scannability

## Formatting Standards
- Bold all technology names: **JavaScript**, **Laravel**, **MySQL**, etc.
- Use bullet points for lists of 3+ items
- Telegram link format: [@KEMDETH](https://t.me/KEMDETH) — never write the raw URL separately
- Do not use headers (###) inside responses — keep it conversational

## Boundaries
- Only answer questions about Kem's skills, projects, education, availability, and contact
- If asked something off-topic, politely redirect:
  → *"I'm only here to tell you about Kem! Is there something specific about his skills or background you'd like to know?"*
- Never fabricate projects, skills, or experience Kem doesn't have
- Never share opinions — only facts and achievements

## Smart Clarification
- If a question is vague, ask ONE specific clarifying question
  → Example: "Are you asking about Kem's frontend skills or his backend experience?"

## Call to Action
- Hiring-related answers should end with a natural CTA
  → e.g. *"Feel free to reach out directly — Kem is ready to chat."*
- Don't force a CTA on every single message — use judgment

---

# ANTI-PATTERNS (never do these)
- ❌ Never repeat the same contact info more than once per conversation unless asked again
- ❌ Never use phrases like "Great question!", "Certainly!", or "Of course!"
- ❌ Never give a numbered list for things that should flow as a sentence
- ❌ Never ignore part of a question to give a shorter answer
- ❌ Never say "I don't have that information" without offering what you *do* know
`;

// ── CALL ONE MODEL ────────────────────────────────────────────────────────────
async function callGemini(model, API_KEY, contents, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  return fetch(url, {
    method: "POST",
    signal,
    headers: { 
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY // Header auth helps with restricted key types
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.5,
        topP: 0.85,
      },
    }),
  });
}

// ── TRY ALL MODELS IN ORDER ───────────────────────────────────────────────────
async function callWithFallback(API_KEY, contents, signal) {
  let res;
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    res = await callGemini(model, API_KEY, contents, signal);

    if (res.ok || (res.status !== 503 && res.status !== 429 && res.status !== 404)) {
      return { res, model };
    }

    console.warn(`Model ${model} returned ${res.status}. Trying next fallback…`);
  }

  return { res, model: MODELS[MODELS.length - 1] };
}

// ── HELPER TO FIND THE BEST API KEY VARIABLE ──────────────────────────────────
function getValidApiKey() {
  const keysToTry = [
    process.env.GEMINI_API_KEY,
    process.env.ChatBot_API_Key,
    process.env.CHATBOT_API_KEY
  ];

  for (let key of keysToTry) {
    if (!key) continue;
    
    let cleanKey = key.trim().replace(/^['"]|['"]$/g, "");
    
    // Safety block: Skip JWT authentication tokens used internally by Netlify
    if (cleanKey.startsWith("eyJ")) {
      continue;
    }
    
    return cleanKey;
  }
  return null;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  const origin = event.headers["origin"] || "";

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`Blocked request from unauthorized origin: ${origin}`);
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Origin not allowed." }),
    };
  }

  const headers = {
    "Access-Control-Allow-Origin":  origin || ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed." }),
    };
  }

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  const ip      = getIP(event);
  const limited = checkRateLimit(ip);

  if (limited === "minute") {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: "⏱️ Slow down a little! Max 10 messages per minute.",
      }),
    };
  }
  if (limited === "hour") {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: "🚦 Hourly limit reached. Please come back in a little while!",
      }),
    };
  }

  // ── Parse & Validate Body ─────────────────────────────────────────────────
  let userMessage, chatHistory;
  try {
    const body = JSON.parse(event.body || "{}");
    if (body.message) {
      userMessage  = body.message.trim();
      chatHistory  = Array.isArray(body.history) ? body.history : [];
    } else if (Array.isArray(body.history) && body.history.length > 0) {
      const last   = body.history[body.history.length - 1];
      userMessage  = (last.content || "").trim();
      chatHistory  = body.history.slice(0, -1);
    }
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid request body." }),
    };
  }

  if (!userMessage) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Message cannot be empty." }),
    };
  }

  // ── Retrieve & Validate Correct API Key ───────────────────────────────────
  const API_KEY = getValidApiKey();

  // Print a useful local debug layout so you can easily verify what is loading
  console.log("┌─── [GEMINI KEY RESOLVER] ─────────────────────────────");
  if (API_KEY) {
    console.log(`│ 📂 Selected Key Length: ${API_KEY.length} characters`);
    console.log(`│ 🔎 Selected Key Starts With: "${API_KEY.substring(0, 8)}..."`);
    console.log(`│ 🔎 Selected Key Ends With: "...${API_KEY.substring(API_KEY.length - 4)}"`);
  } else {
    console.log("│ ❌ ERROR: No valid API Key detected!");
    console.log("│    Please set either 'GEMINI_API_KEY' or 'ChatBot_API_Key' in your .env file.");
  }
  console.log("└───────────────────────────────────────────────────────");

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error: Gemini API key not found." }),
    };
  }

  // ── Build Gemini Contents ─────────────────────────────────────────────────
  const contents = chatHistory
    .filter((m) => m && m.role && m.content)
    .slice(-MAX_HISTORY)
    .map((msg) => ({
      role:  msg.role === "user" ? "user" : "model",
      parts: [{ text: String(msg.content) }],
    }));

  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // ── Call Gemini (with 9.5s timeout + model fallback) ─────────────────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 9500);

  let res, usedModel;
  try {
    ({ res, model: usedModel } = await callWithFallback(
      API_KEY,
      contents,
      controller.signal,
    ));
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error("Gemini request timed out.");
      return {
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: "⏳ AI took too long. Please try again." }),
      };
    }
    console.error("Network error calling Gemini:", err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "🔌 Could not reach AI service." }),
    };
  }

  clearTimeout(timeoutId);

  // ── Handle Gemini Errors ──────────────────────────────────────────────────
  if (!res.ok) {
    let errMsg = `Gemini API error: ${res.status}`;
    try {
      const errData = await res.json();
      errMsg = errData?.error?.message || errMsg;
    } catch { /* not JSON */ }

    console.error(`Gemini error (model: ${usedModel}, status: ${res.status}):`, errMsg);

    if (res.status === 400 && errMsg.toLowerCase().includes("api key")) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "API key is invalid or expired. Please renew the API key in your environment variables.",
        }),
      };
    }

    if (res.status === 429 || res.status === 503) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: "🚦 AI is busy right now. Please try again in a moment." }),
      };
    }

    return {
      statusCode: res.status >= 500 ? 502 : res.status,
      headers,
      body: JSON.stringify({ error: errMsg }),
    };
  }

  // ── Parse Reply ───────────────────────────────────────────────────────────
  let reply;
  try {
    const data = await res.json();
    reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  } catch {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Failed to parse AI response." }),
    };
  }

  if (!reply) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "AI returned an empty response." }),
    };
  }

  // ── Success ───────────────────────────────────────────────────────────────
  recordRequest(ip);
  console.log(`[OK] Served by: ${usedModel}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ reply }),
  };
};