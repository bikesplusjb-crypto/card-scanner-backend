const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.json({
    status: "Card Scanner Backend Running",
    routes: ["/health", "/scan"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend connected" });
});

app.post("/scan", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No image uploaded"
      });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
You are a sports card scanner.

Look at the image and identify the card.

Return ONLY valid JSON.
No markdown.
No explanation.

Use this exact format:

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

If you cannot identify something, use "Unknown".
Do not use null.
`
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64Image}`
            }
          ]
        }
      ]
    });

    let text = response.output_text || "";

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let data;

    try {
      data = JSON.parse(text);
    } catch (err) {
      data = {
        ok: true,
        cardName: "Unknown Card",
        player: "Unknown",
        sport: "Unknown",
        year: "Unknown",
        brand: "Unknown",
        set: "Unknown",
        team: "Unknown",
        cardNumber: "Unknown",
        confidence: "Low",
        notes: text || "Card could not be fully identified."
      };
    }

    res.json(data);
  } catch (error) {
    console.error("SCAN ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Scanner failed",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Card scanner backend running on port ${PORT}`);
});
