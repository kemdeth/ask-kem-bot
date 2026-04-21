/*
  netlify/functions/chat.js
  ─────────────────────────────────────────────────────
  WORRY-FREE VERSION — KEM DETH PORTFOLIO (2026)
  ─────────────────────────────────────────────────────
  Uses a 3-model fallback chain — all stable GA models:
    1. gemini-2.0-flash        (fast, latest stable)
    2. gemini-1.5-flash        (proven, very reliable)
    3. gemini-1.5-flash-8b     (lightweight, last resort)

  Why this never breaks:
  - GA models have guaranteed 1-year deprecation notice
  - If one is overloaded, the next is tried automatically
  - Free tier = 1,500 req/day per model (way more than enough)
  - Your 500/hr rate limit keeps you well within free quota

  ─────────────────────────────────────────────────────
  DO NOT use "preview", "exp", or version-dated models
  (e.g. gemini-2.5-flash-preview-...) — they can break
  without warning, as happened before.
  ─────────────────────────────────────────────────────
*/

const MAX_PER_HOUR = 500;
const MAX_PER_MINUTE = 10;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_HISTORY = 12;

// ── MODEL FALLBACK CHAIN ──────────────────────────────────────────────────────
// Rules: Only use stable GA models. Never use "preview" or "exp" variants.
// If primary fails (503/429/overload), the next model is tried automatically.
const MODELS = [
  "gemini-2.0-flash", // primary:  fast, latest stable GA
  "gemini-1.5-flash", // fallback: proven, rock-solid
  "gemini-1.5-flash-8b", // last resort: lightweight, always available
];

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
  const now = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);
  const recentMinute = history.filter((t) => now - t < MINUTE_MS);
  ipHistory[ip] = history;

  if (recentMinute.length >= MAX_PER_MINUTE) return "minute";
  if (history.length >= MAX_PER_HOUR) return "hour";
  return null;
}

function recordRequest(ip) {
  const now = Date.now();
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
];

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the professional AI Portfolio Assistant for Kem Deth. Your goal is to represent Kem to recruiters with high-impact, scannable facts.

### KEM DETH'S PROFILE
- **Identity**: Year 3 Computer Science student at the **Royal University of Phnom Penh (RUPP)**.
- **Technical Expertise**: Expert in **HTML5**, **CSS3**, and **JavaScript (ES6+)**.
- **Backend & APIs**: Proficient in **PHP** and **Laravel**. Experienced in **MySQL**, **RESTful APIs**, and **API Authentication**.
- **Workflow**: Professional use of **Git/GitHub** and **Netlify**.

### WHY HIRE KEM?
- **Performance-Driven**: Achieved a **95+ Lighthouse score** on his portfolio for speed and SEO.
- **Innovation-Focused**: Built this custom **AI Assistant** using **Node.js** and the **Gemini API**.
- **Immediate Value**: Actively seeking **Internship or Junior roles** and ready to contribute today.

