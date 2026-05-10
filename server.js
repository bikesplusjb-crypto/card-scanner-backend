/* ===============================
   CARDGAUGE / TRACK THE MARKET
   AI SCANNER + EBAY CARD MARKET BACKEND
   server.js
================================ */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

let ebayToken = null;
let ebayTokenExpires = 0;

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "CardGauge / Track The Market Backend",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    uptime: process.uptime()
  });
});

function fileToDataUrl(file) {
  const mime = file.mimetype || "image/jpeg";
  const base64 = file.buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

function cleanJsonText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function average(nums) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function normalizeCardQuery(query) {
  let q = String(query || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!q) return "sports trading card";

  const lower = q.toLowerCase();

  const pokemonNames = [
    "charizard","pikachu","umbreon","rayquaza","mewtwo","gengar",
    "eevee","dragonite","lugia","blastoise","snorlax","mew",
    "gyarados","lucario","greninja"
  ];

  if (pokemonNames.includes(lower)) {
    q = `${q} Pokemon card`;
  }

  if (
    lower.includes("pokemon") &&
    !lower.includes("card") &&
    !lower.includes("booster") &&
    !lower.includes("box") &&
    !lower.includes("sealed")
  ) {
    q += " card";
  }

  return q;
}

function isLikelyCardListing(title) {
  const t = String(title || "").toLowerCase();

  const positive = [
    "card","cards","psa","bgs","cgc","sgc","rookie","rc",
    "topps","bowman","panini","prizm","select","optic",
    "pokemon","pokémon","holo","reverse holo","booster",
    "hobby box","sealed","chrome","refractor","auto","autograph",
    "patch","parallel","graded","slab"
  ];

  const negative = [
    "poster","plush","figure","toy","shirt","t-shirt","costume",
    "sticker only","keychain","funko","blanket","pillow","wallet",
    "phone case","digital","code card only"
  ];

  const hasPositive = positive.some(w => t.includes(w));
  const hasNegative = negative.some(w => t.includes(w));

  return hasPositive && !hasNegative;
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) {
    return ebayToken;
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    console.log("Missing eBay credentials");
    return null;
  }

  const auth = Buffer.from(
    process.env.EBAY_CLIENT_ID + ":" + process.env.EBAY_CLIENT_SECRET
  ).toString("base64");

  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body:
        "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
    }
  );

  const data = await response.json();

  if (!data.access_token) {
    console.log("eBay token failed:", data);
    return null;
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + ((data.expires_in || 7200) - 60) * 1000;

  return ebayToken;
}

async function getEbayCardMarket(query) {
  try {
    const token = await getEbayToken();
    const cleanQuery = normalizeCardQuery(query);

    if (!token || !cleanQuery) {
      return {
        query: cleanQuery,
        avgPrice: 0,
        lowPrice: 0,
        highPrice: 0,
        listingCount: 0,
        image: "",
        priceSource: "Missing eBay token or query",
        listings: []
      };
    }

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
      encodeURIComponent(cleanQuery) +
      "&limit=25";

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    const rawItems = Array.isArray(data.itemSummaries)
      ? data.itemSummaries
      : [];

    const listings = rawItems
      .filter(item => isLikelyCardListing(item.title))
      .map(item => ({
        title: item.title || "",
        price: safeNumber(item.price && item.price.value, 0),
        currency: item.price && item.price.currency ? item.price.currency : "USD",
        image: item.image && item.image.imageUrl ? item.image.imageUrl : "",
        url: item.itemWebUrl || ""
      }))
      .filter(item => item.price > 0);

    const prices = listings.map(item => item.price).sort((a, b) => a - b);

    return {
      query: cleanQuery,
      avgPrice: average(prices),
      lowPrice: prices.length ? Math.round(prices[0]) : 0,
      highPrice: prices.length ? Math.round(prices[prices.length - 1]) : 0,
      listingCount: listings.length,
      image: listings.find(x => x.image)?.image || "",
      priceSource: listings.length
        ? "eBay active card listings"
        : "No clean card listings found",
      listings
    };

  } catch (error) {
    console.log("eBay card market error:", error.message);

    return {
      query,
      avgPrice: 0,
      lowPrice: 0,
      highPrice: 0,
      listingCount: 0,
      image: "",
      priceSource: "eBay lookup failed",
      listings: []
    };
  }
}

