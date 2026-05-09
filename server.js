/* ===============================
   TRACK THE MARKET
   AI SCANNER + EBAY PRICE BACKEND
   server.js
================================ */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
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
    app: "Track The Market Scanner Backend",
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

function fileToDataUrl(file){
  const mime = file.mimetype || "image/jpeg";
  const base64 = file.buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

function cleanJsonText(text){
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function safeNumber(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getEbayToken(){
  if(ebayToken && Date.now() < ebayTokenExpires){
    return ebayToken;
  }

  if(!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET){
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
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
    }
  );

  const data = await response.json();

  if(!data.access_token){
    console.log("eBay token failed:", data);
    return null;
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + ((data.expires_in || 7200) - 60) * 1000;

  return ebayToken;
}

async function getEbayMarketPrice(cardName){
  try{
    const token = await getEbayToken();

    if(!token || !cardName){
      return {
        avgSoldPrice: 0,
        priceSource: "No eBay token",
        listings: []
      };
    }

    const query = encodeURIComponent(cardName);
    const url =
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${query}&limit=10&sort=price`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

    const listings = items
      .map(item => ({
        title: item.title || "",
        price: safeNumber(item.price?.value, 0),
        currency: item.price?.currency || "USD",
        image: item.image?.imageUrl || "",
        url: item.itemWebUrl || ""
      }))
      .filter(item => item.price > 0);

    const prices = listings.map(item => item.price);

    const avg =
      prices.length > 0
        ? Math.round(prices.reduce((a,b) => a + b, 0) / prices.length)
        : 0;

    return {
      avgSoldPrice: avg,
      priceSource: prices.length ? "eBay active listing average" : "No eBay listings found",
      listings
    };

  }catch(error){
    console.log("eBay price error:", error.message);

    return {
      avgSoldPrice: 0,
      priceSource: "eBay price lookup failed",
      listings: []
    };
  }
}

async function scanWithOpenAI(frontFile, backFile){
  if(!process.env.OPENAI_API_KEY){
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

  if(backFile){
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
          "You identify sports cards, Pokemon cards, trading cards, slabs, and collectibles from images. Return ONLY valid JSON."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Identify this card. Return JSON only with: cardName, player, year, set, brand, cardNumber, sport, signal, confidence, summary. Signal must be one of GRADE, WATCH, SELL RAW, HOT, VERIFY."
          },
          ...images
        ]
      }
    ],
    temperature: 0.15,
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

  if(!response.ok){
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
  const content = apiData?.choices?.[0]?.message?.content || "";

  try{
    return JSON.parse(cleanJsonText(content));
  }catch(error){
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

app.post(
  "/api/scan-card",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 }
  ]),
  async (req, res) => {
    try{
      const front = req.files?.front?.[0];
      const back = req.files?.back?.[0];

      if(!front){
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

      const ebay = await getEbayMarketPrice(cleanCardName);

      const avgSoldPrice = ebay.avgSoldPrice || 0;

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
        summary: ai.summary || "AI scan complete. Verify with eBay comps.",
        avgSoldPrice,
        psa9Value: avgSoldPrice > 0 ? Math.round(avgSoldPrice * 1.35) : 0,
        psa10Value: avgSoldPrice > 0 ? Math.round(avgSoldPrice * 2.25) : 0,
        priceSource: ebay.priceSource,
        listings: ebay.listings,
        timestamp: Date.now()
      });

    }catch(error){
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
  console.log(`Track The Market backend running on port ${PORT}`);
});
