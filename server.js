app.get("/api/pokemon-movers", async (req, res) => {
  const watchlist = [
    { name: "Charizard Base Set PSA 10", set: "Base Set", fallback: 13500 },
    { name: "Pikachu Van Gogh", set: "Promo", fallback: 185 },
    { name: "Umbreon VMAX Alt Art", set: "Evolving Skies", fallback: 850 },
    { name: "Lugia V Alt Art", set: "Silver Tempest", fallback: 165 },
    { name: "Moonbreon PSA 10", set: "Evolving Skies", fallback: 1450 }
  ];

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function removeOutliers(prices) {
    if (prices.length < 4) return prices;
    const sorted = [...prices].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const low = q1 - iqr * 1.5;
    const high = q3 + iqr * 1.5;
    return sorted.filter(p => p >= low && p <= high);
  }

  function confidenceFromCount(count) {
    if (count >= 20) return "High";
    if (count >= 8) return "Medium";
    if (count >= 3) return "Low-Medium";
    return "Low";
  }

  function demandFromCount(count) {
    if (count >= 20) return "Very Strong";
    if (count >= 10) return "Strong";
    if (count >= 5) return "Moderate";
    if (count >= 1) return "Thin";
    return "No recent data";
  }

  async function getActiveComps(token, query) {
    const ebayUrl =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(query)}` +
      "&category_ids=183454" +
      "&limit=50" +
      "&filter=price:[1..50000],priceCurrency:USD";

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const ebayData = await ebayRes.json();
    const items = ebayData.itemSummaries || [];

    const rawPrices = items
      .map(moneyToNumber)
      .filter(n => n && n > 0 && n < 50000);

    const prices = removeOutliers(rawPrices);
    const stats = calcStats(prices);

    return {
      type: "active_listing_estimate",
      average: stats.average,
      median: median(prices) ? Number(median(prices).toFixed(2)) : null,
      low: stats.low,
      high: stats.high,
      count: stats.count,
      rawCount: rawPrices.length
    };
  }

  async function getSoldCompsPlaceholder(query) {
    // Placeholder until you get true eBay Marketplace Insights access
    // or add a paid sold-comps provider.
    return {
      type: "sold_comps_not_connected",
      average: null,
      median: null,
      low: null,
      high: null,
      count: 0,
      note: "True sold comps require eBay Marketplace Insights access or a sold-comps data provider."
    };
  }

  try {
    const token = await getEbayToken();

    const movers = await Promise.all(
      watchlist.map(async card => {
        const query = `${card.name} pokemon card`;

        const active = await getActiveComps(token, query);
        const sold = await getSoldCompsPlaceholder(query);

        const activeAvg = active.average || card.fallback;
        const soldAvg = sold.average || null;

        const marketPrice = soldAvg || activeAvg;
        const demand = demandFromCount(active.count);
        const confidence = confidenceFromCount(active.count);

        let signal = "WATCH";
        let risk = "Medium";
        let score = 72;

        if (active.count >= 10) {
          signal = "HOLD";
          score = 82;
        }

        if (active.count >= 20) {
          signal = "BUY";
          score = 90;
        }

        if (marketPrice > card.fallback * 1.25) {
          risk = "Medium-High";
          score += 3;
        }

        if (active.count <= 3) {
          risk = "Thin Market";
          score = 68;
        }

        const trend = active.count >= 20 ? 8.5 : active.count >= 10 ? 5.2 : active.count >= 5 ? 2.8 : 1.2;

        return {
          name: card.name,
          set: card.set,

          price: Number(marketPrice.toFixed(2)),
          activeAvg: active.average,
          activeMedian: active.median,
          activeLow: active.low,
          activeHigh: active.high,
          activeVolume: active.count,

          soldAvg,
          soldMedian: sold.median,
          soldLow: sold.low,
          soldHigh: sold.high,
          soldVolume: sold.count,

          low: active.low,
          high: active.high,
          volume: active.count,

          demand,
          confidence,
          change: trend,
          signal,
          score: Math.min(score, 98),
          risk,

          reason:
            soldAvg
              ? `Sold comps show ${sold.count} recent sales. Active listings show ${active.count} listings.`
              : `Active listings show ${active.count} current listings. Sold comps are ready but not connected yet.`,

          pricingSource:
            soldAvg ? "Sold comps + active listings" : "Active listings only",

          activeUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
          soldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
        };
      })
    );

    res.json({
      ok: true,
      pricingType: "Sold-comps ready engine; active eBay estimate currently connected",
      updated: new Date().toISOString(),
      movers
    });
  } catch (err) {
    console.error("POKEMON COMPS ERROR:", err.message);

    res.status(500).json({
      ok: false,
      error: "Pokemon comps engine failed",
      details: err.message
    });
  }
});
