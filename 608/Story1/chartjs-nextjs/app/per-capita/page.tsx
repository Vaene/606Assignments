'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, TooltipItem } from 'chart.js';
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

interface SpendingData {
  stateOrder: string[];
  preByState: Map<string, number>;
  fy24ByState: Map<string, number>;
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
  return `$${Math.round(v).toLocaleString()}`;
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

const labelsAfterBars = {
  id: 'labelsAfterBars',
  beforeDatasetsDraw(chart: any) {
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

function labelDisplay(ctx: any) {
  const chart = ctx.chart;
  const flat = ctx.dataIndex * 2 + ctx.datasetIndex;
  const completed = chart.$_completedFlatIndex ?? -1;
  return flat <= completed;
}

function animationDelay(ctx: any) {
  if (ctx.type !== 'data') return 0;
  const flat = ctx.dataIndex * 2 + ctx.datasetIndex;
  return flat * ANIM.perBarStaggerMs;
}

export default function PerCapitaPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const [status, setStatus] = useState('Loading USAspending data…');
  const [loading, setLoading] = useState(true);
  const [displayedWords, setDisplayedWords] = useState(0);

  const chartDescription = 'This chart compares federal obligations per capita by state in FY2024 versus the pre-Biden baseline average from FY2017–FY2020. States are ordered by maximum per-capita spending, with each state showing two bars: the lighter bar represents the historical average per person, and the darker bars show FY2024 levels. Colors represent the 2020 presidential election winner in each state, highlighting how per-capita federal spending shifted across political contexts.';
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

        setStatus('Fetching USAspending baseline FY2017–FY2020…');
        const years = [2017, 2018, 2019, 2020];
        const maps = [] as Map<string, number>[];
        for (let i = 0; i < years.length; i++) {
          setStatus(`Fetching baseline FY${years[i]} (${i + 1}/4)…`);
          maps.push(await getStateObligations(years[i]));
        }

        setStatus('Fetching FY2024…');
        const fy24 = await getStateObligations(2024);

        const preByState = new Map();
        for (const st of states) {
          const vals = years.map((yr, idx) => {
            const pop = popMap.get(`${st}-${yr}`) ?? 0;
            const amt = maps[idx].get(st) ?? 0;
            return pop > 0 ? amt / pop : 0;
          });
          preByState.set(st, vals.reduce((s, v) => s + v, 0) / vals.length);
        }

        const fy24ByState = new Map();
        for (const st of states) {
          const pop = popMap.get(`${st}-2024`) ?? 0;
          const amt = fy24.get(st) ?? 0;
          fy24ByState.set(st, pop > 0 ? amt / pop : 0);
        }

        const stateOrder = [...states]
          .sort((a, b) => {
            const ma = Math.max(preByState.get(a) ?? 0, fy24ByState.get(a) ?? 0);
            const mb = Math.max(preByState.get(b) ?? 0, fy24ByState.get(b) ?? 0);
            return ma - mb;
          })
          .reverse();

        buildChart({ stateOrder, preByState, fy24ByState, winnerMap });
        setStatus('');
        setLoading(false);
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    function buildChart({ stateOrder, preByState, fy24ByState, winnerMap }: SpendingData) {
      if (!canvasRef.current) return;

      if (chartRef.current) {
        chartRef.current.destroy();
      }

      const labels = stateOrder;
      const pre = labels.map((st) => preByState.get(st) ?? 0);
      const fy24 = labels.map((st) => fy24ByState.get(st) ?? 0);

      const preColors = labels.map((st) =>
        hexToRgba(COLORS[(winnerMap[st] ?? 'Unknown') as keyof typeof COLORS] ?? COLORS.Unknown, 0.4)
      );
      const fy24Colors = labels.map((st) =>
        hexToRgba(COLORS[(winnerMap[st] ?? 'Unknown') as keyof typeof COLORS] ?? COLORS.Unknown, 0.7)
      );

      chartRef.current = new ChartJS(canvasRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'FY2017–FY2020 avg (per capita)',
              data: pre,
              backgroundColor: preColors,
              borderWidth: 0,
              barPercentage: 0.9,
              categoryPercentage: 0.82
            },
            {
              label: 'FY2024 (per capita)',
              data: fy24,
              backgroundColor: fy24Colors,
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
            easing: 'easeOutQuart' as any,
            delay: animationDelay
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: TooltipItem<'bar'>[]) => items?.[0]?.label ?? '',
                label: (c: TooltipItem<'bar'>) => `${c.dataset.label}: ${formatDollars(c.raw as number)}`
              }
            },
            datalabels: {
              display: labelDisplay,
              anchor: 'end' as any,
              align: 'right' as any,
              color: '#111',
              font: { size: 8, weight: '600' as any },
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
                font: { size: 8, weight: '700' as any },
                padding: 4
              }
            }
          }
        },
        plugins: [labelsAfterBars]
      } as any);
    }

    main();
  }, []);

  useEffect(() => {
    if (loading || !chartRef.current) return;

    const estimatedChartAnimEnd = ANIM.barDurationMs + 50 * ANIM.perBarStaggerMs + ANIM.labelLagMs + 300;

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
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 shadow flex flex-col h-screen">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Federal Obligations Per Capita by State: FY2024 vs Pre-Biden Baseline
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Per-capita mean(FY2017–FY2020) versus FY2024, colored by 2020 presidential winner
          </p>
        </div>
        <div className="mb-4">
          <div className="text-sm text-gray-600">{status}</div>
        </div>
        <div className="relative flex-1">
          <canvas ref={canvasRef} id="barPerCapita" className="w-full h-full"></canvas>
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
          <Link
            href="/"
            className="group fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-500 text-lg transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
            aria-label="Go to total obligations chart"
          >
            <span className="inline-block transition group-hover:scale-125">‹</span>
          </Link>
          <div
            className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 opacity-25 text-lg select-none"
            aria-hidden="true"
          >
            ›
          </div>
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/90 px-4 py-2 text-xs text-gray-600 shadow-md backdrop-blur">
            <span>1</span>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-gray-300"></span>
              <span className="h-2 w-2 rounded-full bg-gray-900"></span>
            </div>
            <span className="font-semibold text-gray-900">2</span>
          </div>
        </div>
      </div>
    </main>
  );
}
