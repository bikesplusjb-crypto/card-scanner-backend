const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

/* ROOT TEST */
app.get("/", (req, res) => {
  res.send("AI Scanner Live ✅");
});

/* IMAGE SCAN ROUTE */
app.post("/scan-card", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({
        success: false,
        error: "No image uploaded"
      });
    }

    const formData = new FormData();
    formData.append("image", req.file.buffer, {
      filename: req.file.originalname || "card.jpg",
      contentType: req.file.mimetype || "image/jpeg"
    });

    // ⚠️ Replace with YOUR actual Card API if needed
    const apiRes = await fetch("https://api.cardsight.ai/v1/identify/card", {
      method: "POST",
      body: formData
    });

    const text = await apiRes.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.json({
        success: false,
        error: "API did not return JSON",
        raw: text
      });
    }

    const detection =
      data?.data?.detections?.[0] ||
      data?.detections?.[0] ||
      data?.results?.[0] ||
      data?.cards?.[0] ||
      null;

    if (!detection) {
      return res.json({
        success: false,
        error: "No card detected",
        raw: data
      });
    }

    const card = detection.card || detection;

    const cardName =
      card.name ||
      card.title ||
      card.player ||
      "Card identified";

    res.json({
      success: true,
      name: cardName,
      year: card.year || "",
      brand: card.manufacturer || card.brand || "",
      set: card.releaseName || card.set || card.setName || "",
      confidence: detection.confidence || detection.score || 0,

      ebayUrl:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(cardName) +
        "&LH_Sold=1&LH_Complete=1",

      raw: data
    });

  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      error: "Scan failed",
      details: err.message
    });
  }
});

/* PORT FIX (IMPORTANT) */
const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log("Server running on port " + port);
});
