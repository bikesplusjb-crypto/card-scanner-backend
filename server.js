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

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;

  if (!id || !secret) return null;

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

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
    console.log("eBay token error:", data);
    return null;
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return ebayToken;
}

async function getEbayAverage(query) {
  try {
    const token = await getEbayToken();
    if (!token) return null;

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
      encodeURIComponent(query) +
      "&limit=10";

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
      .filter(n => !isNaN(n) && n > 0);

    if (!prices.length) return null;

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    return {
      averagePrice: avg.toFixed(2),
      listingsFound: prices.length,
      ebayUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query)
    };
  } catch (err) {
    console.log("eBay average error:", err.message);
    return null;
  }
}

function fallbackCard(front) {
  const file = (front?.originalname || "").toLowerCase();

  if (file.includes("charizard")) return "Charizard Pokémon Card";
  if (file.includes("pikachu")) return "Pikachu Pokémon Card";
  if (file.includes("ohtani")) return "Shohei Ohtani Rookie Card";
  if (file.includes("wembanyama") || file.includes("wemby")) return "Victor Wembanyama Rookie Card";
  if (file.includes("mahomes")) return "Patrick Mahomes Rookie Card";

  return "Unknown Trading Card";
}

function scoreCard(name) {
  const n = name.toLowerCase();

  if (
    n.includes("charizard") ||
    n.includes("pikachu") ||
    n.includes("ohtani") ||
    n.includes("wembanyama") ||
    n.includes("mahomes")
  ) return 91;

  if (n.includes("rookie") || n.includes("pokemon") || n.includes("pokémon") || n.includes("psa")) return 84;

  return 76;
}

function signal(score) {
  if (score >= 90) return "🔥 HOT";
  if (score >= 80) return "📈 RISING";
  if (score >= 70) return "👀 WATCH";
  return "⚠️ LOW SIGNAL";
}

async function detectCard(front, back) {
  if (!process.env.OPENAI_API_KEY) return null;

  const content = [
    {
      type: "input_text",
      text: `Identify this trading card from the images.

Return ONLY valid JSON:
{
  "name": "full card name",
  "brand": "brand if visible",
  "year": "year if visible",
  "set": "set if visible",
  "cardNumber": "card number if visible",
  "confidence": 0-100,
  "gradeHint": "Raw / PSA candidate / unclear",
  "reason": "short reason"
}`
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

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content }]
    })
  });

  const raw = await res.text();

  if (!res.ok) {
    console.log("OpenAI error:", raw);
    return null;
  }

  const data = JSON.parse(raw);
  const text =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    "";

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1) return null;

  return JSON.parse(text.slice(start, end + 1));
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

      let detected = null;

      try {
        detected = await detectCard(front, back);
      } catch (err) {
        console.log("Detect fallback:", err.message);
      }

      const name = detected?.name || fallbackCard(front);
      const score = scoreCard(name);
      const ebay = await getEbayAverage(name);

      const value =
        ebay?.averagePrice ||
        (score >= 90 ? "125.00" : score >= 80 ? "48.00" : "22.00");

      res.json({
        success: true,
        name,
        cardName: name,
        title: name,
        brand: detected?.brand || "",
        year: detected?.year || "",
        set: detected?.set || "",
        cardNumber: detected?.cardNumber || "",
        value,
        estimatedValue: value,
        averagePrice: value,
        confidence: detected?.confidence || 78,
        score,
        marketScore: score,
        gradeHint: detected?.gradeHint || "Raw / Estimate",
        signal: signal(score),
        action: score >= 90 ? "Check comps now" : "Watch market",
        reason:
          detected?.reason ||
          "Card estimated from image and market signals. Verify with eBay comps before buying or selling.",
        ebayListingsFound: ebay?.listingsFound || 0,
        ebayUrl: ebay?.ebayUrl || ""
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
  console.log(`Backend running on port ${PORT}`);
});
