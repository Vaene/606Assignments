'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  TooltipItem,
  ChartConfiguration
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, ChartDataLabels);

const COLORS = {
  Biden: '#2166AC',
  Trump: '#B2182B',
  Unknown: '#777777'
};

const ANIM = {
  barDurationMs: 850,
  perBarStaggerMs: 35,
  labelLagMs: 120
};

type ChartWithAnim = ChartJS & { $_animStart?: number; $_completedFlatIndex?: number };

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

function normalizeStateName(name: string): string {
  return name.trim().toUpperCase();
}

function stateNameToAbbr(name: string): string | null {
  const map: Record<string, string> = {
    ALABAMA: 'AL',
    ALASKA: 'AK',
    ARIZONA: 'AZ',
    ARKANSAS: 'AR',
    CALIFORNIA: 'CA',
    COLORADO: 'CO',
    CONNECTICUT: 'CT',
    DELAWARE: 'DE',
    'DISTRICT OF COLUMBIA': 'DC',
    FLORIDA: 'FL',
    GEORGIA: 'GA',
    HAWAII: 'HI',
    IDAHO: 'ID',
    ILLINOIS: 'IL',
    INDIANA: 'IN',
    IOWA: 'IA',
    KANSAS: 'KS',
    KENTUCKY: 'KY',
    LOUISIANA: 'LA',
    MAINE: 'ME',
    MARYLAND: 'MD',
    MASSACHUSETTS: 'MA',
    MICHIGAN: 'MI',
    MINNESOTA: 'MN',
    MISSISSIPPI: 'MS',
    MISSOURI: 'MO',
    MONTANA: 'MT',
    NEBRASKA: 'NE',
    NEVADA: 'NV',
    'NEW HAMPSHIRE': 'NH',
    'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM',
    'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC',
    'NORTH DAKOTA': 'ND',
    OHIO: 'OH',
    OKLAHOMA: 'OK',
    OREGON: 'OR',
    PENNSYLVANIA: 'PA',
    'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD',
    TENNESSEE: 'TN',
    TEXAS: 'TX',
    UTAH: 'UT',
    VERMONT: 'VT',
    VIRGINIA: 'VA',
    WASHINGTON: 'WA',
    'WEST VIRGINIA': 'WV',
    WISCONSIN: 'WI',
    WYOMING: 'WY'
  };
  return map[normalizeStateName(name)] ?? null;
}

