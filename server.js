const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 3000;

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let ebayToken = null;
let ebayTokenExpires = 0;

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Card scanner backend running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "card-scanner-backend" });
});

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("Could not get eBay token: " + JSON.stringify(data));
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;

  return ebayToken;
}

async function imageToBase64(file) {
  return file.buffer.toString("base64");
}

async function identifyCard(frontFile, backFile, manualName) {
  if (manualName && manualName.trim()) {
    return {
      name: manualName.trim(),
      year: "",
      brand: "",
      set: "",
      cardNumber: "",
      grade: "Raw / Unknown",
      confidence: 85
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      name: "Unknown Sports Card",
      year: "",
      brand: "",
      set: "",
      cardNumber: "",
      grade: "Raw / Unknown",
      confidence: 50
    };
  }

  const frontBase64 = await imageToBase64(frontFile);
  const content = [
    {
      type: "text",
      text:
        "Identify this trading card. Return ONLY valid JSON with these fields: name, player, year, brand, set, cardNumber, sport, grade, confidence. If unsure, make the best estimate."
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${frontFile.mimetype};base64,${frontBase64}`
      }
    }
  ];

  if (backFile) {
    const backBase64 = await imageToBase64(backFile);
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${backFile.mimetype};base64,${backBase64}`
      }
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content
        }
      ],
      max_tokens: 500
    })
  });

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";

  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      name: raw.slice(0, 120) || "Unknown Sports Card",
      year: "",
      brand: "",
      set: "",
      cardNumber: "",
      grade: "Raw / Unknown",
      confidence: 60
    };
  }
}

function buildSearchQuery(card) {
  const parts = [
    card.year,
    card.brand,
    card.player || card.name,
    card.set,
    card.cardNumber
  ].filter(Boolean);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function getEbaySoldComps(query) {
  const token = await getEbayToken();

  const url =
    "https://api.ebay.com/buy/browse/v1/item_summary/search?" +
    new URLSearchParams({
      q: query,
      limit: "20",
      filter: "buyingOptions:{FIXED_PRICE}"
    }).toString();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
    }
  });

  const data = await response.json();
  const items = data.itemSummaries || [];

  const prices = items
    .map(item => Number(item.price?.value))
    .filter(price => price && price > 1 && price < 100000);

  if (!prices.length) {
    return {
      avgSoldPrice: null,
      lowPrice: null,
      highPrice: null,
      salesCount: 0,
      comps: []
    };
  }

  prices.sort((a, b) => a - b);

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    avgSoldPrice: Number(avg.toFixed(2)),
    lowPrice: Number(prices[0].toFixed(2)),
    highPrice: Number(prices[prices.length - 1].toFixed(2)),
    salesCount: prices.length,
    comps: items.slice(0, 6).map(item => ({
      title: item.title,
      price: item.price?.value,
      url: item.itemWebUrl
    }))
  };
}

function marketScore(avgSoldPrice, salesCount, confidence) {
  let score = 60;

  if (avgSoldPrice >= 25) score += 8;
  if (avgSoldPrice >= 75) score += 8;
  if (avgSoldPrice >= 150) score += 8;
  if (salesCount >= 5) score += 8;
  if (salesCount >= 10) score += 6;
  if (confidence >= 85) score += 5;

  return Math.min(score, 98);
}

function signalFromScore(score) {
  if (score >= 90) return "🔥 HOT";
  if (score >= 82) return "📈 RISING";
  if (score >= 70) return "👀 WATCH";
  return "⚠️ LOW SIGNAL";
}

app.post("/api/scan-card", upload.fields([
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 }
]), async (req, res) => {
  try {
    const frontFile = req.files?.front?.[0];
    const backFile = req.files?.back?.[0];
    const manualName = req.body.manualName || "";

    if (!frontFile && !manualName) {
      return res.status(400).json({
        success: false,
        error: "Upload front image or provide manualName"
      });
    }

    const card = await identifyCard(frontFile, backFile, manualName);
    const searchQuery = buildSearchQuery(card);

    const pricing = await getEbaySoldComps(searchQuery);

    const score = marketScore(
      pricing.avgSoldPrice || 0,
      pricing.salesCount || 0,
      Number(card.confidence || 75)
    );

    res.json({
      success: true,
      name: searchQuery || card.name || "Unknown Card",
      cardName: searchQuery || card.name || "Unknown Card",
      year: card.year || "",
      brand: card.brand || "",
      set: card.set || "",
      cardNumber: card.cardNumber || "",
      grade: card.grade || "Raw / Unknown",
      confidence: Number(card.confidence || 75),
      avgSoldPrice: pricing.avgSoldPrice,
      averagePrice: pricing.avgSoldPrice,
      estimatedValue: pricing.avgSoldPrice,
      value: pricing.avgSoldPrice || "N/A",
      lowPrice: pricing.lowPrice,
      highPrice: pricing.highPrice,
      salesCount: pricing.salesCount,
      soldCount: pricing.salesCount,
      comps: pricing.comps,
      score,
      marketScore: score,
      signal: signalFromScore(score),
      action: score >= 85 ? "Check comps now" : "Research before buying",
      reason:
        pricing.avgSoldPrice
          ? `Based on current eBay market listings found for "${searchQuery}". Always verify recent sold comps, condition, grade, and exact card match before buying.`
          : `Card identified as "${searchQuery}", but no reliable pricing was returned. Use sold comps links to verify manually.`
    });

  } catch (error) {
    console.error("SCAN ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Scan failed",
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Card scanner backend running on port ${PORT}`);
});
