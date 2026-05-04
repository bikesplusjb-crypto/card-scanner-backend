const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 3000;

let ebayToken = null;
let ebayTokenExpires = 0;

/* ---------------- EBAY TOKEN ---------------- */

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return null;
  }

  const auth = Buffer.from(
    process.env.EBAY_CLIENT_ID + ":" + process.env.EBAY_CLIENT_SECRET
  ).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await res.json();
  if (!data.access_token) return null;

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return ebayToken;
}

/* ---------------- HELPERS ---------------- */

function isStock(query) {
  return /^[A-Z]{1,5}$/.test(String(query).trim().toUpperCase());
}

function isPokemon(query) {
  return /pokemon|charizard|pikachu|lugia|mewtwo|mew|blastoise|venusaur|eevee|snorlax|psa|base set|promo|neo genesis/i.test(query);
}

function ebaySearchUrl(query) {
  return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query);
}

function ebaySoldUrl(query) {
  return ebaySearchUrl(query) + "&LH_Sold=1&LH_Complete=1";
}

function yahooUrl(ticker) {
  return "https://finance.yahoo.com/quote/" + encodeURIComponent(ticker);
}

function riskNumber(risk) {
  const r = String(risk || "").toLowerCase();
  if (r.includes("high")) return 68;
  if (r.includes("medium-high")) return 60;
  if (r.includes("medium")) return 50;
  if (r.includes("low")) return 34;
  return 50;
}

function scoreAsset(asset) {
  return Math.round(
    asset.aiScore * 0.35 +
    asset.momentum * 0.25 +
    asset.demand * 0.25 -
    asset.risk * 0.15
  );
}

/* ---------------- BUY / WAIT / AVOID LOGIC ---------------- */

function getActionSignal(asset) {
  const score = Number(asset.matchupScore || 0);
  const momentum = Number(asset.momentum || 0);
  const risk = Number(asset.risk || 50);
  const demand = Number(asset.demand || 0);

  if (score >= 75 && momentum >= 80 && demand >= 80 && risk <= 55) {
    return {
      action: "BUY",
      color: "green",
      reason: "Strong momentum, high demand, and acceptable risk."
    };
  }

  if (score >= 64 && momentum >= 70 && risk <= 65) {
    return {
      action: "WAIT",
      color: "yellow",
      reason: "Good setup, but risk or momentum needs confirmation."
    };
  }

  return {
    action: "AVOID",
    color: "red",
    reason: "Risk is too high or momentum is not strong enough."
  };
}

/* ---------------- LIVE YAHOO STOCK DATA ---------------- */

async function getYahooStockData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const data = await res.json();

    if (
      !data ||
      !data.chart ||
      !data.chart.result ||
      !data.chart.result[0] ||
      !data.chart.result[0].meta
    ) {
      return null;
    }

    const meta = data.chart.result[0].meta;
    const price = Number(meta.regularMarketPrice);
    const previous = Number(meta.chartPreviousClose || meta.previousClose);

    if (!price || isNaN(price)) return null;

    const change = previous
      ? Number((((price - previous) / previous) * 100).toFixed(2))
      : 0;

    return {
      ticker: ticker.toUpperCase(),
      name: meta.longName || meta.shortName || meta.symbol || ticker.toUpperCase(),
      price,
      change,
      volume: "Live",
      aiScore: change >= 3 ? 90 : change >= 1 ? 86 : change >= 0 ? 82 : 74,
      trend:
        change >= 3
          ? "Strong Uptrend"
          : change >= 1
          ? "Positive Momentum"
          : change >= 0
          ? "Market Watch"
          : "Pullback",
      risk: Math.abs(change) >= 5 ? "High" : Math.abs(change) >= 2 ? "Medium" : "Low",
      signal:
        change >= 3
          ? "🔥 Momentum"
          : change >= 1
          ? "📈 Watch"
          : change >= 0
          ? "Hold"
          : "⚠️ Pullback"
    };
  } catch (err) {
    console.log("Yahoo stock fetch failed:", ticker, err.message);
    return null;
  }
}

/* ---------------- FALLBACK STOCK DATA ---------------- */