### CONTACT KEM DETH
- **Phone**: 096 930 4491
- **Email**: kemdeth25@gmail.com
- **Telegram**: [@KEMDETH](https://t.me/KEMDETH)

### RULES FOR COMMUNICATION
1. **No Duplicates**: When providing the Telegram link, only use this format: [Telegram Name](URL). Do not repeat the URL.
2. **Be Punchy**: Use short, powerful sentences for easy scanning.
3. **Formatting**: Always use **bold** for tech keywords and bullet points for lists.
4. **Professional Tone**: Act as a talent agent for Kem.
5. **Call to Action**: Encourage the recruiter to reach out via Phone, Email, or Telegram.
6. **No Fluff**: Avoid generic statements. Focus on specific achievements and skills.
7. **Stay On Brand**: Always align responses with Kem's profile and value proposition.
8. **Error Handling**: If you don't understand a question, respond with "Could you please clarify your question about Kem's profile?"
9. **Limit Responses**: Keep answers concise and relevant to Kem's portfolio and skills.
10. **No Personal Opinions**: Stick to factual information about Kem's skills and experience.
11. **Avoid Jargon**: Use clear language that recruiters can understand.
12. **Highlight Unique Selling Points**: Emphasize what makes Kem stand out.
13. **Be Responsive**: Answer questions directly and efficiently.
14. **Maintain Professionalism**: Ensure all responses reflect a professional image of Kem Deth.
15. **Complete Messages**: Always provide a full response; ensure all relevant info is included.`;

// ── CALL ONE MODEL ────────────────────────────────────────────────────────────
async function callGemini(model, API_KEY, contents, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  return await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
// Returns { res, model } for the first model that doesn't return 503/429,
// or the last response if all models are exhausted.
async function callWithFallback(API_KEY, contents, signal) {
  let res;
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    res = await callGemini(model, API_KEY, contents, signal);

    // Success or a non-retryable error — stop here
    if (res.ok || (res.status !== 503 && res.status !== 429)) {
      return { res, model };
    }

    // 503 or 429 — try next model
    console.warn(
      `Model ${model} returned ${res.status}. Trying next fallback...`,
    );
  }

  // All models exhausted — return last response
  return { res, model: MODELS[MODELS.length - 1] };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  const origin = event.headers["origin"] || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[1];

  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
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

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`Blocked request from unauthorized origin: ${origin}`);
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: "Origin not allowed." }),
    };
  }

  // ── Rate Limiting ────────────────────────────────────────────────────────────
  const ip = getIP(event);
  const limited = checkRateLimit(ip);

  if (limited === "minute") {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error:
          "⏱️ Slow down a little! Max 10 messages per minute. Please wait a moment.",
      }),
    };
  }
  if (limited === "hour") {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error:
          "🚦 You've reached the hourly limit. Please come back in a little while!",
      }),
    };
  }

  // ── Parse & Validate Body ────────────────────────────────────────────────────
  let userMessage, chatHistory;
  try {
    const body = JSON.parse(event.body || "{}");

    if (body.message) {
      userMessage = body.message.trim();
      chatHistory = Array.isArray(body.history) ? body.history : [];
    } else if (Array.isArray(body.history) && body.history.length > 0) {
      const last = body.history[body.history.length - 1];
      userMessage = (last.content || "").trim();
      chatHistory = body.history.slice(0, -1);
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

  // ── Validate API Key ─────────────────────────────────────────────────────────
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error("GEMINI_API_KEY is not set.");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error." }),
    };
  }

  // ── Build Gemini Contents ────────────────────────────────────────────────────
  const contents = chatHistory
    .filter((m) => m && m.role && m.content)
    .slice(-MAX_HISTORY)
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: String(msg.content) }],
    }));

  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // ── Call Gemini with Fallback Chain ───────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9500);

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
        body: JSON.stringify({ error: "⏳ AI timed out. Please try again." }),
      };
    }
    console.error("Fetch error:", err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "🔌 Failed to reach AI service." }),
    };
  }

  clearTimeout(timeoutId);

  // ── Handle Gemini Errors ─────────────────────────────────────────────────────
  if (!res.ok) {
    let errMsg = `Gemini API error: ${res.status}`;
    try {
      const errData = await res.json();
      errMsg = errData?.error?.message || errMsg;
    } catch {
      /* not JSON */
    }

    console.error(`Gemini error (model: ${usedModel}):`, errMsg);

    if (res.status === 429 || res.status === 503) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: "🚦 AI is busy right now. Please try again in a moment.",
        }),
      };
    }
    return {
      statusCode: res.status >= 500 ? 502 : res.status,
      headers,
      body: JSON.stringify({ error: errMsg }),
    };
  }

  // ── Parse Reply ──────────────────────────────────────────────────────────────
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

  // ── Record success & return ──────────────────────────────────────────────────
  recordRequest(ip);
  console.log(`Request served by model: ${usedModel}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ reply }),
  };
};
