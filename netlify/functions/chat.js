/*
  netlify/functions/chat.js
  ─────────────────────────────────────────────────────
  ✅  PRODUCTION VERSION — FIXED
  ─────────────────────────────────────────────────────
*/

const MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const MAX_HISTORY = 10;

const ipHistory = {};

function getIP(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    "unknown"
  );
}

function checkLimit(ip) {
  const now = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);
  ipHistory[ip] = history;
  return { blocked: history.length >= MAX_PER_HOUR };
}

function recordRequest(ip) {
  const now = Date.now();
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);
  history.push(now);
  ipHistory[ip] = history;
}

const ALLOWED_ORIGINS = [
  "https://kem-deth.netlify.app",
  "https://ask-kem-bot.netlify.app",
];

const SYSTEM_PROMPT = `You are an AI assistant on Kem Deth's portfolio website. Your job is to answer questions about Kem in a friendly, concise, and professional way.

Here is everything you know about Kem:

**Personal**
- Full name: Kem Deth
- Location: Phnom Penh, Cambodia
- Role: Frontend Developer (seeking internships and junior roles)
- Open to: Remote and on-site positions
- Email: kemdeth25@gmail.com
- GitHub: github.com/kemdeth
- LinkedIn: linkedin.com/in/kemdeth
- Telegram: @KEMDETH

**Education**
- Bachelor's in Computer Science at Royal University of Phnom Penh (2024–present)

**Certifications**
- Responsive Web Design — freeCodeCamp
- JavaScript Algorithms & Data Structures — freeCodeCamp
- Web Development Bootcamp — Udemy
- Git & GitHub Essentials — Coursera

**Technical Skills**
- HTML5 (90%), CSS3 & Bootstrap 5 (85%), JavaScript ES6+ (75%)
- Responsive / Mobile-First design (88%)
- Git & GitHub (80%), VS Code (92%), Browser DevTools (78%)
- Figma basics (60%), PHP (72%), Laravel basics (60%)
- Prompt Engineering (90%), Web Accessibility (70%)

**Soft Skills**
- Communication, Teamwork, Time Management, Problem Solving, Quick Learner, Adaptability

**Projects**
1. Personal Portfolio Website (Live at kem-deth.netlify.app)
   - Built with HTML, CSS, JavaScript, Netlify, serverless functions
   - Features: dark/light mode, typing effect, contact form via Telegram, 95+ Lighthouse score

2. E-Commerce Storefront (Live at e-commerce-fronstore.netlify.app)
   - GitHub: github.com/kemdeth/E-Commerce-Storefront
   - Built with HTML, Bootstrap 5, JavaScript, CSS Animations
   - Features: product listings, dynamic cart, real-time price recalculation

3. Ask Kem — AI Portfolio Assistant (this project)
   - Built with HTML, CSS, JavaScript, Google Gemini API, Netlify Functions

**Experience**
- 2024: Freelance Web Developer — designed and built responsive websites for local businesses in Phnom Penh
- 2023: Started self-teaching web development
- 600+ hours of learning logged

**Rules you must follow:**
- Only answer questions about Kem's skills, experience, projects, and availability
- Be friendly, warm, and concise — 1 to 3 short paragraphs max
- If asked something unrelated (politics, general knowledge, etc.), politely say you can only help with questions about Kem
- Never invent experience, skills, or projects Kem does not have
- If asked if Kem is available for hire, say YES — actively looking for internships and junior frontend roles
- Use **bold** for emphasis. Keep answers readable and clean.`;

exports.handler = async function (event) {
  const origin = event.headers["origin"] || "";

  // FIX: always allow requests from allowed origins,
  // and fall back to the first allowed origin for same-origin requests
  // (Netlify functions called from the same site may have no origin header)
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Rate limit check
  const ip = getIP(event);
  if (checkLimit(ip).blocked) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: "Too many requests. Please try again later.",
      }),
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { history } = body;

  // Validate history array
  if (!Array.isArray(history) || history.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "No messages provided." }),
    };
  }

  // Validate last message
  const lastMsg = history[history.length - 1];
  if (
    !lastMsg?.content ||
    typeof lastMsg.content !== "string" ||
    lastMsg.content.trim().length === 0
  ) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Empty message." }),
    };
  }
  if (lastMsg.content.length > 500) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Message too long." }),
    };
  }

  // Check API key
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error(
      "❌ GEMINI_API_KEY is not set in Netlify environment variables.",
    );
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "API key not configured. Please contact the site owner.",
        code: "MISSING_API_KEY",
      }),
    };
  }

  // Build Gemini request
  const trimmed = history.slice(-MAX_HISTORY);
  const contents = trimmed.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "Failed to reach the AI. Please try again shortly.",
          code: "GEMINI_ERROR",
          geminiStatus: res.status,
        }),
      };
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) {
      console.error("Empty reply from Gemini:", JSON.stringify(data));
      throw new Error("Empty reply from Gemini");
    }

    recordRequest(ip);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("Function error:", err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Failed to get a response. Please try again.",
        code: "UNKNOWN_ERROR",
      }),
    };
  }
};
