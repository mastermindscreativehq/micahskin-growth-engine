// TopObjectionsPanel.jsx — Phase 34 (MCE)
// Shows top objections detected in inbound replies, with funnel breakdown.

const OBJECTION_LABELS = {
  pricing:    { label: 'Pricing',    color: 'bg-rose-100 text-rose-700' },
  trust:      { label: 'Trust',      color: 'bg-orange-100 text-orange-700' },
  timing:     { label: 'Timing',     color: 'bg-amber-100 text-amber-700' },
  skepticism: { label: 'Skepticism', color: 'bg-yellow-100 text-yellow-700' },
  unknown:    { label: 'Other',      color: 'bg-gray-100 text-gray-700' },
}

const FUNNEL_DOTS = {
  product:  'bg-teal-400',
  consult:  'bg-violet-400',
  academy:  'bg-indigo-400',
  reseller: 'bg-amber-400',
  unknown:  'bg-gray-300',
}

export default function TopObjectionsPanel({ data }) {
  const summary = data?.summary || []
  const days    = data?.days ?? 30
  const total   = data?.totalObjections ?? 0
  const max     = Math.max(...summary.map(s => s.count || 0), 1)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 border-b pb-2 mb-4 border-rose-200 text-rose-700">
        <h2 className="text-xs font-bold uppercase tracking-wider">
          MCE — Top Objections (last {days}d)
        </h2>
        {data?.error && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">
            ⚠ partial data
          </span>
        )}
      </div>

      <div className="mb-3 text-[11px] text-gray-500">
        {total.toLocaleString()} objection events detected
      </div>

      {summary.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">No objections recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {summary.map(row => {
            const meta = OBJECTION_LABELS[row.type] || OBJECTION_LABELS.unknown
            const pct = Math.round((row.count / max) * 100)
            return (
              <div key={row.type} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-gray-500 flex-1">{row.count} occurrences</span>
                </div>
                <div className="h-1.5 rounded bg-gray-200 overflow-hidden">
                  <div className="h-full bg-rose-400" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                  {Object.entries(row.byFunnel || {}).filter(([, n]) => n > 0).map(([f, n]) => (
                    <span key={f} className="inline-flex items-center gap-1 rounded bg-white border border-gray-100 px-1.5 py-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${FUNNEL_DOTS[f] || FUNNEL_DOTS.unknown}`} />
                      <span className="capitalize text-gray-600">{f}</span>
                      <span className="tabular-nums text-gray-700 font-semibold">{n}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
