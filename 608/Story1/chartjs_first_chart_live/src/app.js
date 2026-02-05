/* global Chart, ChartDataLabels */

async function loadJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function setStatus(msg){
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

function hexToRgba(hex, alpha){
  const h = hex.replace("#","").trim();
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const COLORS = {
  Biden: "#2166AC",
  Trump: "#B2182B",
  Unknown: "#777777"
};

const ANIM = {
  barDurationMs: 850,
  perBarStaggerMs: 35,
  labelLagMs: 120
};

async function usaspendingPost(endpoint, body){
  const res = await fetch(`https://api.usaspending.gov${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`USAspending error ${res.status}: ${txt.slice(0,200)}`);
  }
  return res.json();
}

async function getStateObligations(fy){
  const body = {
    scope: "place_of_performance",
    geo_layer: "state",
    filters: {
      time_period: [{
        start_date: `${fy-1}-10-01`,
        end_date: `${fy}-09-30`
      }]
    }
  };

  const out = await usaspendingPost("/api/v2/search/spending_by_geography/", body);
  const results = out.results || [];
  const map = new Map();
  for (const r of results){
    const st = String(r.shape_code || "").toUpperCase();
    const amt = Number(r.aggregated_amount ?? 0);
    map.set(st, amt);
  }
  return map;
}

// labels appear after each bar completes, in the same order bars animate
const labelsAfterBars = {
  id: "labelsAfterBars",
  beforeDatasetsDraw(chart){
    const meta0 = chart.getDatasetMeta(0);
    if (!meta0?.data?.length) return;

    const now = performance.now();
    if (!chart.$_animStart) chart.$_animStart = now;
    const t = now - chart.$_animStart;

    const perBarWindow = ANIM.barDurationMs + ANIM.perBarStaggerMs;
    const completed = Math.floor((t - ANIM.labelLagMs) / perBarWindow);
    chart.$_completedFlatIndex = completed;
  }
};

function labelDisplay(ctx){
  const chart = ctx.chart;
  const flat = ctx.dataIndex * 2 + ctx.datasetIndex; // baseline then fy24 per state
  const completed = chart.$_completedFlatIndex ?? -1;
  return flat <= completed;
}

function animationDelay(ctx){
  if (ctx.type !== "data") return 0;
  const flat = ctx.dataIndex * 2 + ctx.datasetIndex;
  return flat * ANIM.perBarStaggerMs;
}

function formatMoneyCompact(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v/1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `$${(v/1e6).toFixed(0)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

let chart;
function destroyChart(){
  if (chart){ chart.destroy(); chart = null; }
}

function downloadChartPNG(){
  if (!chart) return;
  const link = document.createElement("a");
  link.href = chart.canvas.toDataURL("image/png");
  link.download = `federal-obligations-${new Date().toISOString().split('T')[0]}.png`;
  link.click();
}

function buildChart({ stateOrder, preByState, fy24ByState, winnerMap }){
  const labels = stateOrder;
  const pre = labels.map(st => preByState.get(st) ?? 0);
  const fy24 = labels.map(st => fy24ByState.get(st) ?? 0);

  const preColors  = labels.map(st => hexToRgba(COLORS[winnerMap[st] ?? "Unknown"] ?? COLORS.Unknown, 0.4));
  const fy24Colors = labels.map(st => hexToRgba(COLORS[winnerMap[st] ?? "Unknown"] ?? COLORS.Unknown, 0.7));

  const ctx = document.getElementById("barTotal").getContext("2d");
  Chart.register(ChartDataLabels);

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "FY2017–FY2020 avg",
          data: pre,
          backgroundColor: preColors,
          borderWidth: 0,
          barPercentage: 0.90,
          categoryPercentage: 0.82
        },
        {
          label: "FY2024",
          data: fy24,
          backgroundColor: fy24Colors,
          borderWidth: 0,
          barPercentage: 0.90,
          categoryPercentage: 0.82
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      layout: { padding: { left: 6, right: 12, top: 18, bottom: 6 } },
      animation: {
        duration: ANIM.barDurationMs,
        easing: "easeOutQuart",
        delay: animationDelay
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items?.[0]?.label ?? "",
            label: (c) => `${c.dataset.label}: ${formatMoneyCompact(c.raw)}`
          }
        },
        datalabels: {
          display: labelDisplay,
          anchor: "end",
          align: "right",
          color: "#111",
          font: { size: 10, weight: "600" },
          formatter: (v) => formatMoneyCompact(v),
          clamp: true
        }
      },
      scales: {
        x: {
          display: false,
          grid: { display: false },
          border: { display: false },
          offset: false,
          stacked: false
        },
        y: {
          grid: { display: false },
          border: { display: false },
          offset: true,
          ticks: {
            color: "#111",
            font: { size: 11, weight: "700" },
            padding: 6
          }
        }
      }
    },
    plugins: [labelsAfterBars]
  });
}

async function main(){
  setStatus("Loading winner map…");
  const [states, winnerMap] = await Promise.all([
    loadJSON("./data/states_50.json"),
    loadJSON("./data/winner_2020.json")
  ]);

  setStatus("Fetching USAspending baseline FY2017–FY2020…");
  const years = [2017, 2018, 2019, 2020];
  const maps = [];
  for (let i=0;i<years.length;i++){
    setStatus(`Fetching baseline FY${years[i]} (${i+1}/4)…`);
    maps.push(await getStateObligations(years[i]));
  }

  setStatus("Fetching FY2024…");
  const fy24 = await getStateObligations(2024);

  const preByState = new Map();
  for (const st of states){
    const vals = maps.map(m => m.get(st) ?? 0);
    preByState.set(st, vals.reduce((s,v)=>s+v,0) / vals.length);
  }

  const fy24ByState = new Map();
  for (const st of states){
    fy24ByState.set(st, fy24.get(st) ?? 0);
  }

  const stateOrder = [...states].sort((a,b) => {
    const ma = Math.max(preByState.get(a) ?? 0, fy24ByState.get(a) ?? 0);
    const mb = Math.max(preByState.get(b) ?? 0, fy24ByState.get(b) ?? 0);
    return ma - mb;
  }).reverse();

  destroyChart();
  buildChart({ stateOrder, preByState, fy24ByState, winnerMap });

  // Show download button
  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) {
    downloadBtn.style.display = "block";
    downloadBtn.onclick = downloadChartPNG;
  }

  setTimeout(() => setStatus(""), 700);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      destroyChart();
      buildChart({ stateOrder, preByState, fy24ByState, winnerMap });
    }, 180);
  });
}

main().catch(err => {
  console.error(err);
  setStatus("Failed to load data (see console).");
  alert(err.message);
});
