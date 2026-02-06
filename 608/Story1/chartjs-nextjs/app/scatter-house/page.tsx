'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  TooltipItem,
  ScatterController,
  LineController,
  LineElement,
  ChartConfiguration,
  ChartDataset
} from 'chart.js';

ChartJS.register(ScatterController, LineController, LineElement, LinearScale, PointElement, Tooltip, Legend);

const COLORS = {
  Biden: '#2166AC',
  Trump: '#B2182B',
  Unknown: '#777777'
};

const ANIM = {
  durationMs: 700,
  perPointDelayMs: 6
};

type ChartWithAnim = ChartJS & { $_animStart?: number; $_completedFlatIndex?: number; $_trendFinalized?: boolean };

const zeroLines = {
  id: 'zeroLines',
  beforeDatasetsDraw(chart: ChartWithAnim) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const xZero = scales.x?.getPixelForValue(0);
    const yZero = scales.y?.getPixelForValue(0);
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    if (xZero !== undefined) {
      ctx.beginPath();
      ctx.moveTo(xZero, chartArea.top);
      ctx.lineTo(xZero, chartArea.bottom);
      ctx.stroke();
    }
    if (yZero !== undefined) {
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yZero);
      ctx.lineTo(chartArea.right, yZero);
      ctx.stroke();
    }
    ctx.restore();
  }
};

interface ScatterPoint {
  x: number;
  y: number;
  state: string;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) prob = 1 - prob;
  return prob;
}

function computeRegression(points: ScatterPoint[]) {
  const n = points.length;
  if (n < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let ssX = 0;
  let ssY = 0;
  let ssXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xBar;
    const dy = ys[i] - yBar;
    ssX += dx * dx;
    ssY += dy * dy;
    ssXY += dx * dy;
  }
  if (ssX === 0 || ssY === 0) return null;
  const slope = ssXY / ssX;
  const intercept = yBar - slope * xBar;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * xs[i] + intercept;
    sse += (ys[i] - yHat) ** 2;
  }
  const r2 = 1 - sse / ssY;
  const se = Math.sqrt((sse / (n - 2)) / ssX);
  const t = se === 0 ? 0 : slope / se;
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const line = [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept }
  ];
  return { slope, intercept, r2, p, line };
}

function formatDollars(v: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
}

function formatPercent(v: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return `${(v * 100).toFixed(1)}%`;
}

async function loadJSON(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadText(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

async function usaspendingPost(endpoint: string, body: object) {
  const res = await fetch(`https://api.usaspending.gov${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`USAspending error ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

const OBLIG_CACHE = new Map<number, Map<string, number>>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const cacheKey = (fy: number) => `usaspending_oblig_${fy}`;

function loadCachedObligations(fy: number): Map<string, number> | null {
  const mem = OBLIG_CACHE.get(fy);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(fy));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: [string, number][] };
    if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    const map = new Map<string, number>(parsed.data);
    OBLIG_CACHE.set(fy, map);
    return map;
  } catch {
    return null;
  }
}

function saveCachedObligations(fy: number, map: Map<string, number>) {
  OBLIG_CACHE.set(fy, map);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(fy), JSON.stringify({ ts: Date.now(), data: Array.from(map.entries()) }));
  } catch {
    // ignore storage errors
  }
}

async function getStateObligations(fy: number): Promise<Map<string, number>> {
  const cached = loadCachedObligations(fy);
  if (cached) return cached;

  const body = {
    scope: 'place_of_performance',
    geo_layer: 'state',
    filters: {
      time_period: [{
        start_date: `${fy - 1}-10-01`,
        end_date: `${fy}-09-30`
      }]
    }
  };

  const out = await usaspendingPost('/api/v2/search/spending_by_geography/', body);
  const results = out.results || [];
  const map = new Map();
  for (const r of results) {
    const st = String(r.shape_code || '').toUpperCase();
    const amt = Number(r.aggregated_amount ?? 0);
    map.set(st, amt);
  }
  saveCachedObligations(fy, map);
  return map;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }

    if (ch === '\r') continue;

    cur += ch;
  }

  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }

  return rows;
}

function parsePopulationCSV(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const [state, fy, pop] = lines[i].split(',');
    if (!state || !fy) continue;
    map.set(`${state}-${fy}`, Number(pop));
  }
  return map;
}

function mapHouseMargins(csvText: string): Map<string, number> {
  const rows = parseCSV(csvText);
  const header = rows[0] ?? [];
  const idxSt = header.indexOf('ST');
  const idxDem = header.indexOf('Votes_Dem_2024');
  const idxGop = header.indexOf('Votes_GOP_2024');

  const totals = new Map<string, { dem: number; gop: number }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const st = r[idxSt];
    if (!st) continue;
    const dem = Number(r[idxDem] || 0);
    const gop = Number(r[idxGop] || 0);
    const cur = totals.get(st) ?? { dem: 0, gop: 0 };
    cur.dem += Number.isNaN(dem) ? 0 : dem;
    cur.gop += Number.isNaN(gop) ? 0 : gop;
    totals.set(st, cur);
  }

  const out = new Map<string, number>();
  for (const [st, t] of totals) {
    const total = t.dem + t.gop;
    if (total === 0) continue;
    out.set(st, (t.dem - t.gop) / total);
  }
  return out;
}

