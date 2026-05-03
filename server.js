const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let ebayToken = null;
let ebayTokenExpires = 0;

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpires) return ebayToken;

  const auth = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
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

  if (!data.access_token) {
    throw new Error("Could not get eBay token: " + JSON.stringify(data));
  }

  ebayToken = data.access_token;
  ebayTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return ebayToken;
}

function moneyToNumber(item) {
  const price = item?.price?.value;
  const shipping = item?.shippingOptions?.[0]?.shippingCost?.value || 0;
  return Number(price || 0) + Number(shipping || 0);
}

function calcStats(prices) {
  if (!prices.length) {
    return {
      average: null,
      low: null,
      high: null,
      count: 0
    };
  }

  const sorted = prices.sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const average = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  return {
    average: Number(average.toFixed(2)),
    low: Number(low.toFixed(2)),
    high: Number(high.toFixed(2)),
    count: sorted.length
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Premium Card Value Engine Running",
    routes: ["/health", "/value"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend connected" });
});

app.get("/value", async (req, res) => {
  try {
    const { player = "", year = "", brand = "", set = "", cardNumber = "" } = req.query;

    const query = `${player} ${year} ${brand} ${set} ${cardNumber} sports card`
      .replace(/\s+/g, " ")
      .trim();

    if (!query || query.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Missing card search details"
      });
    }

    const token = await getEbayToken();

    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(query)}` +
      "&category_ids=212" +
      "&limit=25" +
      "&filter=price:[1..10000],priceCurrency:USD";

    const ebayRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const ebayData = await ebayRes.json();

    if (!ebayRes.ok) {
      return res.status(500).json({
        ok: false,
        error: "eBay API failed",
        details: ebayData
      });
    }

    const items = ebayData.itemSummaries || [];

    const prices = items
      .map(moneyToNumber)
      .filter(n => n && n > 0 && n < 10000);

    const stats = calcStats(prices);

    let marketSignal = "Flat";
    let signalColor = "yellow";

    if (stats.count >= 15 && stats.average >= 75) {
      marketSignal = "Hot";
      signalColor = "green";
    } else if (stats.count <= 3) {
      marketSignal = "Thin Market";
      signalColor = "gray";
    } else if (stats.average < 10) {
      marketSignal = "Cold";
      signalColor = "red";
    }

    res.json({
      ok: true,
      query,
      estimateType: "Active listing estimate",
      estimatedValue: stats.average,
      low: stats.low,
      high: stats.high,
      listingCount: stats.count,
      marketSignal,
      signalColor,
      activeUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
      soldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`,
      items: items.slice(0, 6).map(item => ({
        title: item.title,
        price: item.price,
        image: item.image?.imageUrl,
        url: item.itemWebUrl
      }))
    });
  } catch (err) {
    console.error("VALUE ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Value engine failed",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Value engine running on port ${PORT}`);
});
