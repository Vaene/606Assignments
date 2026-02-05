'use client';

import Link from 'next/link';

const sources = [
  {
    title: 'USAspending Obligations by State (FY2017–FY2024)',
    local: 'Live API (no local file)',
    localHref: null,
    sourceLinks: [
      {
        label: 'USAspending API',
        href: 'https://api.usaspending.gov/api/v2/search/spending_by_geography/'
      }
    ],
    processing:
      'API results are normalized to state abbreviations and combined with Census population to compute per-capita obligations and multi-year averages.'
  },
  {
    title: 'Census Population Estimates (2010s Series)',
    local: 'NST-EST2019-ALLDATA.csv',
    localHref: '/data/NST-EST2019-ALLDATA.csv',
    sourceLinks: [
      {
        label: 'Census source',
        href:
          'https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/national/totals/nst-est2019-alldata.csv'
      }
    ],
    processing:
      'Filtered to SUMLEV 40 (states + DC), then reshaped to long format for 2017–2019 and mapped to state abbreviations.'
  },
  {
    title: 'Census Population Estimates (2020s Series)',
    local: 'NST-EST2024-ALLDATA.csv',
    localHref: '/data/NST-EST2024-ALLDATA.csv',
    sourceLinks: [
      {
        label: 'Census source',
        href:
          'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/state/totals/NST-EST2024-ALLDATA.csv'
      }
    ],
    processing:
      'Filtered to SUMLEV 40 (states + DC), then reshaped to long format for 2020–2024 and mapped to state abbreviations.'
  },
  {
    title: 'Combined Population by State and Fiscal Year',
    local: 'population_by_state_fy.csv',
    localHref: '/data/population_by_state_fy.csv',
    sourceLinks: [
      { label: '2010s Census file', href: '/data/NST-EST2019-ALLDATA.csv' },
      { label: '2020s Census file', href: '/data/NST-EST2024-ALLDATA.csv' }
    ],
    processing:
      'Union of 2017–2024 state populations with standardized columns (state, fiscal_year, pop) used for per-capita metrics.'
  },
  {
    title: '2024 Presidential Results (State Level)',
    local: '2024-electoral-states.csv',
    localHref: '/data/2024-electoral-states.csv',
    sourceLinks: [
      { label: 'Original source', href: 'https://michaelminn.net/tutorials/data/2024-electoral-states.csv' }
    ],
    processing:
      'Converted to Democratic margin: (Dem votes − GOP votes) / (Dem + GOP).'
  },
  {
    title: '2024 House Results (District Level)',
    local: '2024-electoral-districts.csv',
    localHref: '/data/2024-electoral-districts.csv',
    sourceLinks: [
      {
        label: 'Original source',
        href: 'https://michaelminn.net/tutorials/data/2024-electoral-districts.csv'
      }
    ],
    processing:
      'Aggregated by state to compute a statewide House margin using total Dem and GOP votes.'
  },
  {
    title: '2020 Presidential Results (State Winner)',
    local: 'president_2020.csv',
    localHref: '/data/president_2020.csv',
    sourceLinks: [
      { label: 'Local file used', href: '/data/president_2020.csv' }
    ],
    processing:
      'Filtered to 2020 and the two major candidates, then assigned a state winner based on total votes.'
  },
  {
    title: 'Derived Files Used in the Presentation',
    local: 'winner_2020.json',
    localHref: '/data/winner_2020.json',
    sourceLinks: [
      { label: 'Derived from', href: '/data/president_2020.csv' }
    ],
    processing:
      'Helper file for 2020 winner coloring in charts.'
  },
  {
    title: 'State List Used in the Presentation',
    local: 'states_50.json',
    localHref: '/data/states_50.json',
    sourceLinks: [
      { label: 'Local list', href: '/data/states_50.json' }
    ],
    processing:
      'State abbreviations (50 states + DC) used for consistent ordering and joins.'
  }
];

export default function SourcesPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 pb-16 shadow flex flex-col h-screen">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Summary and Sources</h1>
        </div>

        <div className="mt-2 text-sm font-semibold text-gray-900">Summary</div>
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700">
          Spending increases in the Biden era are broad-based across states, but the scatter plots show only
          moderate positive associations with 2024 presidential and House margins. The relationship is real
          but not deterministic: states with similar spending changes often voted differently, and outliers
          remain. In short, spending shifts alone do not explain 2024 election outcomes, though they move in
          the same direction on average.
        </div>

        <div className="mt-6 text-sm font-semibold text-gray-900">Sources</div>
        <div className="mt-3 flex-1 overflow-auto pr-1">
          <div className="grid grid-cols-1 gap-4">
            {sources.map((s) => (
              <div key={s.title} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-900">{s.title}</div>
                <div className="mt-2 text-sm text-gray-700">
                  <span className="font-medium text-gray-800">Local:</span>{' '}
                  {s.localHref ? (
                    <a className="text-blue-700 underline" href={s.localHref} download>
                      {s.local}
                    </a>
                  ) : (
                    s.local
                  )}
                </div>
                {s.sourceLinks && s.sourceLinks.length > 0 && (
                  <div className="mt-1 text-sm text-gray-700">
                    <span className="font-medium text-gray-800">Source:</span>{' '}
                    {s.sourceLinks.map((link, idx) => (
                      <span key={`${s.title}-src-${idx}`}>
                        <a
                          className="text-blue-700 underline"
                          href={link.href}
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                          rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                        >
                          {link.label}
                        </a>
                        {idx < s.sourceLinks.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-sm text-gray-700">{s.processing}</div>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/delta-biden"
          className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to delta bar chart"
        >
          <span className="inline-block">‹</span>
        </Link>
        <div
          className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 opacity-25 text-base select-none"
          aria-hidden="true"
        >
          ›
        </div>

        <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/65 px-4 py-1 text-xs text-gray-600 shadow-md backdrop-blur scale-75 origin-bottom">
          <span className="font-semibold text-gray-900">7 / 7</span>
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
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
            <Link href="/sources" aria-label="Go to page 7">
              <span className="block h-2 w-2 rounded-full bg-gray-900"></span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
