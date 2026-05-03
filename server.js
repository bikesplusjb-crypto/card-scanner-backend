const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");
const OpenAI = require("openai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let ebayToken = null;
let ebayTokenExpires = 0;

function safe(value, fallback = "") {
  if (!value || value === null || value === "null") return fallback;
  return String(value).trim() || fallback;
}

function extractJson(text) {
  if (!text) return null;

  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

function cleanYear(year) {
  if (!year) return "";
  const match = String(year).match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
  if (!match) return "";

  const y = Number(match[0]);
  const currentYear = new Date().getFullYear();

  if (y < 1900 || y > currentYear) return "";
  return String(y);
}

function fallbackScanResult() {
  return {
    ok: true,
    cardName: "Unknown Card",
    player: "Unknown Player",
    sport: "",
    year: "",
    brand: "",
    set: "",
    team: "",
    cardNumber: "",
    confidence: "Low",
    notes: "Fallback scan result used."
  };
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  const clientId = (process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.EBAY_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay keys");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope"
    }).toString()
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error("Could not get eBay token: " + JSON.stringify(data));
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;

  return ebayToken;
}

function moneyToNumber(item) {
  const price = Number(item?.price?.value || 0);
  const shipping = Number(item?.shippingOptions?.[0]?.shippingCost?.value || 0);
  return price + shipping;
}

function calcStats(prices) {
  if (!prices.length) {
    return { average: null, low: null, high: null, count: 0 };
  }

  const sorted = prices.sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    average: Number(average.toFixed(2)),
    low: Number(low.toFixed(2)),
    high: Number(high.toFixed(2)),
    count: prices.length
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Front + Back Card Scanner Backend Running",
    routes: ["/health", "/scan", "/value"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend connected" });
});

app.post(
  "/scan",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const frontFile = req.files?.front?.[0] || req.files?.image?.[0];
      const backFile = req.files?.back?.[0];

      if (!frontFile) {
        return res.json(fallbackScanResult());
      }

      const content = [
        {
          type: "input_text",
          text: `
You are a sports card identification engine.

You may receive:
1. Front image
2. Back image

Use BOTH images when available.

Important rules:
- Use the back image for year, card number, copyright line, set, and brand.
- Do NOT guess the year.
- If the year is not visible, use empty string.
- If card number is visible on the back, include it.
- Return ONLY valid JSON.
- No markdown.
- No explanation.
- Do not use null.

Use this exact JSON format:

{
  "ok": true,
  "cardName": "",
  "player": "",
  "sport": "",
  "year": "",
  "brand": "",
  "set": "",
  "team": "",
  "cardNumber": "",
  "confidence": "",
  "notes": ""
}
`
        }
      ];

      const frontBase64 = frontFile.buffer.toString("base64");
      content.push({
        type: "input_image",
        image_url: `data:${frontFile.mimetype || "image/jpeg"};base64,${frontBase64}`
      });

      if (backFile) {
        const backBase64 = backFile.buffer.toString("base64");
        content.push({
          type: "input_image",
          image_url: `data:${backFile.mimetype || "image/jpeg"};base64,${backBase64}`
        });
      }

      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [{ role: "user", content }]
      });

      const rawText = response.output_text || "";
      const parsed = extractJson(rawText);

      if (!parsed) {
        return res.json(fallbackScanResult());
      }

      const fixedYear = cleanYear(parsed.year);

      return res.json({
        ok: true,
        cardName: safe(parsed.cardName, parsed.player || "Unknown Card"),
        player: safe(parsed.player, parsed.cardName || "Unknown Player"),
        sport: safe(parsed.sport, ""),
        year: fixedYear,
        brand: safe(parsed.brand, ""),
        set: safe(parsed.set, ""),
        team: safe(parsed.team, ""),
        cardNumber: safe(parsed.cardNumber, ""),
        confidence: safe(parsed.confidence, "Medium"),
        notes: safe(parsed.notes, backFile ? "Front and back scan used." : "Front-only scan used.")
      });
    } catch (err) {
      console.error("SCAN ERROR:", err.message);
      return res.json(fallbackScanResult());
    }
  }
);

app.get("/value", async (req, res) => {
  try {
    const { player = "", year = "", brand = "", set = "", cardNumber = "" } = req.query;

    const query = `${player} ${year} ${brand} ${set} ${cardNumber} sports card`
      .replace(/\s+/g, " ")
      .trim();

    if (!query || query.length < 3) {
      return res.json({ ok: false, error: "Missing search details" });
    }

    const token = await getEbayToken();

    const ebayUrl =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(query)}` +
      "&category_ids=212" +
      "&limit=25" +
      "&filter=price:[1..10000],priceCurrency:USD";

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const ebayData = await ebayRes.json();

    if (!ebayRes.ok) {
      return res.status(500).json({
        ok: false,
        error: "eBay API failed",
        details: ebayData
      });
    }

    const items = ebayData.itemSummaries || [];

    const prices = items
      .map(moneyToNumber)
      .filter(n => n && n > 0 && n < 10000);

    const stats = calcStats(prices);

    let marketSignal = "Flat";
    let signalColor = "yellow";

    if (stats.count >= 15 && stats.average >= 75) {
      marketSignal = "Hot";
      signalColor = "green";
    } else if (stats.count <= 3) {
      marketSignal = "Thin Market";
      signalColor = "gray";
    } else if (stats.average < 10) {
      marketSignal = "Cold";
      signalColor = "red";
    }

    res.json({
      ok: true,
      query,
      estimateType: "Active listing estimate",
      estimatedValue: stats.average,
      low: stats.low,
      high: stats.high,
      listingCount: stats.count,
      marketSignal,
      signalColor,
      activeUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
      soldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
    });
  } catch (err) {
    console.error("VALUE ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: "Value engine failed",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
