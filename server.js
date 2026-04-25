import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import FormData from "form-data";

dotenv.config();

const app = express();
const upload = multer();

app.use(cors());

app.get("/", (req, res) => {
  res.send("Card Scanner Backend Running");
});

app.post("/scan-card", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No image uploaded" });
    }

    const formData = new FormData();
    formData.append("image", req.file.buffer, {
      filename: req.file.originalname || "card.jpg",
      contentType: req.file.mimetype || "image/jpeg"
    });

    const csRes = await fetch("https://api.cardsight.ai/v1/identify/card", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.CARDSIGHT_API_KEY
      },
      body: formData
    });

    const text = await csRes.text();

    let csData;
    try {
      csData = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        error: "CardSight returned non-JSON response",
        status: csRes.status,
        raw: text
      });
    }

    if (!csRes.ok) {
      return res.status(502).json({
        success: false,
        error: "CardSight API error",
        status: csRes.status,
        raw: csData
      });
    }

    const detection =
      csData?.data?.detections?.[0] ||
      csData?.detections?.[0] ||
      csData?.results?.[0] ||
      csData?.cards?.[0] ||
      null;

    if (!detection) {
      return res.json({
        success: false,
        message: "No card detected",
        raw: csData
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
      ebay:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(cardName) +
        "&LH_Sold=1&LH_Complete=1&_sop=13",
      raw: csData
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Scan failed",
      details: err.message
    });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
