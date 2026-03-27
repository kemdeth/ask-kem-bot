/*
  netlify/functions/chat.js
  ─────────────────────────────────────────────────────
  Serverless function: receives user message → calls Gemini → returns reply.
*/

const MAX_PER_HOUR = 500; // generous limit for real users
const MAX_PER_MINUTE = 10; // anti-spam: max 10 messages per minute per IP
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// In-memory rate limiting — resets on cold start (fine for serverless)
const ipHistory = {};

// ── SYSTEM PROMPT ────────────────────────────────────────────────────────────
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

  // Filter to only requests within the last hour
  const history = (ipHistory[ip] || []).filter((t) => now - t < HOUR_MS);

  // Count requests in the last minute for anti-spam
  const recentMinute = history.filter((t) => now - t < MINUTE_MS);

  if (recentMinute.length >= MAX_PER_MINUTE) {
    console.warn(`Per-minute rate limit hit for IP: ${ip}`);
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error:
          "⏱️ Slow down a little! You can send up to 10 messages per minute. Please wait a moment.",
      }),
    };
  }

  if (history.length >= MAX_PER_HOUR) {
    console.warn(`Hourly rate limit hit for IP: ${ip}`);
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error:
          "🚦 You've reached the hourly limit. Please come back in a little while!",
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
  const contents = chatHistory
    .filter((m) => m && m.role && m.content)
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: String(msg.content) }],
    }));

  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // ── 5. Call Gemini with timeout ─────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
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
          error: "🚦 AI quota exceeded. Please try again shortly.",
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
