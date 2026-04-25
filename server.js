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
      return res.status(400).json({ error: "No image uploaded" });
    }

    const formData = new FormData();
    formData.append("image", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const csRes = await fetch("https://api.cardsight.ai/v1/identify/card", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.CARDSIGHT_API_KEY
      },
      body: formData
    });

    if (!csRes.ok) {
      const text = await csRes.text();
      return res.status(502).json({
        error: "CardSight error",
        details: text
      });
    }

    const csData = await csRes.json();
    const detection = csData?.data?.detections?.[0];

    if (!detection) {
      return res.json({
        success: false,
        message: "No card detected"
      });
    }

    const card = detection.card || {};

    res.json({
      success: true,
      name: card.name || "Unknown card",
      year: card.year || "",
      set: card.releaseName || "",
      brand: card.manufacturer || "",
      confidence: detection.confidence || 0,
      ebay:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(card.name || "baseball card") +
        "&LH_Sold=1&LH_Complete=1"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Scan failed" });
  }
});

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
