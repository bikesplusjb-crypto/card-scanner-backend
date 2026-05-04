<script>
const API_URL = "https://card-scanner-backend-2frn.onrender.com/api/pokemon-movers";

const app = document.getElementById("pokemonApp");

// Loading state
app.innerHTML = `
  <div style="color:white;padding:40px;text-align:center;">
    🚀 Loading Pokémon Market...
  </div>
`;

fetch(API_URL)
  .then(res => res.json())
  .then(data => {
    app.innerHTML = `
      <div style="font-family:Arial;background:#020617;color:white;padding:24px;border-radius:20px;">
        <h1>Pokémon Market Tracker</h1>
        <p style="color:#22c55e;">Connected ✅</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
          ${data.movers.map(card => `
            <div style="background:#0f172a;padding:18px;border-radius:16px;border:1px solid #334155;transition:.2s;">
              
              <h2>${card.name}</h2>
              <p>${card.set}</p>

              <h3>$${Number(card.price).toLocaleString()}</h3>

              <p style="color:${card.change > 0 ? '#22c55e' : '#ef4444'};">
                30-Day Change: ${card.change}%
              </p>

              <p><b>${card.signal}</b> | AI Score: ${card.score}</p>
              <p>Risk: ${card.risk}</p>

              <p style="font-size:13px;color:#94a3b8;">
                ${card.reason}
              </p>

              <a target="_blank"
                 href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(card.name)}"
                 style="display:inline-block;background:#22c55e;color:#03120a;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800;margin-top:10px;">
                 View Listings
              </a>

            </div>
          `).join("")}
        </div>
      </div>
    `;
  })
  .catch(() => {
    app.innerHTML = `
      <div style="color:red;padding:40px;">
        ❌ Failed to load Pokémon data
      </div>
    `;
  });
</script>
