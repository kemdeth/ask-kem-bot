/*
  netlify/functions/chat.js  (FIXED)
  ─────────────────────────────────────────────────────
  Serverless function: receives user message → calls Gemini → returns reply.

  FIXES vs original:
  1. Added input validation — empty/missing message returns 400.
  2. Gemini model string updated to a stable ID.
  3. Rate limit count only recorded on SUCCESS (not on errors).
  4. Catches JSON parse failure on malformed request body.
  5. Clears timeout before every early return to prevent dangling timers.
*/

// const MAX_PER_HOUR = 100;
const MAX_PER_HOUR = 999; 
const HOUR_MS = 60 * 60 * 1000;

// In-memory rate limiting — resets on cold start (fine for serverless)
const ipHistory = {};

// ── SYSTEM PROMPT ────────────────────────────────────────────────────────────
// Update this with Kem's real info: skills, projects, contact details, etc.
const SYSTEM_PROMPT = `You are "Ask Kem", the AI portfolio assistant for Kem Deth — a web developer based in Phnom Penh, Cambodia.

Your job is to answer visitor questions about Kem in a friendly, concise, and professional tone.
Use markdown formatting where it helps clarity (bold for emphasis, bullet lists for skills/projects).
Keep answers focused and under 200 words unless a longer answer is clearly needed.

If you genuinely don't know something specific about Kem, say so honestly and direct the visitor to contact him directly:
- Email: kemdeth@example.com  ← replace with real email
- Portfolio: https://kem-deth.netlify.app/

Never fabricate facts about Kem. Never discuss topics unrelated to his professional background.`;

// ── HANDLER ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── 1. Rate Limiting ────────────────────────────────────────────────────────
  const ip = event.headers["x-nf-client-connection-ip"] || "unknown";
  const now = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);

  if (history.length >= MAX_PER_HOUR) {
    console.warn(`Rate limit hit for IP: ${ip}`);
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: "Rate limit exceeded. Please try again later.",
      }),
    };
  }

  // ── 2. Parse & Validate Request Body ───────────────────────────────────────
  let userMessage, chatHistory;
  try {
    const body = JSON.parse(event.body || "{}");
    userMessage = (body.message || "").trim();
    chatHistory = Array.isArray(body.history) ? body.history : [];
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid request body." }),
    };
  }

  // FIX: Validate message is not empty
  if (!userMessage) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Message cannot be empty." }),
    };
  }

  // ── 3. Validate API Key ─────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not set.");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error." }),
    };
  }

  // ── 4. Build Gemini request ─────────────────────────────────────────────────
  // Map history to Gemini format; guard against malformed entries
  const contents = chatHistory
    .filter((m) => m && m.role && m.content)
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: String(msg.content) }],
    }));

  // Append the new user message
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // ── 5. Call Gemini with timeout ─────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    // FIX: Use gemini-2.0-flash which is the stable, production-ready model.
    // Switch to gemini-2.5-flash-preview-05-20 once it's GA if you want 2.5.
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.6,
          },
        }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error("Gemini request timed out.");
      return {
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: "AI timed out. Please try again." }),
      };
    }
    console.error("Fetch error:", err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Failed to reach AI service." }),
    };
  }

  clearTimeout(timeoutId);

  // ── 6. Handle Gemini API errors ─────────────────────────────────────────────
  if (!res.ok) {
    let errMsg = `Gemini API error: ${res.status}`;
    try {
      const errData = await res.json();
      errMsg = errData?.error?.message || errMsg;
    } catch {
      /* response wasn't JSON */
    }

    console.error(errMsg);

    if (res.status === 429) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: "AI quota exceeded. Please try again shortly.",
        }),
      };
    }

    return {
      statusCode: res.status >= 500 ? 502 : res.status,
      headers,
      body: JSON.stringify({ error: errMsg }),
    };
  }

  // ── 7. Parse reply ──────────────────────────────────────────────────────────
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

  // ── 8. Record rate-limit entry only on success ──────────────────────────────
  history.push(now);
  ipHistory[ip] = history;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ reply }),
  };
};