function stockData() {
  return [
    { ticker: "NVDA", name: "Nvidia", price: 912.5, change: 2.34, volume: "52M", aiScore: 96, trend: "Strong Uptrend", risk: "Medium", signal: "🔥 Strong Buy" },
    { ticker: "TSLA", name: "Tesla", price: 178.22, change: -1.12, volume: "41M", aiScore: 78, trend: "Pullback", risk: "High", signal: "⚠️ Watch" },
    { ticker: "AAPL", name: "Apple", price: 189.1, change: 0.45, volume: "30M", aiScore: 84, trend: "Stable Uptrend", risk: "Low", signal: "📈 Hold" },
    { ticker: "SMCI", name: "Super Micro Computer", price: 950, change: 5.8, volume: "27M", aiScore: 91, trend: "Momentum", risk: "Medium-High", signal: "🚀 Momentum" },
    { ticker: "PLTR", name: "Palantir", price: 24.85, change: 1.95, volume: "65M", aiScore: 88, trend: "AI Momentum", risk: "Medium", signal: "🔥 Hot" },
    { ticker: "AMD", name: "AMD", price: 158.4, change: 1.35, volume: "48M", aiScore: 86, trend: "AI chip momentum", risk: "Medium", signal: "📈 Watch" }
  ];
}

/* ---------------- POKEMON DATA ---------------- */

function pokemonData() {
  return [
    { name: "Charizard Base Set", price: 425, change: 18, volume: "High", aiScore: 94, score: 94, trend: "Icon collectible demand", risk: "Medium", signal: "🔥 Hot", demand: "Very Strong" },
    { name: "Pikachu Promo", price: 89, change: 7, volume: "Medium", aiScore: 86, score: 86, trend: "Mainstream collector appeal", risk: "Medium", signal: "📈 Rising", demand: "Strong" },
    { name: "Lugia Neo Genesis", price: 310, change: -4, volume: "Medium", aiScore: 76, score: 76, trend: "Cooling after recent demand", risk: "Medium", signal: "⚠️ Watch", demand: "Moderate" }
  ];
}

/* ---------------- EBAY MARKET DATA ---------------- */

async function getEbayMarketData(query) {
  try {
    const token = await getEbayToken();

    if (!token) {
      return {
        source: "eBay search estimate",
        price: "Search Market",
        activeListings: "Search available",
        url: ebaySearchUrl(query),
        soldUrl: ebaySoldUrl(query)
      };
    }

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
      encodeURIComponent(query) +
      "&filter=buyingOptions:{FIXED_PRICE|AUCTION},priceCurrency:USD&limit=20";

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const data = await res.json();
    const items = data.itemSummaries || [];

    let prices = items
      .map(item => Number(item.price && item.price.value))
      .filter(n => !isNaN(n) && n > 20);

    prices = prices.sort((a, b) => a - b);

    let cleaned = prices;
    if (prices.length >= 6) cleaned = prices.slice(1, -1);

    const avg =
      cleaned.length > 0
        ? Math.round(cleaned.reduce((a, b) => a + b, 0) / cleaned.length)
        : null;

    return {
      source: "eBay active listing estimate",
      price: avg ? `$${avg.toLocaleString()} Est.` : "Search Market",
      activeListings: items.length,
      url: ebaySearchUrl(query),
      soldUrl: ebaySoldUrl(query)
    };
  } catch (err) {
    return {
      source: "eBay fallback",
      price: "Search Market",
      activeListings: "Search available",
      url: ebaySearchUrl(query),
      soldUrl: ebaySoldUrl(query)
    };
  }
}

/* ---------------- BUILD ASSET ---------------- */

