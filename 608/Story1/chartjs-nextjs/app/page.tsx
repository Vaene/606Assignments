'use client';

import { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
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

function formatMoneyCompact(v: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

async function loadJSON(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const [status, setStatus] = useState('Loading USAspending data…');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function main() {
      try {
        setStatus('Loading winner map…');
        const [states, winnerMap] = await Promise.all([
          loadJSON('/data/states_50.json'),
          loadJSON('/data/winner_2020.json')
        ]);

        setStatus('Fetching USAspending baseline FY2017–FY2020…');
        const years = [2017, 2018, 2019, 2020];
        const maps = [];
        for (let i = 0; i < years.length; i++) {
          setStatus(`Fetching baseline FY${years[i]} (${i + 1}/4)…`);
          maps.push(await getStateObligations(years[i]));
        }

        setStatus('Fetching FY2024…');
        const fy24 = await getStateObligations(2024);

        const preByState = new Map();
        for (const st of states) {
          const vals = maps.map((m) => m.get(st) ?? 0);
          preByState.set(st, vals.reduce((s, v) => s + v, 0) / vals.length);
        }

        const fy24ByState = new Map();
        for (const st of states) {
          fy24ByState.set(st, fy24.get(st) ?? 0);
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
        hexToRgba(COLORS[winnerMap[st] ?? 'Unknown'] ?? COLORS.Unknown, 0.4)
      );
      const fy24Colors = labels.map((st) =>
        hexToRgba(COLORS[winnerMap[st] ?? 'Unknown'] ?? COLORS.Unknown, 0.7)
      );

      chartRef.current = new ChartJS(canvasRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'FY2017–FY2020 avg',
              data: pre,
              backgroundColor: preColors,
              borderWidth: 0,
              barPercentage: 0.9,
              categoryPercentage: 0.82
            },
            {
              label: 'FY2024',
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
          indexAxis: 'y' as const,
          layout: { padding: { left: 6, right: 12, top: 18, bottom: 6 } },
          animation: {
            duration: ANIM.barDurationMs,
            easing: 'easeOutQuart' as any,
            delay: animationDelay
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => items?.[0]?.label ?? '',
                label: (c) => `${c.dataset.label}: ${formatMoneyCompact(c.raw as number)}`
              }
            },
            datalabels: {
              display: labelDisplay,
              anchor: 'end' as any,
              align: 'right' as any,
              color: '#111',
              font: { size: 10, weight: '600' as any },
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
                color: '#111',
                font: { size: 11, weight: '700' as any },
                padding: 6
              }
            }
          }
        },
        plugins: [labelsAfterBars]
      } as any);
    }

    main();
  }, []);

  const downloadPNG = () => {
    if (!chartRef.current) return;
    const link = document.createElement('a');
    link.href = chartRef.current.canvas.toDataURL('image/png');
    link.download = `federal-obligations-${new Date().toISOString().split('T')[0]}.png`;
    link.click();
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">{status}</div>
          {!loading && (
            <button
              onClick={downloadPNG}
              className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            >
              Download PNG
            </button>
          )}
        </div>
        <div className="relative h-[1000px]">
          <canvas ref={canvasRef} id="barTotal"></canvas>
        </div>
      </div>
    </main>
  );
}
