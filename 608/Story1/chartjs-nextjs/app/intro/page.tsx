'use client';

import Link from 'next/link';

export default function IntroPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-8 shadow flex flex-col h-screen">
        <div className="flex-1 flex flex-col justify-center">
          <div className="max-w-3xl">
            <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 leading-tight">
              Did Spending Under Biden reflect voting patterns either in Presidential or House Races,
              and is there a correlation between that spending and the results in 2024?
            </h1>
            <p className="mt-6 text-base md:text-lg text-gray-700 leading-relaxed">
              We compare federal obligations per capita across states, using a Biden-era average
              (FY2021–FY2024) versus a pre-Biden baseline (FY2017–FY2020), and test how those changes
              align with 2024 presidential and House margins. The following slides walk through totals,
              per-capita changes, and scatter analyses.
            </p>
            <div className="mt-8 text-sm text-gray-500">
              Data sources include USAspending.gov, Census population estimates, and 2024 election results.
            </div>
          </div>
        </div>

        <Link
          href="/"
          className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 text-base transition duration-150 ease-out hover:text-gray-900 hover:scale-125"
          aria-label="Go to spending totals chart"
        >
          <span className="inline-block">›</span>
        </Link>
        <div
          className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 text-gray-400 opacity-25 text-base select-none"
          aria-hidden="true"
        >
          ‹
        </div>

        <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-gray-200 bg-white/65 px-4 py-1 text-xs text-gray-600 shadow-md backdrop-blur scale-75 origin-bottom">
          <span className="font-semibold text-gray-900">1 / 7</span>
          <div className="flex items-center gap-2">
            <Link href="/intro" aria-label="Go to page 1">
              <span className="block h-2 w-2 rounded-full bg-gray-900"></span>
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
              <span className="block h-2 w-2 rounded-full bg-gray-300 hover:bg-gray-400"></span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
