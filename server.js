const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("AI Scanner Live ✅");
});

// TEST OPENAI ROUTE
app.get("/test-openai", async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.3",
        input: "Say hello"
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// SCAN ROUTE
app.post("/scan-card", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, error: "No image uploaded" });
    }

    // SEND IMAGE TO OPENAI
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.3",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Identify this sports or Pokémon card. Return name only."
              },
              {
                type: "input_image",
                image_base64: req.file.buffer.toString("base64")
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      "Unknown card";

    res.json({
      success: true,
      name: text,
      ebay:
        "https://www.ebay.com/sch/i.html?_nkw=" +
        encodeURIComponent(text)
    });

  } catch (err) {
    res.json({
      success: false,
      error: "Scan failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
