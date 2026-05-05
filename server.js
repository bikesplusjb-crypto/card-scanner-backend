const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

let ebayToken = null;
let ebayTokenExpires = 0;

app.get("/", (req, res) => {
  res.json({
    status: "AI Card Scanner Backend Running",
    endpoints: ["/api/health", "/api/scan-card"]
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "Backend connected",
    time: new Date().toISOString()
  });
});

function safeJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function detectCard(front, back) {
  if (!process.env.OPENAI_API_KEY) return null;

  const content = [
    {
      type: "input_text",
      text: `
You are an expert sports card, Pokémon card, and trading card identifier.

Analyze the uploaded card image(s).

Return ONLY valid JSON. No markdown. No explanation.

Use this exact structure:
{
  "name": "full card name",
  "playerOrCharacter": "player or Pokemon name",
  "sportOrCategory": "baseball / basketball / football / pokemon / other",
  "year": "year if visible or likely",
  "brand": "Topps / Panini / Bowman / Pokemon / etc",
  "set": "set name if visible",
  "cardNumber": "card number if visible",
  "variant": "rookie / refractor / holo / reverse holo / base / unknown",
  "gradeHint": "Raw / PSA candidate / unclear",
  "confidence": 0,
  "conditionNotes": "short condition note",
  "reason": "short reason for identification"
}

Rules:
- If unsure, use best guess but lower confidence.
- Back image may contain year, set, card number, and brand.
- Do not invent exact card number unless visible.
- For Pokémon, identify character and likely card type.
      `
    },
    {
      type: "input_image",
      image_url: `data:${front.mimetype};base64,${front.buffer.toString("base64")}`
    }
  ];

  if (back) {
    content.push({
      type: "input_image",
      image_url: `data:${back.mimetype};base64,${back.buffer.toString("base64")}`
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role: "user", content }]
      }),
      signal: controller.signal
    });

    const raw = await res.text();
    clearTimeout(timeout);

    if (!res.ok) {
      console.log("OpenAI error:", raw);
      return null;
    }

    const data = JSON.parse(raw);

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    return safeJson(text);
  } catch (err) {
    clearTimeout(timeout);
    console.log("OpenAI detect error:", err.message);
    return null;
  }
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return null;
  }

  const auth = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await res.json();

  if (!data.access_token) {
    console.log("eBay token failed:", data);
    return null;
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;

  return ebayToken;
}

function buildSearchQuery(card) {
  return [
    card.year,
    card.brand,
    card.name,
    card.set,
    card.cardNumber,
    card.variant
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/unknown/gi, "")
    .trim();
}

async function getEbayAverage(query) {
  try {
    const token = await getEbayToken();
    if (!token || !query) return null;

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
      encodeURIComponent(query) +
      "&limit=20";

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const data = await res.json();
    const items = data.itemSummaries || [];

    const prices = items
      .map(i => Number(i.price?.value))
      .filter(n => Number.isFinite(n) && n > 0 && n < 10000);

    if (!prices.length) return null;

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    return {
      averagePrice: avg.toFixed(2),
      listingsFound: prices.length,
      ebayUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query)
    };
  } catch (err) {
    console.log("eBay error:", err.message);
    return null;
  }
}

function fallbackName(front) {
  const f = (front?.originalname || "").toLowerCase();

  if (f.includes("charizard")) return "Charizard Pokémon Card";
  if (f.includes("pikachu")) return "Pikachu Pokémon Card";
  if (f.includes("ohtani")) return "Shohei Ohtani Rookie Card";
  if (f.includes("wembanyama") || f.includes("wemby")) return "Victor Wembanyama Rookie Card";
  if (f.includes("mahomes")) return "Patrick Mahomes Rookie Card";

  return "Unknown Trading Card";
}

function marketScore(card) {
  const text = JSON.stringify(card).toLowerCase();

  let score = 70;

  if (text.includes("rookie")) score += 8;
  if (text.includes("psa")) score += 5;
  if (text.includes("holo")) score += 7;
  if (text.includes("refractor")) score += 7;
  if (text.includes("charizard")) score += 18;
  if (text.includes("pikachu")) score += 10;
  if (text.includes("ohtani")) score += 15;
  if (text.includes("wembanyama")) score += 15;
  if (text.includes("mahomes")) score += 12;

  return Math.min(score, 96);
}

function signal(score) {
  if (score >= 90) return "🔥 HOT";
  if (score >= 80) return "📈 RISING";
  if (score >= 70) return "👀 WATCH";
  return "⚠️ LOW SIGNAL";
}

function fallbackValue(score) {
  if (score >= 90) return "125.00";
  if (score >= 80) return "48.00";
  if (score >= 70) return "22.00";
  return "9.00";
}

app.post(
  "/api/scan-card",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const front = req.files?.front?.[0];
      const back = req.files?.back?.[0];

      if (!front) {
        return res.status(400).json({
          success: false,
          error: "Front image required"
        });
      }

      const detected = await detectCard(front, back);

      const card = detected || {
        name: fallbackName(front),
        confidence: 55,
        gradeHint: "Raw / Estimate",
        reason: "Fallback result based on filename because AI detection did not return structured data."
      };

      const query = buildSearchQuery(card) || card.name;
      const ebay = await getEbayAverage(query);

      const score = marketScore(card);
      const value = ebay?.averagePrice || fallbackValue(score);

      res.json({
        success: true,

        name: card.name || fallbackName(front),
        cardName: card.name || fallbackName(front),
        title: card.name || fallbackName(front),

        playerOrCharacter: card.playerOrCharacter || "",
        sportOrCategory: card.sportOrCategory || "",
        brand: card.brand || "",
        year: card.year || "",
        set: card.set || "",
        cardNumber: card.cardNumber || "",
        variant: card.variant || "",

        value,
        estimatedValue: value,
        averagePrice: value,

        confidence: card.confidence || 70,
        score,
        marketScore: score,
        gradeHint: card.gradeHint || "Raw / Estimate",
        conditionNotes: card.conditionNotes || "",
        signal: signal(score),
        action: score >= 90 ? "Check comps now" : "Watch market",

        reason:
          card.reason ||
          "AI scan completed. Verify eBay comps before buying or selling.",

        ebaySearchQuery: query,
        ebayListingsFound: ebay?.listingsFound || 0,
        ebayUrl:
          ebay?.ebayUrl ||
          "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query),

        source: detected ? "OpenAI vision + eBay" : "Fallback + eBay"
      });
    } catch (err) {
      console.error("Scan error:", err);

      res.status(500).json({
        success: false,
        error: "Scan failed",
        message: err.message
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`AI Card Scanner backend running on port ${PORT}`);
});