async function scanWithOpenAI(frontFile, backFile) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      cardName: "Unknown Trading Card",
      player: "Unknown",
      year: "Unknown",
      set: "Unknown",
      brand: "Unknown",
      cardNumber: "Unknown",
      sport: "Unknown",
      signal: "VERIFY",
      confidence: "Low",
      summary: "OpenAI API key missing."
    };
  }

  const images = [
    {
      type: "image_url",
      image_url: { url: fileToDataUrl(frontFile) }
    }
  ];

  if (backFile) {
    images.push({
      type: "image_url",
      image_url: { url: fileToDataUrl(backFile) }
    });
  }

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You identify sports cards, Pokemon cards, trading cards, slabs, sealed wax, and collectibles from images. Return ONLY valid JSON. Do not guess exact market value."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Identify this card. Return JSON only with: cardName, player, year, set, brand, cardNumber, sport, signal, confidence, summary. Signal must be one of GRADE, WATCH, SELL RAW, HOT, VERIFY. Do not include price estimates."
          },
          ...images
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 700
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();

  if (!response.ok) {
    console.error("OpenAI error:", rawText);

    return {
      cardName: "Unknown Trading Card",
      player: "Unknown",
      year: "Unknown",
      set: "Unknown",
      brand: "Unknown",
      cardNumber: "Unknown",
      sport: "Unknown",
      signal: "VERIFY",
      confidence: "Low",
      summary: "AI could not identify this card."
    };
  }

  const apiData = JSON.parse(rawText);
  const content =
    apiData &&
    apiData.choices &&
    apiData.choices[0] &&
    apiData.choices[0].message &&
    apiData.choices[0].message.content
      ? apiData.choices[0].message.content
      : "";

  try {
    return JSON.parse(cleanJsonText(content));
  } catch (error) {
    console.log("AI parse error:", content);

    return {
      cardName: "Unknown Trading Card",
      player: "Unknown",
      year: "Unknown",
      set: "Unknown",
      brand: "Unknown",
      cardNumber: "Unknown",
      sport: "Unknown",
      signal: "VERIFY",
      confidence: "Low",
      summary: "AI result could not be parsed."
    };
  }
}

app.get("/api/card-market", async (req, res) => {
  try {
    const query = req.query.query || req.query.cardName;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Query required"
      });
    }

    const market = await getEbayCardMarket(query);

    res.json({
      success: true,
      cardName: normalizeCardQuery(query),
      avgPrice: market.avgPrice,
      avgSoldPrice: market.avgPrice,
      lowPrice: market.lowPrice,
      highPrice: market.highPrice,
      listingCount: market.listingCount,
      soldCount: 0,
      image: market.image,
      priceSource: market.priceSource,
      listings: market.listings,
      soldCompsUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(normalizeCardQuery(query)) +
        "&LH_Sold=1&LH_Complete=1",
      activeListingsUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(normalizeCardQuery(query))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Card market lookup failed",
      details: error.message
    });
  }
});

app.get("/api/card-price", async (req, res) => {
  try {
    const cardName = req.query.cardName;

    if (!cardName) {
      return res.status(400).json({
        success: false,
        error: "Card name required"
      });
    }

    const market = await getEbayCardMarket(cardName);

    res.json({
      success: true,
      cardName: normalizeCardQuery(cardName),
      avgSoldPrice: market.avgPrice,
      avgPrice: market.avgPrice,
      lowPrice: market.lowPrice,
      highPrice: market.highPrice,
      listingCount: market.listingCount,
      soldCount: 0,
      image: market.image,
      priceSource: market.priceSource,
      listings: market.listings,
      soldCompsUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(normalizeCardQuery(cardName)) +
        "&LH_Sold=1&LH_Complete=1",
      activeListingsUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(normalizeCardQuery(cardName))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Price lookup failed",
      details: error.message
    });
  }
});

app.post(
  "/api/scan-card",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const front = req.files && req.files.front ? req.files.front[0] : null;
      const back = req.files && req.files.back ? req.files.back[0] : null;

      if (!front) {
        return res.status(400).json({
          success: false,
          error: "Front image required"
        });
      }

      const ai = await scanWithOpenAI(front, back);

      const cleanCardName =
        ai.cardName && ai.cardName !== "Unknown Trading Card"
          ? ai.cardName
          : [ai.year, ai.brand, ai.player, ai.set].filter(Boolean).join(" ");

      const market = await getEbayCardMarket(cleanCardName);

      return res.json({
        success: true,
        cardName: cleanCardName || "Unknown Trading Card",
        player: ai.player || "Unknown",
        year: ai.year || "Unknown",
        set: ai.set || "Unknown",
        brand: ai.brand || "Unknown",
        cardNumber: ai.cardNumber || "Unknown",
        sport: ai.sport || "Unknown",
        signal: ai.signal || "VERIFY",
        confidence: ai.confidence || "Medium",
        summary:
          ai.summary ||
          "AI scan complete. Verify exact version, condition, and comps.",
        avgSoldPrice: market.avgPrice,
        avgPrice: market.avgPrice,
        lowPrice: market.lowPrice,
        highPrice: market.highPrice,
        listingCount: market.listingCount,
        soldCount: 0,
        image: market.image,
        priceSource: market.priceSource,
        listings: market.listings,
        soldCompsUrl:
          "https://www.ebay.com/sch/i.html?_nkw=" +
          encodeURIComponent(normalizeCardQuery(cleanCardName)) +
          "&LH_Sold=1&LH_Complete=1",
        activeListingsUrl:
          "https://www.ebay.com/sch/i.html?_nkw=" +
          encodeURIComponent(normalizeCardQuery(cleanCardName)),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error("Scan server error:", error);

      return res.status(500).json({
        success: false,
        error: "Scanner failed on server",
        details: error.message
      });
    }
  }
);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CardGauge / Track The Market backend running on port ${PORT}`);
});
