/* =========================================
   TRACK THE MARKET
   PREMIUM SCANNER BACKEND
   UPDATED server.js
========================================= */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();

/* =========================================
   BASIC SETUP
========================================= */

app.use(cors());

app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true
}));

/* =========================================
   FILE UPLOAD
========================================= */

const upload = multer({

  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024
  }

});

/* =========================================
   ROOT
========================================= */

app.get("/", (req, res) => {

  res.json({
    success: true,
    app: "Track The Market Backend",
    status: "online"
  });

});

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/health", (req, res) => {

  res.json({
    success: true,
    status: "healthy",
    uptime: process.uptime()
  });

});

/* =========================================
   EBAY TOKEN
========================================= */

let ebayToken = null;

let tokenExpires = 0;

async function getEbayToken() {

  try {

    if (
      ebayToken &&
      Date.now() < tokenExpires
    ) {

      return ebayToken;

    }

    if (
      !process.env.EBAY_CLIENT_ID ||
      !process.env.EBAY_CLIENT_SECRET
    ) {

      console.log(
        "Missing eBay environment variables"
      );

      return null;
    }

    const auth = Buffer.from(
      process.env.EBAY_CLIENT_ID +
      ":" +
      process.env.EBAY_CLIENT_SECRET
    ).toString("base64");

    const response = await fetch(
      "https://api.ebay.com/identity/v1/oauth2/token",
      {
        method: "POST",

        headers: {
          Authorization:
            `Basic ${auth}`,

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
      }
    );

    const data = await response.json();

    if (!data.access_token) {

      console.log(
        "eBay token failed"
      );

      return null;
    }

    ebayToken =
      data.access_token;

    tokenExpires =
      Date.now() +
      ((data.expires_in || 7200) - 60) * 1000;

    return ebayToken;

  } catch (error) {

    console.log(
      "eBay token error:",
      error.message
    );

    return null;
  }

}

/* =========================================
   DEMO CARD DATABASE
========================================= */

const demoCards = [

  {
    keywords:
      ["ohtani", "shohei"],

    cardName:
      "Shohei Ohtani Rookie Card",

    signal:
      "GRADE",

    avgSoldPrice:
      180
  },

  {
    keywords:
      ["charizard"],

    cardName:
      "Charizard Base Set",

    signal:
      "HOT",

    avgSoldPrice:
      450
  },

  {
    keywords:
      ["judge", "aaron"],

    cardName:
      "Aaron Judge Rookie",

    signal:
      "WATCH",

    avgSoldPrice:
      120
  },

  {
    keywords:
      ["skenes"],

    cardName:
      "Paul Skenes Prospect",

    signal:
      "WATCH",

    avgSoldPrice:
      95
  }

];

/* =========================================
   SIMPLE CARD DETECTION
========================================= */

function detectDemoCard(filename = "") {

  const lower =
    filename.toLowerCase();

  for (const card of demoCards) {

    const matched =
      card.keywords.some(keyword =>
        lower.includes(keyword)
      );

    if (matched) {

      return card;
    }

  }

  return {
    cardName:
      "Sports Trading Card",

    signal:
      "SCAN READY",

    avgSoldPrice:
      75
  };

}

/* =========================================
   SCAN API
========================================= */

app.post(
  "/api/scan-card",

  upload.fields([
    {
      name: "front",
      maxCount: 1
    },

    {
      name: "back",
      maxCount: 1
    }
  ]),

  async (req, res) => {

    try {

      const front =
        req.files?.front?.[0];

      const back =
        req.files?.back?.[0];

      if (!front) {

        return res.status(400).json({

          success: false,

          error:
            "Front image required"

        });

      }

      console.log(
        "Front image:",
        front.originalname
      );

      if (back) {

        console.log(
          "Back image:",
          back.originalname
        );

      }

      /* =========================================
         MOCK DETECTION
      ========================================= */

      const detected =
        detectDemoCard(
          front.originalname
        );

      /* =========================================
         OPTIONAL EBAY TOKEN CHECK
      ========================================= */

      await getEbayToken();

      /* =========================================
         RESPONSE
      ========================================= */

      return res.json({

        success: true,

        cardName:
          detected.cardName,

        signal:
          detected.signal,

        avgSoldPrice:
          detected.avgSoldPrice,

        timestamp:
          Date.now()

      });

    } catch (error) {

      console.error(
        "SCAN ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Scanner failed"

      });

    }

  }
);

/* =========================================
   404
========================================= */

app.use((req, res) => {

  res.status(404).json({

    success: false,

    error:
      "Endpoint not found"

  });

});

/* =========================================
   SERVER START
========================================= */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

});
