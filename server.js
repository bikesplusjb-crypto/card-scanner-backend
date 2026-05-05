const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "AI Card Scanner Backend Running",
    endpoints: ["/api/health", "/api/scan-card"]
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "Backend connected",
    time: new Date().toISOString()
  });
});

function cleanCardName(text = "") {
  return text
    .replace(/pokemon/gi, "Pokémon")
    .replace(/\s+/g, " ")
    .trim();
}

function guessCardFromFilename(file) {
  const name = file?.originalname || "";

  const lower = name.toLowerCase();

  if (lower.includes("charizard")) return "Charizard Pokémon Card";
  if (lower.includes("pikachu")) return "Pikachu Pokémon Card";
  if (lower.includes("ohtani")) return "Shohei Ohtani Rookie Card";
  if (lower.includes("wembanyama") || lower.includes("wemby")) return "Victor Wembanyama Rookie Card";
  if (lower.includes("mahomes")) return "Patrick Mahomes Rookie Card";

  return "Unknown Sports / Pokémon Card";
}

function marketScore(cardName) {
  const n = cardName.toLowerCase();

  if (
    n.includes("charizard") ||
    n.includes("pikachu") ||
    n.includes("ohtani") ||
    n.includes("wembanyama") ||
    n.includes("mahomes")
  ) {
    return 91;
  }

  if (
    n.includes("rookie") ||
    n.includes("psa") ||
    n.includes("pokemon") ||
    n.includes("pokémon")
  ) {
    return 84;
  }

  return 76;
}

function marketSignal(score) {
  if (score >= 90) return "🔥 HOT";
  if (score >= 80) return "📈 RISING";
  if (score >= 70) return "👀 WATCH";
  return "⚠️ LOW SIGNAL";
}

function estimateValue(cardName, score) {
  const n = cardName.toLowerCase();

  if (n.includes("charizard")) return "125.00";
  if (n.includes("pikachu")) return "55.00";
  if (n.includes("wembanyama")) return "85.00";
  if (n.includes("ohtani")) return "95.00";
  if (n.includes("mahomes")) return "110.00";

  if (score >= 90) return "75.00";
  if (score >= 80) return "38.00";
  return "18.00";
}

async function askOpenAIForCard(frontFile, backFile) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const frontBase64 = frontFile.buffer.toString("base64");

  const images = [
    {
      type: "input_image",
      image_url: `data:${frontFile.mimetype};base64,${frontBase64}`
    }
  ];

  if (backFile) {
    const backBase64 = backFile.buffer.toString("base64");
    images.push({
      type: "input_image",
      image_url: `data:${backFile.mimetype};base64,${backBase64}`
    });
  }

  const prompt = `
Identify this trading card as accurately as possible.

Return ONLY valid JSON:
{
  "name": "card/player/pokemon name",
  "brand": "brand if visible",
  "year": "year if visible",
  "set": "set if visible",
  "cardNumber": "card number if visible",
  "confidence": 0-100,
  "gradeHint": "Raw / PSA candidate / unclear",
  "reason": "short reason"
}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error("OpenAI scan failed: " + errText);
  }

  const data = await response.json();
  const text =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    "";

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("OpenAI did not return JSON");
  }

  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

app.post(
  "/api/scan-card",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const front = req.files?.front?.[0];
      const back = req.files?.back?.[0];

      if (!front) {
        return res.status(400).json({
          error: "Front image is required"
        });
      }

      let detected = null;

      try {
        detected = await askOpenAIForCard(front, back);
      } catch (err) {
        console.log("AI scan fallback:", err.message);
      }

      const fallbackName = guessCardFromFilename(front);

      const rawName =
        detected?.name && detected.name !== "unknown"
          ? detected.name
          : fallbackName;

      const name = cleanCardName(rawName);

      const score = marketScore(name);
      const value = estimateValue(name, score);
      const signal = marketSignal(score);

      res.json({
        success: true,
        name,
        cardName: name,
        title: name,
        brand: detected?.brand || "",
        year: detected?.year || "",
        set: detected?.set || "",
        cardNumber: detected?.cardNumber || "",
        value,
        estimatedValue: value,
        averagePrice: value,
        confidence: detected?.confidence || 78,
        score,
        marketScore: score,
        gradeHint: detected?.gradeHint || "Raw / Estimate",
        signal,
        reason:
          detected?.reason ||
          "Card estimated from uploaded image. Use eBay comps before buying or selling.",
        source: detected ? "AI scan" : "Fallback scan"
      });

    } catch (err) {
      console.error("Scan error:", err);

      res.status(500).json({
        error: "Scan failed",
        message: err.message
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`AI Card Scanner backend running on port ${PORT}`);
});
