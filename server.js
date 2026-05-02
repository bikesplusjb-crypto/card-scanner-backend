const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("AI Scanner Live ✅");
});

app.get("/test-openai", async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: "Say scanner ready"
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/scan-card", upload.single("image"), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.json({
        success: false,
        error: "Missing OPENAI_API_KEY in Render"
      });
    }

    if (!req.file) {
      return res.json({
        success: false,
        error: "No image uploaded"
      });
    }

    const mimeType = req.file.mimetype || "image/jpeg";
    const base64Image = req.file.buffer.toString("base64");
    const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Identify this trading card. It may be a sports card, baseball card, basketball card, football card, Pokemon card, or collectible card. Return ONLY valid JSON with these fields: cardName, player, year, brand, set, cardNumber, confidence, searchQuery. If unsure, make the best eBay search query."
              },
              {
                type: "input_image",
                image_url: imageDataUrl
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.json({
        success: false,
        error: "OpenAI scan failed",
        details: data
      });
    }

    let text =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "";

    let parsed = {};

    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = {
        cardName: text || "Unknown Card",
        searchQuery: text || "Unknown trading card",
        confidence: "low"
      };
    }

    const name =
      parsed.searchQuery ||
      parsed.cardName ||
      [parsed.year, parsed.brand, parsed.player, parsed.set, parsed.cardNumber]
        .filter(Boolean)
        .join(" ") ||
      "Unknown trading card";

    const ebayUrl =
      "https://www.ebay.com/sch/i.html?_nkw=" +
      encodeURIComponent(name) +
      "&LH_Sold=1&LH_Complete=1";

    res.json({
      success: true,
      name,
      cardName: parsed.cardName || name,
      player: parsed.player || "",
      year: parsed.year || "",
      brand: parsed.brand || "",
      set: parsed.set || "",
      cardNumber: parsed.cardNumber || "",
      confidence: parsed.confidence || "medium",
      ebayUrl,
      raw: parsed
    });
  } catch (err) {
    res.json({
      success: false,
      error: "Scan failed",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