export default function ScatterHousePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const [status, setStatus] = useState('Loading data…');
  const [stats, setStats] = useState<{ r2: number; p: number; relevant: boolean } | null>(null);
  const [displayedWords, setDisplayedWords] = useState(0);
  const [viewMode, setViewMode] = useState<'desc' | 'key'>('desc');

  useEffect(() => {
    async function main() {
      try {
        setStatus('Loading population and election data…');
        const [popText, states, winnerMap, districtsCsv] = await Promise.all([
          loadText('/data/population_by_state_fy.csv'),
          loadJSON('/data/states_50.json'),
          loadJSON('/data/winner_2020.json'),
          loadText('/data/2024-electoral-districts.csv')
        ]);

        const popMap = parsePopulationCSV(popText);
        const houseMargins = mapHouseMargins(districtsCsv);

        const preYears = [2017, 2018, 2019, 2020];
        const bidenYears = [2021, 2022, 2023, 2024];
        const allYears = [...preYears, ...bidenYears];

        setStatus('Fetching USAspending FY2017–FY2024…');
        const yearMaps = new Map<number, Map<string, number>>();
        await Promise.all(
          allYears.map(async (fy) => {
            const m = await getStateObligations(fy);
            yearMaps.set(fy, m);
          })
        );

        const pointsByWinner: Record<string, ScatterPoint[]> = {
          Biden: [],
          Trump: [],
          Unknown: []
        };

        for (const st of states) {
          const preAvg =
            preYears.reduce((s, fy) => {
              const pop = popMap.get(`${st}-${fy}`) ?? 0;
              const amt = yearMaps.get(fy)?.get(st) ?? 0;
              return s + (pop > 0 ? amt / pop : 0);
            }, 0) / preYears.length;

          const bidenAvg =
            bidenYears.reduce((s, fy) => {
              const pop = popMap.get(`${st}-${fy}`) ?? 0;
              const amt = yearMaps.get(fy)?.get(st) ?? 0;
              return s + (pop > 0 ? amt / pop : 0);
            }, 0) / bidenYears.length;

          if (!Number.isFinite(preAvg) || !Number.isFinite(bidenAvg)) continue;
          const deltaPc = bidenAvg - preAvg;
          const margin = houseMargins.get(st);
          if (margin === undefined) continue;

          const winner = (winnerMap[st] ?? 'Unknown') as keyof typeof COLORS;
          pointsByWinner[winner]?.push({ x: deltaPc, y: margin, state: st });
        }

        buildChart(pointsByWinner);
        setStatus('');
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    function buildChart(pointsByWinner: Record<string, ScatterPoint[]>) {
      if (!canvasRef.current) return;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      const existing = ChartJS.getChart(canvasRef.current);
      if (existing) existing.destroy();

      const allPoints = [
        ...pointsByWinner.Biden,
        ...pointsByWinner.Trump,
        ...pointsByWinner.Unknown
      ];
      const reg = computeRegression(allPoints);
      const relevant = reg ? reg.p < 0.05 && reg.r2 >= 0.1 : false;
      if (reg) setStats({ r2: reg.r2, p: reg.p, relevant });

      const config = {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Biden 2020 states',
              data: pointsByWinner.Biden,
              backgroundColor: COLORS.Biden,
              borderColor: COLORS.Biden,
              pointRadius: 3
            },
            {
              label: 'Trump 2020 states',
              data: pointsByWinner.Trump,
              backgroundColor: COLORS.Trump,
              borderColor: COLORS.Trump,
              pointRadius: 3
            },
            {
              label: 'Unknown',
              data: pointsByWinner.Unknown,
              backgroundColor: COLORS.Unknown,
              borderColor: COLORS.Unknown,
              pointRadius: 3
            },
            {
              label: 'Trend',
              data: reg ? reg.line : [],
              type: 'line',
              showLine: true,
              borderColor: relevant ? '#111' : 'rgba(17,17,17,0.5)',
              borderWidth: 1,
              borderDash: relevant ? [1000, 1000] : [4, 4],
              borderDashOffset: 1000,
              pointRadius: 0,
              tension: 0,
              animations: {
                borderDashOffset: {
                  from: 1000,
                  to: 0,
                  duration: 1200,
                  easing: 'easeOutQuart'
                }
              }
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: ANIM.durationMs,
            easing: 'easeOutQuart',
            delay(ctx: { type?: string; dataIndex: number }) {
              if (ctx.type !== 'data') return 0;
              return ctx.dataIndex * ANIM.perPointDelayMs;
            },
            onComplete: () => {
              const chart = chartRef.current as ChartWithAnim | null;
              if (!chart) return;
              if (chart.$_trendFinalized) return;
              chart.$_trendFinalized = true;
              const trend = chart.data.datasets.find((d) => d.label === 'Trend') as
                | ChartDataset<'line', ScatterPoint[]>
                | undefined;
              if (!trend) return;
              trend.borderDash = relevant ? [] : [4, 4];
              trend.borderDashOffset = 0;
              chart.update();
            }
          },
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
            tooltip: {
              callbacks: {
                title: (items: TooltipItem<'scatter'>[]) =>
                  (items?.[0]?.raw as ScatterPoint | undefined)?.state ?? '',
                label: (item: TooltipItem<'scatter'>) => {
                  const raw = item.raw as ScatterPoint;
                  return `Δ per capita: ${formatDollars(raw.x)} · 2024 house margin: ${formatPercent(raw.y)}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: '#666',
                maxTicksLimit: 4,
                callback: (v: string | number) => formatDollars(Number(v))
              }
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: '#666',
                maxTicksLimit: 4,
                callback: (v: string | number) => `${Number(v) * 100}%`
              }
            }
          }
        },
        plugins: [zeroLines]
      } as unknown as ChartConfiguration<'scatter', ScatterPoint[], string>;

      chartRef.current = new ChartJS(canvasRef.current, config);
    }

    main();

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  const chartDescription =
    'This : compares the Biden-era average (FY2021–FY2024) to the pre-Biden baseline (FY2017–FY2020) and relates those changes to statewide 2024 House margins. Points are colored by 2020 presidential winner.';
  const keyObservations =
    'Key observations: The association is moderately positive, but dispersion remains. Outliers include HI, VT, WY, MD, and SD, highlighting local dynamics that can outweigh spending changes.';
  const textToShow = viewMode === 'desc' ? chartDescription : keyObservations;
  const words = textToShow.split(' ');

  useEffect(() => {
    setDisplayedWords(0);
    let wordIndex = 0;
    const wordInterval = setInterval(() => {
      wordIndex++;
      setDisplayedWords(wordIndex);
      if (wordIndex >= words.length) {
        clearInterval(wordInterval);
      }
    }, 60);
    return () => clearInterval(wordInterval);
  }, [words.length, viewMode]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-5 pb-16 shadow flex flex-col h-screen">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">
            Spending Change vs 2024 House Margin
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Δ obligations per capita (mean FY2021–FY2024 − mean FY2017–FY2020) vs 2024 House margin
          </p>
        </div>
        <div className="mb-3">
          <div className="text-sm text-gray-600">{status}</div>
        </div>
        <div className="relative flex-1 min-h-0 pb-2">
          <canvas ref={canvasRef} id="scatterHouse" className="w-full h-full"></canvas>
          {stats && (
            <div className="absolute right-6 bottom-20 text-right text-xs text-gray-800">
              <div className="font-semibold uppercase tracking-wide">Linear Fit</div>
              <div className="font-semibold">R2 {stats.r2.toFixed(2)}</div>
              <div className="font-semibold">p {stats.p.toFixed(3)}</div>
            </div>
          )}
        </div>
        <div className="mt-3 mb-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700">
          {words.slice(0, displayedWords).map((word, idx) => (
            <span key={idx} className="inline animate-fadeIn">
              {word}{' '}
            </span>
          ))}
          {displayedWords < words.length && (
            <span className="inline-block h-4 w-0.5 ml-1 bg-blue-500 animate-pulse"></span>
          )}
          <div className="mt-2 text-[11px] text-gray-600">
            {viewMode === 'desc' ? (
              <button
                type="button"
                className="font-semibold italic underline underline-offset-2"
                onClick={() => setViewMode('key')}
              >
                Key observations...
              </button>
            ) : (
              <button
                type="button"
                className="font-semibold italic underline underline-offset-2"
                onClick={() => setViewMode('desc')}
              >
                Description...
              </button>
            )}
          </div>
          {stats && null}
        </div>

        <Link
          href="/scatter-pres"
          className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to presidential margin scatter"
        >
          <span className="inline-block">‹</span>
        </Link>
        <Link
          href="/delta-biden"
          className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to delta bar chart"
        >
          <span className="inline-block">›</span>
        </Link>
        <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/65 px-4 py-1 text-xs text-gray-600 shadow-md backdrop-blur scale-75 origin-bottom">
          <span className="font-semibold text-gray-900">6 / 8</span>
          <div className="flex items-center gap-2">
            <Link href="/intro" aria-label="Go to page 1">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/iija" aria-label="Go to page 2">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/totals" aria-label="Go to page 3">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/per-capita" aria-label="Go to page 4">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/scatter-pres" aria-label="Go to page 5">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/scatter-house" aria-label="Go to page 6">
              <span className="block h-2 w-2 rounded-full bg-gray-900"></span>
            </Link>
            <Link href="/delta-biden" aria-label="Go to page 7">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/sources" aria-label="Go to page 8">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