async function buildAsset(query) {
  const q = String(query || "").trim();
  const upper = q.toUpperCase();

  if (isStock(q)) {
    const found = stockData().find(s => s.ticker === upper);
    const live = await getYahooStockData(upper);

    const stock =
      live ||
      found || {
        ticker: upper,
        name: upper,
        price: null,
        change: 0,
        volume: "N/A",
        aiScore: 82,
        trend: "Stock market watch",
        risk: "Medium",
        signal: "Watch"
      };

    const asset = {
      type: "stock",
      tag: "📊 STOCK",
      name: stock.ticker,
      label: stock.name,
      price: stock.price ? `$${Number(stock.price).toLocaleString()}` : "Fetching...",
      move: `${stock.change >= 0 ? "+" : ""}${stock.change}% • ${stock.trend}`,
      aiScore: stock.aiScore,
      momentum: Math.min(99, Math.max(50, Math.round(stock.aiScore + Number(stock.change || 0)))),
      demand: Math.min(99, Math.max(55, Math.round(stock.aiScore - 2))),
      risk: riskNumber(stock.risk),
      reason: stock.trend,
      source: live ? "Live Yahoo market data" : found ? "Stock backend" : "Ticker estimate",
      url: yahooUrl(stock.ticker)
    };

    asset.matchupScore = scoreAsset(asset);
    asset.actionSignal = getActionSignal(asset);

    return asset;
  }

  if (isPokemon(q)) {
    const found = pokemonData().find(
      p =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        q.toLowerCase().includes(p.name.toLowerCase().split(" ")[0])
    );

    const market = await getEbayMarketData(q);

    const score = found ? found.aiScore : 84;
    const change = found ? found.change : 7;

    const asset = {
      type: "pokemon",
      tag: "💎 POKÉMON",
      name: found ? found.name : q,
      label: "Pokémon Card",
      price: market.price || "Search Market",
      move: `Trend Score: +${change}%`,
      aiScore: score,
      momentum: Math.min(99, Math.max(50, Math.round(score + change))),
      demand:
        found && found.demand === "Very Strong"
          ? 96
          : found && found.demand === "Strong"
          ? 90
          : 82,
      risk: riskNumber(found ? found.risk : "Medium"),
      reason: found
        ? found.trend
        : "Pokémon collectible demand, marketplace searches, and pricing interest are being analyzed.",
      source: market.source,
      url: market.url,
      soldUrl: market.soldUrl,
      activeListings: market.activeListings
    };

    asset.matchupScore = scoreAsset(asset);
    asset.actionSignal = getActionSignal(asset);

    return asset;
  }

  const market = await getEbayMarketData(q);

  const asset = {
    type: "card",
    tag: "🃏 CARD",
    name: q,
    label: "Sports Card / Collectible",
    price: market.price,
    move: "Collector market watch",
    aiScore: 82,
    momentum: 78,
    demand: 80,
    risk: 52,
    reason: "This card is evaluated by collector demand, market search strength, liquidity, and resale interest.",
    source: market.source,
    url: market.url,
    soldUrl: market.soldUrl,
    activeListings: market.activeListings
  };

  asset.matchupScore = scoreAsset(asset);
  asset.actionSignal = getActionSignal(asset);

  return asset;
}

/* ---------------- ROUTES ---------------- */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Card Scanner Backend Running",
    routes: ["/health", "/api/stocks-live", "/api/pokemon-movers", "/api/matchup"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend healthy" });
});

app.get("/api/stocks-live", async (req, res) => {
  const tickers = ["NVDA", "TSLA", "AAPL", "SMCI", "PLTR", "AMD", "MU"];

  const liveResults = await Promise.all(
    tickers.map(async ticker => {
      const live = await getYahooStockData(ticker);
      const fallback = stockData().find(s => s.ticker === ticker);
      return live || fallback;
    })
  );

  res.json({
    ok: true,
    updated: new Date().toISOString(),
    stocks: liveResults.filter(Boolean)
  });
});

app.get("/api/pokemon-movers", (req, res) => {
  res.json({
    ok: true,
    updated: new Date().toISOString(),
    pokemon: pokemonData(),
    movers: pokemonData(),
    pricingType: "Pokémon backend + eBay estimate"
  });
});

app.get("/api/matchup", async (req, res) => {
  try {
    const assetAQuery = req.query.assetA || "NVDA";
    const assetBQuery = req.query.assetB || "Charizard PSA 10";

    const assetA = await buildAsset(assetAQuery);
    const assetB = await buildAsset(assetBQuery);

    const winner = assetA.matchupScore >= assetB.matchupScore ? assetA : assetB;
    const loser = assetA.matchupScore >= assetB.matchupScore ? assetB : assetA;

    const confidence = Math.min(
      95,
      Math.max(52, 50 + Math.abs(assetA.matchupScore - assetB.matchupScore) * 2)
    );

    res.json({
      ok: true,
      updated: new Date().toISOString(),
      assetA,
      assetB,
      winner,
      loser,
      confidence,
      decision: winner.actionSignal,
      disclaimer: "Educational research only. Not financial advice."
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Matchup failed",
      message: err.message
    });
  }
});

app.post("/scan", (req, res) => {
  res.json({
    ok: true,
    message: "Scanner endpoint working",
    card: {
      player: "Shohei Ohtani",
      year: "2018",
      brand: "Topps",
      confidence: 82
    }
  });
});

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
