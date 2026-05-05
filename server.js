process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT ERROR:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED PROMISE:", err);
});

const express = require("express");
const cors = require("cors");

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

const knownPokemon = [
  "charizard", "pikachu", "charmander", "squirtle", "bulbasaur",
  "mewtwo", "mew", "eevee", "snorlax", "gengar", "lugia",
  "rayquaza", "umbreon", "dragonite", "blastoise", "venusaur"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function cleanPokemonName(input = "") {
  const cleaned = input
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/pokemon/g, "")
    .replace(/card/g, "")
    .replace(/psa\s*\d+/g, "")
    .replace(/graded/g, "")
    .replace(/rookie/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();

  const found = knownPokemon.find(p => cleaned.includes(p));
  return found || cleaned.split(" ")[0] || "";
}

function isPokemonCard(query = "") {
  const lower = query.toLowerCase();
  return lower.includes("pokemon") || knownPokemon.some(p => lower.includes(p));
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    throw new Error("Missing eBay credentials");
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
  const cleanSymbol = String(symbol || "SOFI").toUpperCase().trim();

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=5d&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const data = await res.json();
  const result = data?.chart?.result?.[0];

  if (!result) throw new Error(`No stock data for ${cleanSymbol}`);

  const meta = result.meta;
  const price = meta.regularMarketPrice || meta.previousClose || 0;
  const previousClose = meta.previousClose || price;

  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol: cleanSymbol,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    stockUrl: `https://finance.yahoo.com/quote/${cleanSymbol}`
  };
}

async function getPokemonData(cardQuery) {
  const name = cleanPokemonName(cardQuery);

  if (!name) {
    return {
      isPokemon: false,
      pokemonName: null,
      pokemonImage: null,
      pokemonTypes: [],
      pokemonError: "No Pokémon detected"
    };
  }

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name)}`);

    if (!res.ok) throw new Error("Pokémon not found");

    const data = await res.json();

    return {
      isPokemon: true,
      pokemonName: data.name,
      pokemonImage:
        data?.sprites?.other?.["official-artwork"]?.front_default ||
        data?.sprites?.front_default ||
        null,
      pokemonTypes: data.types?.map(t => t.type.name) || [],
      pokemonError: null
    };
  } catch (err) {
    return {
      isPokemon: isPokemonCard(cardQuery),
      pokemonName: name,
      pokemonImage: null,
      pokemonTypes: [],
      pokemonError: err.message
    };
  }
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
  const pokemon = await getPokemonData(query);

  return {
    query,
    averagePrice: Number(avgPrice.toFixed(2)),
    listingsFound: items.length,
    ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&campid=${EBAY_CAMPAIGN_ID}`,
    image: bestItem?.image?.imageUrl || pokemon.pokemonImage || null,
    title: bestItem?.title || query,
    pokemon
  };
}

function getPsaTrend(card) {
  let trend = "Flat";
  let note = "Not enough PSA-specific data yet.";

  const q = String(card.query || "").toLowerCase();

  if (q.includes("charizard") || q.includes("pikachu") || q.includes("wembanyama")) {
    trend = "Strong";
    note = "High collector demand keyword detected.";
  } else if (card.listingsFound >= 8) {
    trend = "Active";
    note = "High number of active eBay listings detected.";
  }

  return { trend, note };
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

  if (card.pokemon?.isPokemon) cardScore += 5;

  const winner = stockScore >= cardScore ? stock.symbol : card.query;

  let decision = "WAIT";
  const confidence = Math.min(95, Math.abs(stockScore - cardScore) + 60);

  if (stockScore - cardScore >= 15) decision = `BUY ${stock.symbol}`;
  else if (cardScore - stockScore >= 15) decision = "BUY CARD";
  else if (stock.changePercent < -7) decision = `AVOID ${stock.symbol}`;

  const reason =
    stockScore > cardScore
      ? `${stock.symbol} has stronger short-term momentum and higher liquidity.`
      : `${card.query} has stronger collectible demand based on current eBay listing signals.`;

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
    hook: `Would you rather buy ${matchup.stock.symbol} stock or ${matchup.card.query}?`,
    script:
`Today's AI Market Matchup:

${matchup.stock.symbol} is trading around $${matchup.stock.price}, moving ${matchup.stock.changePercent}% today.

The card side is ${matchup.card.query}, with an eBay average listing around $${matchup.card.averagePrice}.

AI Pick: ${matchup.analysis.decision}
Confidence: ${matchup.analysis.confidence}%

Reason: ${matchup.analysis.reason}

Would you take the stock or the card?`,
    caption: `${matchup.stock.symbol} vs ${matchup.card.query} 👀 AI Pick: ${matchup.analysis.decision}`,
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
  let stock;
  let card;

  try {
    stock = await getStockData(stockSymbol);
  } catch (e) {
    console.log("Stock fallback:", e.message);

    const cleanSymbol = String(stockSymbol || "SOFI").toUpperCase();

    stock = {
      symbol: cleanSymbol,
      price: 0,
      change: 0,
      changePercent: 0,
      stockUrl: `https://finance.yahoo.com/quote/${cleanSymbol}`
    };
  }

  try {
    card = await getCardData(cardQuery);
  } catch (e) {
    console.log("Card fallback:", e.message);

    const pokemon = await getPokemonData(cardQuery);

    card = {
      query: cardQuery,
      averagePrice: 0,
      listingsFound: 0,
      ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(cardQuery)}&campid=${EBAY_CAMPAIGN_ID}`,
      image: pokemon.pokemonImage,
      title: cardQuery,
      pokemon
    };
  }

  const psaTrend = getPsaTrend(card);
  const analysis = scoreMatchup(stock, card);

  const matchup = {
    title: `${stock.symbol} vs ${card.query}`,
    stock,
    card,
    psaTrend,
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
      "/api/matchup?stock=SOFI&card=Charizard%20Pokemon%20card",
      "/api/pokemon?card=Charizard%20Pokemon%20card",
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

app.get("/api/pokemon", async (req, res) => {
  try {
    const card = req.query.card || req.query.name || "Charizard Pokemon card";
    const pokemon = await getPokemonData(card);

    res.json({
      input: card,
      cleanedName: cleanPokemonName(card),
      pokemon
    });
  } catch (err) {
    res.status(500).json({
      error: "Pokemon failed",
      details: err.message
    });
  }
});

app.get("/api/matchup", async (req, res) => {
  try {
    const stock = req.query.stock || "SOFI";
    const card = req.query.card || "Charizard Pokemon card";

    const matchup = await buildMatchup(stock, card);
    res.json(matchup);
  } catch (err) {
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
      const matchup = await buildMatchup(stock, card);
      matchups.push(matchup);
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
      const matchup = await buildMatchup(stock, card);

      if (matchup.stock.price <= 5 || matchup.card.averagePrice <= 10) {
        matchups.push(matchup);
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
  console.log(`Server running on port ${PORT}`);
});
