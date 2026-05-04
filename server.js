app.get("/api/stocks-live", async (req, res) => {
  try {
    const symbols = String(req.query.symbols || "NVDA,AMD,TSLA,MARA,GOOG,PLTR,SMCI")
      .toUpperCase()
      .replace(/\s/g, "");

    const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols);

    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const data = await r.json();
    const results = data?.quoteResponse?.result || [];

    const stocks = results.map(s => {
      const price = Number(s.regularMarketPrice || 0);
      const changePct = Number(s.regularMarketChangePercent || 0);

      let signal = "WATCH";
      let risk = "Medium";
      let score = 80;

      if (changePct >= 3) {
        signal = "HOT";
        score = 94;
        risk = "Medium-High";
      } else if (changePct >= 1) {
        signal = "UPTREND";
        score = 88;
      } else if (changePct <= -3) {
        signal = "RISK";
        score = 70;
        risk = "High";
      }

      return {
        symbol: s.symbol,
        name: s.shortName || s.longName || s.symbol,
        price,
        change: Number((s.regularMarketChange || 0).toFixed(2)),
        changePct: Number(changePct.toFixed(2)),
        volume: s.regularMarketVolume || 0,
        marketCap: s.marketCap || null,
        signal,
        risk,
        score,
        chartUrl: `https://finance.yahoo.com/quote/${s.symbol}`
      };
    });

    res.json({
      ok: true,
      updated: new Date().toISOString(),
      stocks
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Live stock API failed",
      details: err.message
    });
  }
});