const labelsAfterBars = {
  id: 'labelsAfterBars',
  beforeDatasetsDraw(chart: ChartWithAnim) {
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

function labelDisplay(ctx: { chart: ChartWithAnim; dataIndex: number }) {
  const chart = ctx.chart;
  const completed = chart.$_completedFlatIndex ?? -1;
  return ctx.dataIndex <= completed;
}

function animationDelay(ctx: { type?: string; dataIndex: number }) {
  if (ctx.type !== 'data') return 0;
  return ctx.dataIndex * ANIM.perBarStaggerMs;
}

function formatDollars(v: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
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

export default function IijaPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const [status, setStatus] = useState('Loading IIJA data…');
  const [loading, setLoading] = useState(true);
  const [displayedWords, setDisplayedWords] = useState(0);
  const [viewMode, setViewMode] = useState<'desc' | 'key'>('desc');

  const chartDescription =
    'This chart uses the IIJA funding snapshot (March 2023) to show infrastructure-specific allocations per capita by state. It is the catalyst for the broader analysis, showing a focused program view that inspired pulling USAspending totals and election results to test whether spending shifts aligned with voting patterns.';
  const keyObservations =
    'Key observations: Per-capita IIJA funding highlights smaller states with higher dollars per resident. This program snapshot sparked the broader pull of USAspending totals to see whether the same patterns appear in overall obligations.';
  const textToShow = viewMode === 'desc' ? chartDescription : keyObservations;
  const words = textToShow.split(' ');

  useEffect(() => {
    async function main() {
      try {
        setStatus('Loading IIJA snapshot and population data…');
        const [iijaCsv, popText, winnerMap, states] = await Promise.all([
          loadText('/data/iija_funding_march_2023.csv'),
          loadText('/data/population_by_state_fy.csv'),
          loadJSON('/data/winner_2020.json'),
          loadJSON('/data/states_50.json')
        ]);

        const popMap = parsePopulationCSV(popText);
        const rows = parseCSV(iijaCsv);
        const header = rows[0] ?? [];
        const idxName = header.findIndex((h) => h.toLowerCase().includes('state'));
        const idxTotal = header.findIndex((h) => h.toLowerCase().includes('total'));

        const data: { state: string; iija_pc: number; winner: string }[] = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const name = r[idxName];
          const totalBil = Number(r[idxTotal] || 0);
          const abbr = stateNameToAbbr(name);
          if (!abbr) continue;
          const pop2023 = popMap.get(`${abbr}-2023`) ?? 0;
          if (pop2023 <= 0) continue;
          const iijaTotal = totalBil * 1e9;
          const iijaPc = iijaTotal / pop2023;
          const winner = (winnerMap[abbr] ?? 'Unknown') as string;
          data.push({ state: abbr, iija_pc: iijaPc, winner });
        }

        const ordered = [...states].filter((s: string) => data.find((d) => d.state === s));
        ordered.sort((a: string, b: string) => {
          const va = data.find((d) => d.state === a)?.iija_pc ?? 0;
          const vb = data.find((d) => d.state === b)?.iija_pc ?? 0;
          return vb - va;
        });

        buildChart(ordered, data, winnerMap);
        setStatus('');
        setLoading(false);
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    function buildChart(stateOrder: string[], data: { state: string; iija_pc: number }[], winnerMap: Record<string, string>) {
      if (!canvasRef.current) return;
      if (chartRef.current) chartRef.current.destroy();

      const values = stateOrder.map((st) => data.find((d) => d.state === st)?.iija_pc ?? 0);
      const colors = stateOrder.map((st) =>
        COLORS[(winnerMap[st] ?? 'Unknown') as keyof typeof COLORS] ?? COLORS.Unknown
      );

      const config: ChartConfiguration<'bar', number[], string> = {
        type: 'bar',
        data: {
          labels: stateOrder,
          datasets: [
            {
              label: 'IIJA funding per capita (March 2023)',
              data: values,
              backgroundColor: colors,
              borderWidth: 0,
              barPercentage: 0.9,
              categoryPercentage: 0.82
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          devicePixelRatio: window.devicePixelRatio || 1,
          indexAxis: 'y',
          layout: { padding: { left: 6, right: 12, top: 8, bottom: 6 } },
          animation: {
            duration: ANIM.barDurationMs,
            easing: 'easeOutQuart',
            delay: animationDelay
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: TooltipItem<'bar'>[]) => items?.[0]?.label ?? '',
                label: (c: TooltipItem<'bar'>) => `IIJA per capita: ${formatDollars(c.raw as number)}`
              }
            },
            datalabels: {
              display: labelDisplay,
              anchor: 'end',
              align: 'right',
              color: '#111',
              font: { size: 8, weight: 600 },
              formatter: (v: number) => formatDollars(v),
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
                color: '#111',
                font: { size: 8, weight: 700 },
                padding: 4
              }
            }
          }
        },
        plugins: [labelsAfterBars]
      };

      chartRef.current = new ChartJS(canvasRef.current, config);
    }

    main();
  }, []);

  useEffect(() => {
    if (loading || !chartRef.current) return;
    const estimatedChartAnimEnd = ANIM.barDurationMs + 51 * ANIM.perBarStaggerMs + ANIM.labelLagMs + 300;
    const delay = viewMode === 'desc' ? estimatedChartAnimEnd : 0;
    setDisplayedWords(0);
    const animationTimeout = setTimeout(() => {
      let wordIndex = 0;
      const wordInterval = setInterval(() => {
        wordIndex++;
        setDisplayedWords(wordIndex);
        if (wordIndex >= words.length) {
          clearInterval(wordInterval);
        }
      }, 80);
      return () => clearInterval(wordInterval);
    }, delay);
    return () => clearTimeout(animationTimeout);
  }, [loading, words.length, viewMode]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-5 pb-16 shadow flex flex-col h-screen">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">
            IIJA Funding Per Capita (March 2023 Snapshot)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Program-specific snapshot; per-capita uses 2023 population, colored by 2020 presidential winner
          </p>
        </div>
        <div className="mb-4">
          <div className="text-sm text-gray-600">{status}</div>
        </div>
        <div className="relative flex-1 pb-4">
          <canvas ref={canvasRef} id="barIija" className="w-full h-full"></canvas>
          {!loading && (
            <div className="absolute top-1/3 right-4 md:right-8 w-72 md:w-80 h-auto z-10 bg-white rounded-lg p-4 shadow-md md:shadow-lg">
              <p className="text-sm leading-relaxed text-gray-700 whitespace-normal break-normal">
                {words.slice(0, displayedWords).map((word, idx) => (
                  <span key={idx} className="inline animate-fadeIn">
                    {word}{' '}
                  </span>
                ))}
                {displayedWords < words.length && (
                  <span className="inline-block h-4 w-0.5 ml-1 bg-blue-500 animate-pulse"></span>
                )}
              </p>
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
            </div>
          )}
          <Link
            href="/intro"
            className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
            aria-label="Go to intro page"
          >
            <span className="inline-block">‹</span>
          </Link>
          <Link
            href="/totals"
            className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
            aria-label="Go to spending totals chart"
          >
            <span className="inline-block">›</span>
          </Link>
          <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/65 px-4 py-1 text-xs text-gray-600 shadow-md backdrop-blur scale-75 origin-bottom">
            <span className="font-semibold text-gray-900">2 / 8</span>
            <div className="flex items-center gap-2">
              <Link href="/intro" aria-label="Go to page 1">
                <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
              </Link>
              <Link href="/iija" aria-label="Go to page 2">
                <span className="block h-2 w-2 rounded-full bg-gray-900"></span>
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
                <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
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
      </div>
    </main>
  );
}
