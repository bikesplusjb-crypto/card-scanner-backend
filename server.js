<script>
const API_URL = "https://card-scanner-backend-2frn.onrender.com/api/pokemon-movers";

const app = document.getElementById("pokemonApp");

// Loading state
app.innerHTML = `
  <div style="color:white;padding:40px;text-align:center;font-size:20px;">
    🚀 Loading Live Pokémon Market...
  </div>
`;

function ebayActive(name){
  return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(name);
}

function ebaySold(name){
  return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(name) + "&LH_Sold=1&LH_Complete=1";
}

fetch(API_URL)
  .then(res => res.json())
  .then(data => {

    if(!data.ok){
      throw new Error("API error");
    }

    app.innerHTML = `
      <div style="font-family:Arial;background:#020617;color:white;padding:24px;border-radius:20px;">
        
        <h1>🔥 Pokémon Market Tracker</h1>
        <p style="color:#22c55e;">Live Pricing Connected ✅</p>
        <p style="color:#94a3b8;font-size:13px;">
          ${data.pricingType || ""}
        </p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:18px;">
          
          ${data.movers.map(card => `
            <div style="
              background:#0f172a;
              padding:20px;
              border-radius:18px;
              border:1px solid #334155;
              box-shadow:0 10px 25px rgba(0,0,0,.3);
              transition:.2s;
            "
            onmouseover="this.style.transform='scale(1.03)'"
            onmouseout="this.style.transform='scale(1)'"
            >

              <h2 style="margin:0 0 6px;">${card.name}</h2>
              <p style="color:#94a3b8;margin-bottom:10px;">${card.set}</p>

              <h3 style="margin:0;">$${Number(card.price).toLocaleString()}</h3>

              <p style="color:${card.change > 0 ? '#22c55e' : '#ef4444'};font-weight:800;">
                Trend Score: ${card.change}%
              </p>

              <p><b>${card.signal}</b> | AI Score: ${card.score}</p>
              <p style="color:#facc15;">Risk: ${card.risk}</p>

              <p style="font-size:13px;color:#94a3b8;">
                ${card.reason}
              </p>

              <div style="font-size:13px;margin-top:8px;">
                📊 Listings: ${card.volume || "N/A"}<br>
                💰 Range: $${card.low || "?"} - $${card.high || "?"}
              </div>

              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                
                <a target="_blank"
                   href="${ebayActive(card.name)}"
                   style="background:#22c55e;color:#03120a;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800;">
                   Live Listings
                </a>

                <a target="_blank"
                   href="${ebaySold(card.name)}"
                   style="background:#38bdf8;color:#031827;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800;">
                   Sold Data
                </a>

              </div>

            </div>
          `).join("")}

        </div>

      </div>
    `;
  })
  .catch((err) => {
    app.innerHTML = `
      <div style="color:red;padding:40px;">
        ❌ Failed to load Pokémon data<br>
        ${err.message}
      </div>
    `;
  });
</script>
