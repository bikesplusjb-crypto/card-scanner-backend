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
  const price = Number(item && item.price && item.price.value ? item.price.value : 0);
  const shipping =
    Number(
      item &&
      item.shippingOptions &&
      item.shippingOptions[0] &&
      item.shippingOptions[0].shippingCost &&
      item.shippingOptions[0].shippingCost.value
        ? item.shippingOptions[0].shippingCost.value
        : 0
    );

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

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  const value =
    sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  return Number(value.toFixed(2));
}

function removeOutliers(prices) {
  if (prices.length < 4) return prices;

  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  const low = q1 - iqr * 1.5;
  const high = q3 + iqr * 1.5;

  return sorted.filter(p => p >= low && p <= high);
}

function confidenceFromCount(count) {
  if (count >= 20) return "High";
  if (count >= 8) return "Medium";
  if (count >= 3) return "Low-Medium";
  return "Low";
}

function demandFromCount(count) {
  if (count >= 20) return "Very Strong";
  if (count >= 10) return "Strong";
  if (count >= 5) return "Moderate";
  if (count >= 1) return "Thin";
  return "No recent data";
}

/* HOME */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Card Scanner Backend Running",
    routes: [
      "/health",
      "/scan",
      "/value",
      "/api/pokemon-movers",
      "/api/stocks-live"
    ]
  });
});

/* HEALTH */
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend connected" });
});

/* CARD SCANNER */
app.post(
  "/scan",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const frontFile = req.files && (req.files.front && req.files.front[0] || req.files.image && req.files.image[0]);
      const backFile = req.files && req.files.back && req.files.back[0];

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

/* CARD VALUE ENGINE */
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

/* POKEMON MOVERS */
app.get("/api/pokemon-movers", async (req, res) => {
  const watchlist = [
    { name: "Charizard Base Set PSA 10", set: "Base Set", fallback: 13500 },
    { name: "Pikachu Van Gogh", set: "Promo", fallback: 185 },
    { name: "Umbreon VMAX Alt Art", set: "Evolving Skies", fallback: 850 },
    { name: "Lugia V Alt Art", set: "Silver Tempest", fallback: 165 },
    { name: "Moonbreon PSA 10", set: "Evolving Skies", fallback: 1450 }
  ];

  async function getActiveComps(token, query) {
    const ebayUrl =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(query)}` +
      "&category_ids=183454" +
      "&limit=50" +
      "&filter=price:[1..50000],priceCurrency:USD";

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const ebayData = await ebayRes.json();
    const items = ebayData.itemSummaries || [];

    const rawPrices = items
      .map(moneyToNumber)
      .filter(n => n && n > 0 && n < 50000);

    const prices = removeOutliers(rawPrices);
    const stats = calcStats(prices);

    return {
      type: "active_listing_estimate",
      average: stats.average,
      median: median(prices),
      low: stats.low,
      high: stats.high,
      count: stats.count,
      rawCount: rawPrices.length
    };
  }

  try {
    const token = await getEbayToken();

    const movers = await Promise.all(
      watchlist.map(async card => {
        const query = `${card.name} pokemon card`;
        const active = await getActiveComps(token, query);

        const activeAvg = active.average || card.fallback;
        const marketPrice = activeAvg;
        const demand = demandFromCount(active.count);
        const confidence = confidenceFromCount(active.count);

        let signal = "WATCH";
        let risk = "Medium";
        let score = 72;

        if (active.count >= 10) {
          signal = "HOLD";
          score = 82;
        }

        if (active.count >= 20) {
          signal = "BUY";
          score = 90;
        }

        if (marketPrice > card.fallback * 1.25) {
          risk = "Medium-High";
          score += 3;
        }

        if (active.count <= 3) {
          risk = "Thin Market";
          score = 68;
        }

        const trend =
          active.count >= 20 ? 8.5 :
          active.count >= 10 ? 5.2 :
          active.count >= 5 ? 2.8 :
          1.2;

        return {
          name: card.name,
          set: card.set,
          price: Number(marketPrice.toFixed(2)),

          activeAvg: active.average,
          activeMedian: active.median,
          activeLow: active.low,
          activeHigh: active.high,
          activeVolume: active.count,

          soldAvg: null,
          soldMedian: null,
          soldLow: null,
          soldHigh: null,
          soldVolume: 0,

          low: active.low,
          high: active.high,
          volume: active.count,

          demand,
          confidence,
          change: trend,
          signal,
          score: Math.min(score, 98),
          risk,

          reason: `Active listings show ${active.count} current listings. Sold comps are ready but not connected yet.`,

          pricingSource: "Active listings only",
          activeUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
          soldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
        };
      })
    );

    res.json({
      ok: true,
      pricingType: "Sold-comps ready engine; active eBay estimate currently connected",
      updated: new Date().toISOString(),
      movers
    });
  } catch (err) {
    console.error("POKEMON COMPS ERROR:", err.message);

    res.status(500).json({
      ok: false,
      error: "Pokemon comps engine failed",
      details: err.message
    });
  }
});

/* LIVE STOCK API */
app.get("/api/stocks-live", async (req, res) => {
  try {
    const symbols = String(req.query.symbols || "NVDA,AMD,TSLA,MARA,GOOG,PLTR,SMCI")
      .toUpperCase()
      .replace(/\s/g, "");

    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
      encodeURIComponent(symbols);

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = await r.json();

    const results =
      data &&
      data.quoteResponse &&
      data.quoteResponse.result
        ? data.quoteResponse.result
        : [];

    const stocks = results.map(s => {
      const price = Number(s.regularMarketPrice || 0);
      const change = Number(s.regularMarketChange || 0);
      const changePct = Number(s.regularMarketChangePercent || 0);

      let signal = "WATCH";
      let risk = "Medium";
      let score = 80;

      if (changePct >= 3) {
        signal = "HOT";
        score = 94;
        risk = "Medium-High";
      } else if (changePct >= 1) {
        signal = "UPTREND";
        score = 88;
      } else if (changePct <= -3) {
        signal = "RISK";
        score = 70;
        risk = "High";
      }

      return {
        symbol: s.symbol || "",
        name: s.shortName || s.longName || s.symbol || "",
        price: Number(price.toFixed(2)),
        change: Number(change.toFixed(2)),
        changePct: Number(changePct.toFixed(2)),
        volume: s.regularMarketVolume || 0,
        marketCap: s.marketCap || null,
        signal,
        risk,
        score,
        chartUrl: "https://finance.yahoo.com/quote/" + encodeURIComponent(s.symbol || "")
      };
    });

    res.json({
      ok: true,
      updated: new Date().toISOString(),
      stocks
    });
  } catch (err) {
    console.error("STOCK LIVE API ERROR:", err.message);

    res.status(500).json({
      ok: false,
      error: "Live stock API failed",
      details: err.message
    });
  }
});

/* START SERVER */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
