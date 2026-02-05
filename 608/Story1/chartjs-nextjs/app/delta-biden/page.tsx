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
import type { Context as DataLabelContext } from 'chartjs-plugin-datalabels';

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

interface DeltaData {
  stateOrder: string[];
  deltaByState: Map<string, number>;
  winnerMap: Record<string, string>;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim();
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
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

async function getStateObligations(fy: number): Promise<Map<string, number>> {
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
  return map;
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

type ChartWithAnim = ChartJS & { $_animStart?: number; $_completedFlatIndex?: number };

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

export default function DeltaBidenPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const [status, setStatus] = useState('Loading USAspending data…');
  const [loading, setLoading] = useState(true);
  const [displayedWords, setDisplayedWords] = useState(0);

  const chartDescription =
    'This chart shows the change in federal obligations per capita between the Biden era (mean FY2021–FY2024) and the pre-Biden baseline (mean FY2017–FY2020). In this timeframe, all states show positive changes, with a few states driving the largest gains. Colors reflect the 2020 presidential winner in each state.';
  const words = chartDescription.split(' ');

  useEffect(() => {
    async function main() {
      try {
        setStatus('Loading population data…');
        const popText = await loadText('/data/population_by_state_fy.csv');
        const popMap = parsePopulationCSV(popText);

        setStatus('Loading winner map…');
        const [states, winnerMap] = await Promise.all([
          loadJSON('/data/states_50.json'),
          loadJSON('/data/winner_2020.json')
        ]);

        const preYears = [2017, 2018, 2019, 2020];
        const bidenYears = [2021, 2022, 2023, 2024];
        const allYears = [...preYears, ...bidenYears];

        const yearMaps: Record<number, Map<string, number>> = {};
        for (let i = 0; i < allYears.length; i++) {
          const fy = allYears[i];
          setStatus(`Fetching FY${fy} (${i + 1}/${allYears.length})…`);
          yearMaps[fy] = await getStateObligations(fy);
        }

        const deltaByState = new Map<string, number>();
        for (const st of states) {
          const preAvg =
            preYears.reduce((s, fy) => {
              const pop = popMap.get(`${st}-${fy}`) ?? 0;
              const amt = yearMaps[fy]?.get(st) ?? 0;
              return s + (pop > 0 ? amt / pop : 0);
            }, 0) / preYears.length;

          const bidenAvg =
            bidenYears.reduce((s, fy) => {
              const pop = popMap.get(`${st}-${fy}`) ?? 0;
              const amt = yearMaps[fy]?.get(st) ?? 0;
              return s + (pop > 0 ? amt / pop : 0);
            }, 0) / bidenYears.length;

          deltaByState.set(st, bidenAvg - preAvg);
        }

        const stateOrder = [...states]
          .sort((a, b) => (deltaByState.get(b) ?? 0) - (deltaByState.get(a) ?? 0));

        buildChart({ stateOrder, deltaByState, winnerMap });
        setStatus('');
        setLoading(false);
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    function buildChart({ stateOrder, deltaByState, winnerMap }: DeltaData) {
      if (!canvasRef.current) return;

      if (chartRef.current) {
        chartRef.current.destroy();
      }

      const labels = stateOrder;
      const delta = labels.map((st) => deltaByState.get(st) ?? 0);
      const colors = labels.map((st) =>
        hexToRgba(COLORS[(winnerMap[st] ?? 'Unknown') as keyof typeof COLORS] ?? COLORS.Unknown, 0.75)
      );

      const config: ChartConfiguration<'bar', number[], string> = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Δ per capita (Biden avg − Pre avg)',
              data: delta,
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
          indexAxis: 'y' as const,
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
                label: (c: TooltipItem<'bar'>) => `Δ per capita: ${formatDollars(c.raw as number)}`
              }
            },
            datalabels: {
              display: labelDisplay,
              anchor: 'end',
              align: (ctx: DataLabelContext) => {
                const v = Number(ctx.dataset.data[ctx.dataIndex] ?? 0);
                return v >= 0 ? 'right' : 'left';
              },
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
    }, estimatedChartAnimEnd);

    return () => clearTimeout(animationTimeout);
  }, [loading, words.length]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-5 pb-16 shadow flex flex-col h-screen">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">
            Change in Obligations Per Capita: Biden Era vs Pre-Biden Baseline
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Δ = mean(FY2021–FY2024) − mean(FY2017–FY2020), colored by 2020 presidential winner
          </p>
        </div>
        <div className="mb-3">
          <div className="text-sm text-gray-600">{status}</div>
        </div>
        <div className="relative flex-1 pb-4">
          <canvas ref={canvasRef} id="barDeltaBiden" className="w-full h-full"></canvas>
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
            </div>
          )}
        </div>

        <Link
          href="/scatter-house"
          className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to house margin scatter"
        >
          <span className="inline-block">‹</span>
        </Link>
        <Link
          href="/sources"
          className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to sources page"
        >
          <span className="inline-block">›</span>
        </Link>
        <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/65 px-4 py-1 text-xs text-gray-600 shadow-md backdrop-blur scale-75 origin-bottom">
          <span className="font-semibold text-gray-900">6 / 7</span>
          <div className="flex items-center gap-2">
            <Link href="/intro" aria-label="Go to page 1">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/" aria-label="Go to page 2">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/per-capita" aria-label="Go to page 3">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/scatter-pres" aria-label="Go to page 4">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/scatter-house" aria-label="Go to page 5">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/delta-biden" aria-label="Go to page 6">
              <span className="block h-2 w-2 rounded-full bg-gray-900"></span>
            </Link>
            <Link href="/sources" aria-label="Go to page 7">
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
