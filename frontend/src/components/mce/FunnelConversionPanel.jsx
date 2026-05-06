// FunnelConversionPanel.jsx — Phase 34 (MCE)
// Renders per-funnel conversion stats inside the operator command center.
// Read-only; reads from data.mce.funnel which the backend already aggregates.

function fmtNgn(amount) {
  if (!amount || amount === 0) return '₦0'
  return `₦${Number(amount).toLocaleString('en-NG')}`
}

const FUNNEL_LABELS = {
  product:  { label: 'Product',  color: 'bg-teal-50 border-teal-200 text-teal-700'   },
  consult:  { label: 'Consult',  color: 'bg-violet-50 border-violet-200 text-violet-700' },
  academy:  { label: 'Academy',  color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  reseller: { label: 'Reseller', color: 'bg-amber-50 border-amber-200 text-amber-700' },
}

export default function FunnelConversionPanel({ data }) {
  const summary = data?.summary || []
  const totalRevenue = data?.totalRevenue || 0
  const sortedSummary = [...summary].sort((a, b) => (b.revenueNgn || 0) - (a.revenueNgn || 0))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 border-b pb-2 mb-4 border-emerald-200 text-emerald-700">
        <h2 className="text-xs font-bold uppercase tracking-wider">
          MCE — Funnel Conversion Stats
        </h2>
        {data?.error && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">
            ⚠ partial data
          </span>
        )}
      </div>

      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-[11px] text-gray-500">Total Revenue (all funnels)</div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">{fmtNgn(totalRevenue)}</div>
        </div>
        <div className="text-[11px] text-gray-400">
          {sortedSummary.reduce((s, r) => s + (r.leadCount || 0), 0).toLocaleString()} leads ·{' '}
          {sortedSummary.reduce((s, r) => s + (r.conversions || 0), 0).toLocaleString()} converted
        </div>
      </div>

      {sortedSummary.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">No funnel data yet — leads need a routing pass first.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sortedSummary.map(row => {
            const meta = FUNNEL_LABELS[row.funnelType] || { label: row.funnelType, color: 'bg-gray-50 border-gray-200 text-gray-700' }
            return (
              <div key={row.funnelType} className={`rounded-lg border px-4 py-3 ${meta.color}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{meta.label}</span>
                  <span className="text-[10px] tabular-nums opacity-70">{row.leadCount} leads</span>
                </div>
                <div className="text-base font-bold tabular-nums">{fmtNgn(row.revenueNgn)}</div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="opacity-70">{row.conversions} converted</span>
                  <span className="font-semibold tabular-nums">{row.conversionRatePct}%</span>
                </div>
                <div className="mt-1.5 h-1 rounded bg-white/50 overflow-hidden">
                  <div
                    className="h-full bg-current opacity-50"
                    style={{ width: `${Math.min(100, row.conversionRatePct)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
