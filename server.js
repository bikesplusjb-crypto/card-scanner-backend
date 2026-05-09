<script>

const SCANNER_API =
  "https://YOUR-RENDER-URL.onrender.com/api/scan-card";

/*
  IMPORTANT:
  Replace ONLY this line above with your real Render backend URL.

  Example:
  const SCANNER_API =
  "https://card-scanner-backend.onrender.com/api/scan-card";
*/

/* SAFE SCANNER */
async function scanCardReal(){

  const frontInput = document.getElementById("frontInput");
  const backInput = document.getElementById("backInput");

  const front = frontInput?.files?.[0];
  const back = backInput?.files?.[0];

  if(!front){

    alert("Please upload a front image first.");

    return;
  }

  /* UI LOADING */
  document.getElementById("demoCardName").innerText =
    "Scanning Card...";

  document.getElementById("demoSignal").innerText =
    "PROCESSING";

  const formData = new FormData();

  formData.append("front", front);

  if(back){
    formData.append("back", back);
  }

  try{

    const response = await fetch(
      SCANNER_API,
      {
        method:"POST",
        body:formData
      }
    );

    if(!response.ok){

      throw new Error(
        "Server returned " + response.status
      );
    }

    const data = await response.json();

    console.log("SCAN RESPONSE:", data);

    if(!data.success){

      throw new Error(
        data.error || "Card scan failed"
      );
    }

    /* CARD NAME */
    document.getElementById("demoCardName").innerText =
      data.cardName ||
      data.name ||
      "Card Found";

    /* SIGNAL */
    document.getElementById("demoSignal").innerText =
      data.signal ||
      "READY";

    /* AUTO PSA ROI */
    if(data.avgSoldPrice){

      document.getElementById("rawValue").value =
        Math.round(data.avgSoldPrice);

      calculatePSA();
    }

    /* AUTO SCROLL */
    document
      .getElementById("psaROISection")
      .scrollIntoView({
        behavior:"smooth"
      });

  }catch(error){

    console.error("SCAN ERROR:", error);

    document.getElementById("demoCardName").innerText =
      "Scan Failed";

    document.getElementById("demoSignal").innerText =
      "ERROR";

    alert(
      "Scanner failed: " +
      error.message
    );
  }
}

/* PSA CALC */
function calculatePSA(){

  var raw =
    Number(
      document.getElementById("rawValue").value || 0
    );

  var cost =
    Number(
      document.getElementById("gradingCost").value || 0
    );

  var psa9 =
    Number(
      document.getElementById("psa9Value").value || 0
    );

  var psa10 =
    Number(
      document.getElementById("psa10Value").value || 0
    );

  var totalCost = raw + cost;

  var profit9 = psa9 - totalCost;

  var profit10 = psa10 - totalCost;

  document.getElementById("psa9Profit").innerText =
    (profit9 >= 0 ? "$" : "-$")
    + Math.abs(profit9).toFixed(0);

  document.getElementById("psa10Profit").innerText =
    (profit10 >= 0 ? "$" : "-$")
    + Math.abs(profit10).toFixed(0);

  var signal = "WAIT";

  if(profit10 >= totalCost && profit9 >= 0){

    signal = "GRADE";

  }else if(profit10 > 0){

    signal = "WATCH";

  }else{

    signal = "SELL RAW";
  }

  document.getElementById("gradeSignal").innerText =
    signal;
}

/* AUTO INIT */
calculatePSA();

</script>
