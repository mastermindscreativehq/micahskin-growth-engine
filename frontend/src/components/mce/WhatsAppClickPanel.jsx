// WhatsAppClickPanel.jsx — Phase 34 (MCE)
// Surfaces WhatsApp deep-link click rate and per-funnel click breakdown.

const FUNNEL_TINTS = {
  product:  'bg-teal-100 text-teal-700',
  consult:  'bg-violet-100 text-violet-700',
  academy:  'bg-indigo-100 text-indigo-700',
  reseller: 'bg-amber-100 text-amber-700',
  unknown:  'bg-gray-100 text-gray-700',
}

export default function WhatsAppClickPanel({ data }) {
  const totalClicks   = data?.totalClicks ?? 0
  const uniqueClicked = data?.uniqueLeadsClicked ?? 0
  const clicksLast24h = data?.clicksLast24h ?? 0
  const ctaGenerated  = data?.ctaGenerated ?? 0
  const clickRatePct  = data?.clickRatePct ?? 0
  const byFunnel      = data?.byFunnel || { product: 0, consult: 0, academy: 0, reseller: 0 }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 border-b pb-2 mb-4 border-green-200 text-green-700">
        <h2 className="text-xs font-bold uppercase tracking-wider">
          MCE — WhatsApp Click Rate
        </h2>
        {data?.error && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">
            ⚠ partial data
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
          <div className="text-base font-bold tabular-nums text-green-700">{totalClicks.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Total clicks</div>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="text-base font-bold tabular-nums text-emerald-700">{uniqueClicked.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Unique leads clicked</div>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-base font-bold tabular-nums text-amber-700">{clicksLast24h.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Clicks · last 24h</div>
        </div>
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div className="text-base font-bold tabular-nums text-indigo-700">{clickRatePct}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Click rate</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{ctaGenerated.toLocaleString()} CTAs generated</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-2">By funnel</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(byFunnel).map(([funnel, count]) => (
            <div key={funnel} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold capitalize ${FUNNEL_TINTS[funnel] || FUNNEL_TINTS.unknown}`}>
                {funnel}
              </span>
              <span className="text-sm font-bold tabular-nums text-gray-700">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
