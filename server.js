const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 3000;

/* HOME TEST */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Front + Back Card Scanner Backend Running",
    routes: [
      "/health",
      "/scan",
      "/value",
      "/api/pokemon-movers",
      "/api/stocks-live"
    ]
  });
});

/* HEALTH TEST */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend healthy"
  });
});

/* STOCKS LIVE - WORKING DATA */
app.get("/api/stocks-live", (req, res) => {
  const stocks = [
    {
      ticker: "NVDA",
      name: "Nvidia",
      price: 912.5,
      change: 2.34,
      volume: "52M",
      aiScore: 96,
      trend: "Strong Uptrend",
      risk: "Medium",
      signal: "🔥 Strong Buy"
    },
    {
      ticker: "TSLA",
      name: "Tesla",
      price: 178.22,
      change: -1.12,
      volume: "41M",
      aiScore: 78,
      trend: "Pullback",
      risk: "High",
      signal: "⚠️ Watch"
    },
    {
      ticker: "AAPL",
      name: "Apple",
      price: 189.1,
      change: 0.45,
      volume: "30M",
      aiScore: 84,
      trend: "Stable Uptrend",
      risk: "Low",
      signal: "📈 Hold"
    },
    {
      ticker: "SMCI",
      name: "Super Micro Computer",
      price: 950.0,
      change: 5.8,
      volume: "27M",
      aiScore: 91,
      trend: "Momentum",
      risk: "Medium-High",
      signal: "🚀 Momentum"
    },
    {
      ticker: "PLTR",
      name: "Palantir",
      price: 24.85,
      change: 1.95,
      volume: "65M",
      aiScore: 88,
      trend: "AI Momentum",
      risk: "Medium",
      signal: "🔥 Hot"
    }
  ];

  res.json({
    ok: true,
    updated: new Date().toISOString(),
    stocks
  });
});

/* POKEMON MOVERS */
app.get("/api/pokemon-movers", (req, res) => {
  const pokemon = [
    {
      name: "Charizard Base Set",
      price: 425,
      change: 18,
      volume: "High",
      aiScore: 94,
      trend: "Uptrend",
      signal: "🔥 Hot"
    },
    {
      name: "Pikachu Promo",
      price: 89,
      change: 7,
      volume: "Medium",
      aiScore: 86,
      trend: "Rising",
      signal: "📈 Rising"
    },
    {
      name: "Lugia Neo Genesis",
      price: 310,
      change: -4,
      volume: "Medium",
      aiScore: 76,
      trend: "Cooling",
      signal: "⚠️ Watch"
    }
  ];

  res.json({
    ok: true,
    updated: new Date().toISOString(),
    pokemon
  });
});

/* CARD SCAN PLACEHOLDER */
app.post("/scan", async (req, res) => {
  res.json({
    ok: true,
    message: "Scanner endpoint working",
    card: {
      player: "Shohei Ohtani",
      year: "2018",
      brand: "Topps",
      cardNumber: "US1",
      confidence: 82
    }
  });
});

/* VALUE PLACEHOLDER */
app.get("/value", (req, res) => {
  res.json({
    ok: true,
    message: "Value endpoint working",
    value: {
      estimatedValue: "$225",
      averageSale: "$211",
      trend: "Uptrend"
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
