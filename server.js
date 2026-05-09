/* ===============================
   TRACK THE MARKET
   REAL AI CARD SCANNER BACKEND
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
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

/* ===============================
   TEST ROUTES
================================ */

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

/* ===============================
   HELPERS
================================ */

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

function safeNumber(value, fallback = 75) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildFallbackResult() {
  return {
    success: true,
    cardName: "Sports Trading Card",
    player: "Unknown",
    year: "Unknown",
    set: "Unknown",
    brand: "Unknown",
    cardNumber: "Unknown",
    signal: "SCAN READY",
    confidence: "Low",
    avgSoldPrice: 75,
    psa9Value: 100,
    psa10Value: 170,
    summary:
      "Card image uploaded successfully. AI could not fully identify the card. Use manual entry or clearer front/back photos.",
    source: "fallback"
  };
}

/* ===============================
   REAL AI SCANNER
================================ */

async function scanWithOpenAI(frontFile, backFile) {
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackResult();
  }

  const imageInputs = [
    {
      type: "image_url",
      image_url: {
        url: fileToDataUrl(frontFile)
      }
    }
  ];

  if (backFile) {
    imageInputs.push({
      type: "image_url",
      image_url: {
        url: fileToDataUrl(backFile)
      }
    });
  }

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You identify sports cards, Pokemon cards, trading cards, and collectibles from images. Return ONLY valid JSON. Do not include markdown."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Identify this trading card from the image. Return JSON with these exact fields: cardName, player, year, set, brand, cardNumber, sport, signal, confidence, avgSoldPrice, psa9Value, psa10Value, summary. If unsure, make the best estimate and say confidence Low. avgSoldPrice should be a realistic rough estimate in USD, number only. signal must be one of: GRADE, WATCH, SELL RAW, HOT, SCAN READY."
          },
          ...imageInputs
        ]
      }
    ],
    temperature: 0.2,
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
    console.error("OPENAI ERROR:", rawText);
    return buildFallbackResult();
  }

  let apiData;

  try {
    apiData = JSON.parse(rawText);
  } catch (error) {
    console.error("OPENAI RAW PARSE ERROR:", rawText);
    return buildFallbackResult();
  }

  const content =
    apiData &&
    apiData.choices &&
    apiData.choices[0] &&
    apiData.choices[0].message &&
    apiData.choices[0].message.content
      ? apiData.choices[0].message.content
      : "";

  let parsed;

  try {
    parsed = JSON.parse(cleanJsonText(content));
  } catch (error) {
    console.error("AI JSON PARSE ERROR:", content);
    return buildFallbackResult();
  }

  const avgSoldPrice = safeNumber(parsed.avgSoldPrice, 75);
  const psa9Value = safeNumber(parsed.psa9Value, Math.round(avgSoldPrice * 1.35));
  const psa10Value = safeNumber(parsed.psa10Value, Math.round(avgSoldPrice * 2.25));

  return {
    success: true,
    cardName: parsed.cardName || "Sports Trading Card",
    player: parsed.player || "Unknown",
    year: parsed.year || "Unknown",
    set: parsed.set || "Unknown",
    brand: parsed.brand || "Unknown",
    cardNumber: parsed.cardNumber || "Unknown",
    sport: parsed.sport || "Unknown",
    signal: parsed.signal || "SCAN READY",
    confidence: parsed.confidence || "Medium",
    avgSoldPrice,
    psa9Value,
    psa10Value,
    summary:
      parsed.summary ||
      "AI scan completed. Verify details with sold comps before buying, selling, or grading.",
    source: "openai_vision"
  };
}

/* ===============================
   SCAN CARD ENDPOINT
================================ */

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

      console.log("SCAN STARTED");
      console.log("Front:", front.originalname, front.mimetype, front.size);

      if (back) {
        console.log("Back:", back.originalname, back.mimetype, back.size);
      }

      const result = await scanWithOpenAI(front, back);

      return res.json({
        ...result,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error("SCAN SERVER ERROR:", error);

      return res.status(500).json({
        success: false,
        error: "Scanner failed on server",
        details: error.message
      });
    }
  }
);

/* ===============================
   MANUAL VALUE ENDPOINT
================================ */

app.post("/api/manual-card", (req, res) => {
  const name = req.body.cardName || "Manual Trading Card";
  const rawValue = safeNumber(req.body.rawValue, 75);

  res.json({
    success: true,
    cardName: name,
    signal: "MANUAL",
    avgSoldPrice: rawValue,
    psa9Value: Math.round(rawValue * 1.35),
    psa10Value: Math.round(rawValue * 2.25),
    source: "manual"
  });
});

/* ===============================
   404
================================ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

/* ===============================
   START SERVER
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Track The Market backend running on port ${PORT}`);
});
