<div id="pokemonBox"></div>

<script>
const BACKEND = "https://card-scanner-backend-2frn.onrender.com";

/* 🔧 CLEAN INPUT */
function cleanPokemonName(input) {
  return input
    .toLowerCase()
    .replace(/pokemon/g, "")
    .replace(/card/g, "")
    .replace(/psa\s*\d+/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/* 🔥 FETCH MATCHUP SAFELY */
async function runMatchup(stock, card) {
  const box = document.getElementById("pokemonBox");

  box.innerHTML = "⏳ Loading matchup...";

  try {
    // Clean Pokémon input
    const cleanCard = cleanPokemonName(card);

    const res = await fetch(
      `${BACKEND}/api/matchup?stock=${encodeURIComponent(stock)}&card=${encodeURIComponent(cleanCard)}`
    );

    const data = await res.json();

    if (!data || data.error) {
      throw new Error(data?.error || "Bad response");
    }

    renderMatchup(data);

  } catch (err) {
    console.log("Matchup error:", err);

    box.innerHTML = `
      <div style="
        background:#7f1d1d;
        padding:16px;
        border-radius:12px;
        color:white;
        text-align:center;
      ">
        ⚠️ Live data unavailable — showing estimate
      </div>
    `;

    // fallback render
    renderFallback(stock, card);
  }
}

/* 🎯 RENDER MATCHUP */
function renderMatchup(data) {
  const box = document.getElementById("pokemonBox");

  box.innerHTML = `
    <div style="
      background:#0f172a;
      padding:20px;
      border-radius:16px;
      color:white;
      border:1px solid #1f2937;
    ">
      <h2>${data.title}</h2>

      <div style="display:flex;gap:10px;margin-top:10px;">
        <div style="flex:1;background:#111827;padding:10px;border-radius:10px;">
          📈 <b>${data.stock.symbol}</b><br>
          $${data.stock.price} (${data.stock.changePercent}%)
        </div>

        <div style="flex:1;background:#111827;padding:10px;border-radius:10px;">
          🃏 <b>Card</b><br>
          $${data.card.averagePrice} avg
        </div>
      </div>

      <div style="
        margin-top:12px;
        background:#1f2937;
        padding:10px;
        border-radius:10px;
      ">
        🔥 <b>${data.analysis.decision}</b><br>
        Confidence: ${data.analysis.confidence}%
      </div>

      <p style="margin-top:10px;color:#94a3b8;">
        ${data.analysis.reason}
      </p>

      <div style="margin-top:12px;display:flex;gap:10px;">
        <a href="${data.stock.stockUrl}" target="_blank"
          style="background:#3b82f6;padding:8px 12px;border-radius:8px;color:white;text-decoration:none;">
          View Stock
        </a>

        <a href="${data.card.ebayUrl}" target="_blank"
          style="background:#22c55e;padding:8px 12px;border-radius:8px;color:white;text-decoration:none;">
          Buy Card
        </a>

        <button onclick="showTikTok('${encodeURIComponent(JSON.stringify(data.tiktok))}')"
          style="background:#a855f7;padding:8px 12px;border-radius:8px;color:white;border:none;">
          TikTok Script
        </button>
      </div>
    </div>
  `;
}

/* 🧠 FALLBACK (NEVER BREAK UI) */
function renderFallback(stock, card) {
  const box = document.getElementById("pokemonBox");

  box.innerHTML += `
    <div style="
      margin-top:12px;
      background:#020617;
      padding:16px;
      border-radius:12px;
      color:#94a3b8;
    ">
      ${stock} vs ${card}<br>
      ⚠️ Using fallback data — try again shortly
    </div>
  `;
}

/* 🎬 TIKTOK POPUP */
function showTikTok(encoded) {
  const data = JSON.parse(decodeURIComponent(encoded));

  alert(
    data.hook + "\n\n" +
    data.script + "\n\n" +
    data.caption + "\n\n" +
    data.hashtags.join(" ")
  );
}
</script>
