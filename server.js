const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || "5339149252";

let ebayToken = null;
let ebayTokenExpires = 0;

const underFiveStocks = [
  "FUBO", "SOFI", "LCID", "SIRI", "OPEN", "PLUG", "RIVN", "DNA", "BBAI", "SOUN"
];

const cardIdeas = [
  "Victor Wembanyama base card",
  "Shohei Ohtani rookie card",
  "Patrick Mahomes rookie card",
  "Charizard Pokemon card",
  "Pikachu promo card",
  "LeBron James card",
  "Aaron Judge rookie card",
  "CJ Stroud rookie card",
  "Jackson Holliday rookie card",
  "Pokemon Charmander card"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await res.json();

  if (!data.access_token) {
    console.log("eBay token error:", data);
    throw new Error("Could not get eBay token");
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 120) * 1000;
  return ebayToken;
}

async function getStockData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const data = await res.json();
  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(`No stock data for ${symbol}`);
  }

  const meta = result.meta;
  const price = meta.regularMarketPrice || meta.previousClose || 0;
  const previousClose = meta.previousClose || price;

  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    stockUrl: `https://finance.yahoo.com/quote/${symbol}`
  };
}

async function getCardData(query) {
  const token = await getEbayToken();

  const searchUrl =
    "https://api.ebay.com/buy/browse/v1/item_summary/search?" +
    new URLSearchParams({
      q: query,
      limit: "10",
      filter: "buyingOptions:{FIXED_PRICE}"
    });

  const res = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
    }
  });

  const data = await res.json();

  const items = data.itemSummaries || [];

  const prices = items
    .map(item => Number(item?.price?.value))
    .filter(price => !isNaN(price) && price > 0);

  const avgPrice =
    prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 0;

  const bestItem = items[0];

  return {
    query,
    averagePrice: Number(avgPrice.toFixed(2)),
    listingsFound: items.length,
    ebayUrl:
      `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&campid=${EBAY_CAMPAIGN_ID}`,
    image: bestItem?.image?.imageUrl || null,
    title: bestItem?.title || query
  };
}

function scoreMatchup(stock, card) {
  let stockScore = 50;
  let cardScore = 50;

  if (stock.changePercent > 5) stockScore += 25;
  else if (stock.changePercent > 2) stockScore += 15;
  else if (stock.changePercent > 0) stockScore += 8;
  else if (stock.changePercent < -5) stockScore -= 20;
  else if (stock.changePercent < 0) stockScore -= 8;

  if (stock.price < 5) stockScore += 8;

  if (card.listingsFound >= 8) cardScore += 18;
  else if (card.listingsFound >= 4) cardScore += 10;

  if (card.averagePrice > 0 && card.averagePrice <= 10) cardScore += 10;
  if (card.averagePrice > 50) cardScore -= 6;

  const winner = stockScore >= cardScore ? stock.symbol : card.query;

  let decision = "WAIT";
  let confidence = Math.min(95, Math.abs(stockScore - cardScore) + 60);

  if (stockScore - cardScore >= 15) decision = `BUY ${stock.symbol}`;
  else if (cardScore - stockScore >= 15) decision = `BUY CARD`;
  else if (stock.changePercent < -7) decision = `AVOID ${stock.symbol}`;

  const reason =
    stockScore > cardScore
      ? `${stock.symbol} has stronger short-term momentum and higher liquidity.`
      : `${card.query} has better collectible demand based on current eBay listings.`;

  return {
    stockScore,
    cardScore,
    winner,
    decision,
    confidence,
    reason
  };
}

function buildTikTokScript(matchup) {
  return {
    hook: `Would you rather buy ${matchup.stock.symbol} stock or a ${matchup.card.query} under $5?`,
    script:
`Here is today's AI Market Matchup.

On one side: ${matchup.stock.symbol}, trading around $${matchup.stock.price}, with a ${matchup.stock.changePercent}% move.

On the other side: ${matchup.card.query}, with an average eBay listing price around $${matchup.card.averagePrice}.

The AI pick today is: ${matchup.analysis.decision}.

Reason: ${matchup.analysis.reason}

Would you take the stock or the card?`,
    caption: `${matchup.stock.symbol} vs ${matchup.card.query} 👀 AI pick: ${matchup.analysis.decision}. Stock or card?`,
    hashtags: [
      "#sportscards",
      "#pokemoncards",
      "#pennystocks",
      "#stocks",
      "#collectibles",
      "#investing",
      "#cardcollector",
      "#aitools"
    ]
  };
}

async function buildMatchup(stockSymbol, cardQuery) {
  const stock = await getStockData(stockSymbol);
  const card = await getCardData(cardQuery);
  const analysis = scoreMatchup(stock, card);

  const matchup = {
    title: `${stock.symbol} vs ${card.query}`,
    stock,
    card,
    analysis,
    updatedAt: new Date().toISOString()
  };

  matchup.tiktok = buildTikTokScript(matchup);

  return matchup;
}

app.get("/", (req, res) => {
  res.json({
    status: "AI Market Matchup Backend Running",
    endpoints: [
      "/api/health",
      "/api/auto-matchups",
      "/api/under-five",
      "/api/matchup?stock=SOFI&card=Victor%20Wembanyama%20base%20card",
      "/api/tiktok-idea"
    ]
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend connected",
    updatedAt: new Date().toISOString()
  });
});

app.get("/api/matchup", async (req, res) => {
  try {
    const stock = req.query.stock || "SOFI";
    const card = req.query.card || "Victor Wembanyama base card";

    const matchup = await buildMatchup(stock, card);
    res.json(matchup);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Could not build matchup",
      details: err.message
    });
  }
});

app.get("/api/auto-matchups", async (req, res) => {
  try {
    const count = Math.min(Number(req.query.count || 6), 10);
    const matchups = [];

    for (let i = 0; i < count; i++) {
      const stock = pickRandom(underFiveStocks);
      const card = pickRandom(cardIdeas);

      try {
        const matchup = await buildMatchup(stock, card);
        matchups.push(matchup);
      } catch (innerErr) {
        console.log("Skipped matchup:", innerErr.message);
      }
    }

    res.json({
      updatedAt: new Date().toISOString(),
      count: matchups.length,
      matchups
    });
  } catch (err) {
    res.status(500).json({
      error: "Could not generate auto matchups",
      details: err.message
    });
  }
});

app.get("/api/under-five", async (req, res) => {
  try {
    const matchups = [];

    for (let i = 0; i < 5; i++) {
      const stock = pickRandom(underFiveStocks);
      const card = pickRandom(cardIdeas);

      try {
        const matchup = await buildMatchup(stock, card);
        if (matchup.stock.price <= 5 || matchup.card.averagePrice <= 10) {
          matchups.push(matchup);
        }
      } catch (innerErr) {
        console.log("Skipped under-five matchup:", innerErr.message);
      }
    }

    res.json({
      updatedAt: new Date().toISOString(),
      matchups
    });
  } catch (err) {
    res.status(500).json({
      error: "Could not generate under-five ideas",
      details: err.message
    });
  }
});

app.get("/api/tiktok-idea", async (req, res) => {
  try {
    const stock = req.query.stock || pickRandom(underFiveStocks);
    const card = req.query.card || pickRandom(cardIdeas);

    const matchup = await buildMatchup(stock, card);

    res.json({
      title: `Viral TikTok Idea: ${matchup.title}`,
      matchup,
      tiktok: matchup.tiktok
    });
  } catch (err) {
    res.status(500).json({
      error: "Could not generate TikTok idea",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Market Matchup backend running on port ${PORT}`);
});
