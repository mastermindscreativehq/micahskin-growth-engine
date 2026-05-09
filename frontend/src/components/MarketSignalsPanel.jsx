import React, { useState, useEffect, useCallback } from 'react'
import {
  fetchMarketInsights, fetchMarketHeatmap, fetchMarketTimeline,
  fetchMarketStats, ingestMarketSignal, analyzePendingSignals,
} from '../api'

// ── Source config ─────────────────────────────────────────────────────────────

const SOURCES = [
  { id: 'tiktok_comment',     label: 'TikTok Comment',     color: 'bg-pink-500',    pill: 'bg-pink-50 text-pink-700 ring-pink-200' },
  { id: 'instagram_comment',  label: 'Instagram Comment',  color: 'bg-purple-500',  pill: 'bg-purple-50 text-purple-700 ring-purple-200' },
  { id: 'reddit',             label: 'Reddit',             color: 'bg-orange-500',  pill: 'bg-orange-50 text-orange-700 ring-orange-200' },
  { id: 'whatsapp_reply',     label: 'WhatsApp Reply',     color: 'bg-green-500',   pill: 'bg-green-50 text-green-700 ring-green-200' },
  { id: 'telegram_academy',   label: 'Telegram Academy',   color: 'bg-blue-500',    pill: 'bg-blue-50 text-blue-700 ring-blue-200' },
  { id: 'crm_conversation',   label: 'CRM Conversation',   color: 'bg-indigo-500',  pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  { id: 'manual',             label: 'Manual Entry',       color: 'bg-gray-500',    pill: 'bg-gray-50 text-gray-700 ring-gray-200' },
]

const SOURCE_MAP = Object.fromEntries(SOURCES.map(s => [s.id, s]))

const SIGNAL_TYPE_CONFIG = {
  pain_point:         { label: 'Pain Point',       color: 'text-rose-600',    bg: 'bg-rose-50 ring-rose-200',     bar: 'bg-rose-500' },
  emotional_language: { label: 'Emotional',         color: 'text-purple-600',  bg: 'bg-purple-50 ring-purple-200', bar: 'bg-purple-500' },
  frustration:        { label: 'Frustration',       color: 'text-orange-600',  bg: 'bg-orange-50 ring-orange-200', bar: 'bg-orange-500' },
  objection:          { label: 'Objection',         color: 'text-red-600',     bg: 'bg-red-50 ring-red-200',       bar: 'bg-red-500' },
  desire:             { label: 'Desire',            color: 'text-emerald-600', bg: 'bg-emerald-50 ring-emerald-200', bar: 'bg-emerald-500' },
  urgency:            { label: 'Urgency',           color: 'text-amber-600',   bg: 'bg-amber-50 ring-amber-200',   bar: 'bg-amber-500' },
  trust_issue:        { label: 'Trust Issue',       color: 'text-yellow-600',  bg: 'bg-yellow-50 ring-yellow-200', bar: 'bg-yellow-500' },
  slang:              { label: 'Slang',             color: 'text-cyan-600',    bg: 'bg-cyan-50 ring-cyan-200',     bar: 'bg-cyan-500' },
  question:           { label: 'Question',          color: 'text-indigo-600',  bg: 'bg-indigo-50 ring-indigo-200', bar: 'bg-indigo-500' },
}

const NICHE_LABELS = {
  acne: 'Acne', hyperpigmentation: 'Hyperpigmentation', dark_spots: 'Dark Spots',
  oily_skin: 'Oily Skin', stretch_marks: 'Stretch Marks', uneven_tone: 'Uneven Tone',
  dry_skin: 'Dry Skin', sensitive: 'Sensitive', knuckle_darkening: 'Knuckles',
  academy: 'Academy', general: 'General',
}

const SEGMENT_CONFIG = {
  consumer:       { label: 'Consumer',       color: 'bg-rose-500' },
  entrepreneur:   { label: 'Entrepreneur',   color: 'bg-indigo-500' },
  brand_builder:  { label: 'Brand Builder',  color: 'bg-amber-500' },
  unknown:        { label: 'Unknown',        color: 'bg-gray-400' },
}

// ── Utility ───────────────────────────────────────────────────────────────────

function fmtTime(d) {
  const date = new Date(d)
  const now  = new Date()
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

function intensityColor(v) {
  if (v >= 80) return 'text-rose-600 bg-rose-50 ring-rose-200'
  if (v >= 60) return 'text-orange-600 bg-orange-50 ring-orange-200'
  if (v >= 40) return 'text-amber-600 bg-amber-50 ring-amber-200'
  return 'text-gray-500 bg-gray-50 ring-gray-200'
}

function conversionColor(v) {
  if (v >= 80) return 'text-emerald-600 bg-emerald-50 ring-emerald-200'
  if (v >= 60) return 'text-blue-600 bg-blue-50 ring-blue-200'
  if (v >= 40) return 'text-indigo-600 bg-indigo-50 ring-indigo-200'
  return 'text-gray-500 bg-gray-50 ring-gray-200'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${className}`}>
      {children}
    </span>
  )
}

function StatCard({ label, value, sub, dark }) {
  return (
    <div className={`rounded-xl p-4 border ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <p className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{value ?? '—'}</p>
      <p className={`text-xs font-semibold mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

function PhraseRow({ phrase, rank, dark }) {
  const typeConfig = SIGNAL_TYPE_CONFIG[phrase.signalType] || SIGNAL_TYPE_CONFIG.pain_point
  const maxFreq = 20
  const barWidth = Math.min(100, (phrase.frequency / maxFreq) * 100)

  return (
    <div className={`border rounded-xl p-3.5 transition-all group ${
      dark ? 'border-gray-700 bg-gray-800/60 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-300'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
          dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
        }`}>
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug mb-2 ${dark ? 'text-gray-100' : 'text-gray-800'}`}>
            "{phrase.phrase}"
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Pill className={`ring-1 ${dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : `${typeConfig.bg} ${typeConfig.color}`}`}>
              {typeConfig.label}
            </Pill>
            <Pill className={dark ? 'bg-gray-700 text-gray-500 ring-gray-600' : 'bg-gray-50 text-gray-400 ring-gray-200'}>
              {NICHE_LABELS[phrase.nicheCategory] || phrase.nicheCategory}
            </Pill>
          </div>
          <div className={`h-1 rounded-full ${dark ? 'bg-gray-700' : 'bg-gray-100'} overflow-hidden`}>
            <div
              className={`h-1 rounded-full transition-all ${typeConfig.bar}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <div className={`text-center px-2 py-1 rounded-lg ${dark ? 'bg-gray-700' : 'bg-gray-50'}`}>
            <p className={`text-sm font-bold ${dark ? 'text-gray-200' : 'text-gray-700'}`}>{phrase.frequency}×</p>
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md ring-1 font-medium ${
            dark
              ? intensityColor(phrase.avgEmotionalIntensity).replace('bg-', 'bg-opacity-20 bg-').replace('text-', 'text-opacity-80 text-')
              : intensityColor(phrase.avgEmotionalIntensity)
          }`}>
            E{Math.round(phrase.avgEmotionalIntensity)}
          </span>
        </div>
      </div>
    </div>
  )
}

function TimelineSignal({ signal, dark }) {
  const sourceConfig = SOURCE_MAP[signal.source] || SOURCE_MAP.manual
  const summary = signal.aiSummary || signal.rawText?.substring(0, 100) || ''

  const allPhrases = [
    ...(signal.painPoints       || []).slice(0, 2),
    ...(signal.emotionalLanguage || []).slice(0, 1),
  ]

  return (
    <div className={`border rounded-xl p-4 transition-all ${
      dark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${sourceConfig.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <Pill className={dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : `ring-1 ${sourceConfig.pill}`}>
              {sourceConfig.label}
            </Pill>
            <span className={`text-[10px] ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
              {fmtTime(signal.createdAt)}
            </span>
          </div>
          {signal.aiSummary ? (
            <p className={`text-xs leading-relaxed mb-2 ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{summary}</p>
          ) : (
            <p className={`text-xs leading-relaxed mb-2 line-clamp-2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
              {signal.rawText?.substring(0, 120)}…
            </p>
          )}
          {allPhrases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allPhrases.map((phrase, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                  dark ? 'bg-gray-700 text-gray-500' : 'bg-gray-50 text-gray-400'
                }`}>
                  "{phrase.length > 40 ? phrase.substring(0, 40) + '…' : phrase}"
                </span>
              ))}
            </div>
          )}
        </div>
        {signal.emotionalIntensity > 0 && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            <div className={`text-center px-2 py-1 rounded-lg ${dark ? 'bg-gray-700' : 'bg-gray-50'}`}>
              <p className={`text-xs font-bold ${dark ? 'text-rose-400' : 'text-rose-600'}`}>{signal.emotionalIntensity}</p>
              <p className={`text-[9px] ${dark ? 'text-gray-600' : 'text-gray-400'}`}>Emotion</p>
            </div>
            {signal.conversionPotential > 0 && (
              <div className={`text-center px-2 py-1 rounded-lg ${dark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <p className={`text-xs font-bold ${dark ? 'text-emerald-400' : 'text-emerald-600'}`}>{signal.conversionPotential}</p>
                <p className={`text-[9px] ${dark ? 'text-gray-600' : 'text-gray-400'}`}>Convert</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Audience Heatmap ──────────────────────────────────────────────────────────

function AudienceHeatmap({ heatmap, dark }) {
  if (!heatmap || heatmap.length === 0) {
    return (
      <div className={`rounded-xl border p-6 text-center ${dark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'}`}>
        <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-400'}`}>No heatmap data yet. Analyze some signals first.</p>
      </div>
    )
  }

  const segments  = [...new Set(heatmap.map(r => r.segment))]
  const niches    = [...new Set(heatmap.map(r => r.niche))]
  const maxCount  = Math.max(...heatmap.map(r => r.count), 1)

  function getCell(segment, niche) {
    return heatmap.find(r => r.segment === segment && r.niche === niche)
  }

  function cellIntensity(count) {
    const pct = count / maxCount
    if (pct >= 0.75) return dark ? 'bg-rose-900/60 text-rose-300' : 'bg-rose-100 text-rose-800'
    if (pct >= 0.50) return dark ? 'bg-orange-900/50 text-orange-300' : 'bg-orange-50 text-orange-700'
    if (pct >= 0.25) return dark ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700'
    return dark ? 'bg-gray-700 text-gray-500' : 'bg-gray-50 text-gray-400'
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
      <div className={`overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={dark ? 'bg-gray-800' : 'bg-gray-50'}>
              <th className={`px-3 py-2.5 text-left font-semibold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Segment ↓ / Niche →</th>
              {niches.map(n => (
                <th key={n} className={`px-3 py-2.5 text-center font-semibold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {NICHE_LABELS[n] || n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map(segment => (
              <tr key={segment} className={`border-t ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
                <td className={`px-3 py-2 font-medium ${dark ? 'text-gray-300 bg-gray-800' : 'text-gray-700 bg-gray-50'}`}>
                  {SEGMENT_CONFIG[segment]?.label || segment}
                </td>
                {niches.map(niche => {
                  const cell = getCell(segment, niche)
                  return (
                    <td key={niche} className="px-3 py-2 text-center">
                      {cell ? (
                        <div className={`inline-flex flex-col items-center px-2 py-1 rounded-lg ${cellIntensity(cell.count)}`}>
                          <span className="font-bold">{cell.count}</span>
                          {cell.avgConversion > 0 && (
                            <span className="text-[9px] opacity-70">cvt {cell.avgConversion}</span>
                          )}
                        </div>
                      ) : (
                        <span className={dark ? 'text-gray-700' : 'text-gray-300'}>—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarketSignalsPanel({ dark = false }) {
  const [insightTab, setInsightTab] = useState('trends')
  const [insights,   setInsights]   = useState(null)
  const [heatmap,    setHeatmap]    = useState([])
  const [timeline,   setTimeline]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [analyzing,  setAnalyzing]  = useState(false)
  const [ingesting,  setIngesting]  = useState(false)
  const [error,      setError]      = useState(null)
  const [notice,     setNotice]     = useState(null)

  // Ingest form
  const [ingestForm, setIngestForm] = useState({
    rawText: '', source: 'tiktok_comment', sourceUrl: '', author: '', analyzeNow: true,
  })

  const showNotice = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3000)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [insRes, hmRes, tlRes] = await Promise.all([
        fetchMarketInsights(),
        fetchMarketHeatmap(),
        fetchMarketTimeline(96),
      ])
      setInsights(insRes.data)
      setHeatmap(hmRes.data || [])
      setTimeline(tlRes.data || [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load market signals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleIngest = async () => {
    if (!ingestForm.rawText.trim()) return
    setIngesting(true)
    try {
      await ingestMarketSignal({
        rawText: ingestForm.rawText,
        source: ingestForm.source,
        sourceUrl: ingestForm.sourceUrl || null,
        author: ingestForm.author || null,
        analyzeNow: ingestForm.analyzeNow,
      })
      setIngestForm(f => ({ ...f, rawText: '', sourceUrl: '', author: '' }))
      showNotice(ingestForm.analyzeNow ? 'Signal ingested and analyzed.' : 'Signal queued for analysis.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Ingest failed')
    }
    setIngesting(false)
  }

  const handleAnalyzePending = async () => {
    setAnalyzing(true)
    try {
      const res = await analyzePendingSignals(10)
      const success = (res.data || []).filter(r => r.success).length
      showNotice(`Analyzed ${success} signal${success !== 1 ? 's' : ''}.`)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Analysis failed')
    }
    setAnalyzing(false)
  }

  // ── Theme ─────────────────────────────────────────────────────────────────────

  const bg    = dark ? 'bg-gray-950' : 'bg-gray-50'
  const card  = dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const text  = dark ? 'text-gray-100' : 'text-gray-900'
  const sub   = dark ? 'text-gray-500' : 'text-gray-400'
  const input = dark
    ? 'bg-gray-800 border-gray-700 text-gray-200 placeholder-gray-600 focus:border-gray-500'
    : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400 focus:border-gray-400'

  const stats = insights?.stats

  const INSIGHT_TABS = [
    { id: 'trends',    label: 'Emotional Trends' },
    { id: 'pain',      label: 'Pain Points' },
    { id: 'objections', label: 'Objections' },
    { id: 'converting', label: 'Converting' },
    { id: 'questions', label: 'Questions' },
    { id: 'desires',   label: 'Desires' },
  ]

  function getInsightPhrases() {
    if (!insights) return []
    const map = {
      trends:     insights.emotionalTrends || [],
      pain:       insights.topPainPoints   || [],
      objections: insights.objections      || [],
      converting: insights.topConverting   || [],
      questions:  insights.questions       || [],
      desires:    insights.desires         || [],
    }
    return map[insightTab] || []
  }

  return (
    <div className={`h-full overflow-y-auto ${bg}`}>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-lg font-bold ${text}`}>Market Signals</h1>
            <p className={`text-xs mt-0.5 ${sub}`}>Real audience psychology — extracted and ranked from all channels</p>
          </div>
          <div className="flex items-center gap-2">
            {notice && (
              <span className="text-xs text-emerald-600 font-medium px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
                {notice}
              </span>
            )}
            {(stats?.pending || 0) > 0 && (
              <button
                onClick={handleAnalyzePending}
                disabled={analyzing}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                  dark
                    ? 'border-amber-700 bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
                    : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                {analyzing ? 'Analyzing…' : `⚡ Analyze ${stats.pending} pending`}
              </button>
            )}
            <button
              onClick={loadAll}
              disabled={loading}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                dark ? 'border-gray-700 text-gray-400 hover:border-gray-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Signals"   value={stats?.totalSignals}  dark={dark} />
          <StatCard label="Analyzed"        value={stats?.analyzed}      dark={dark} />
          <StatCard label="Pending"         value={stats?.pending}       sub={stats?.pending > 0 ? 'needs analysis' : undefined} dark={dark} />
          <StatCard label="Last 24h"        value={stats?.last24h}       dark={dark} />
          <StatCard label="Phrases Indexed" value={stats?.totalPhrases}  dark={dark} />
          <StatCard label="Failed"          value={stats?.failed}        dark={dark} />
        </div>

        {/* Source breakdown */}
        {stats?.bySource && Object.keys(stats.bySource).length > 0 && (
          <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${sub}`}>By Source</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.bySource).map(([src, count]) => {
                const cfg = SOURCE_MAP[src] || SOURCE_MAP.manual
                return (
                  <div key={src} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${cfg.color}`} />
                    <span className={`text-xs font-medium ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{cfg.label}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Ingest form */}
        <div className={`rounded-xl border p-5 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${sub}`}>Ingest Signal</p>
          <div className="space-y-3">
            <textarea
              value={ingestForm.rawText}
              onChange={e => setIngestForm(f => ({ ...f, rawText: e.target.value }))}
              placeholder="Paste a comment, WhatsApp reply, Reddit post, DM, or any audience text here…"
              rows={4}
              className={`w-full text-sm border rounded-xl px-4 py-3 resize-none focus:outline-none transition-all ${input}`}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`text-[10px] font-bold uppercase tracking-widest block mb-1 ${sub}`}>Source</label>
                <select
                  value={ingestForm.source}
                  onChange={e => setIngestForm(f => ({ ...f, source: e.target.value }))}
                  className={`w-full text-xs border rounded-lg px-3 py-2 focus:outline-none transition-all ${input}`}
                >
                  {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-bold uppercase tracking-widest block mb-1 ${sub}`}>Author (optional)</label>
                <input
                  type="text"
                  value={ingestForm.author}
                  onChange={e => setIngestForm(f => ({ ...f, author: e.target.value }))}
                  placeholder="@username"
                  className={`w-full text-xs border rounded-lg px-3 py-2 focus:outline-none transition-all ${input}`}
                />
              </div>
            </div>
            <div>
              <label className={`text-[10px] font-bold uppercase tracking-widest block mb-1 ${sub}`}>Source URL (optional)</label>
              <input
                type="text"
                value={ingestForm.sourceUrl}
                onChange={e => setIngestForm(f => ({ ...f, sourceUrl: e.target.value }))}
                placeholder="https://tiktok.com/..."
                className={`w-full text-xs border rounded-lg px-3 py-2 focus:outline-none transition-all ${input}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ingestForm.analyzeNow}
                  onChange={e => setIngestForm(f => ({ ...f, analyzeNow: e.target.checked }))}
                  className="rounded"
                />
                <span className={`text-xs font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                  Analyze immediately (uses AI credits)
                </span>
              </label>
              <button
                onClick={handleIngest}
                disabled={ingesting || !ingestForm.rawText.trim()}
                className="px-4 py-2 text-xs font-bold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {ingesting ? 'Ingesting…' : ingestForm.analyzeNow ? '⚡ Ingest & Analyze' : '+ Queue Signal'}
              </button>
            </div>
          </div>
        </div>

        {/* Insights panel */}
        <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          {/* Tab bar */}
          <div className={`flex border-b overflow-x-auto ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-100 bg-gray-50'}`}>
            {INSIGHT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setInsightTab(t.id)}
                className={`flex-shrink-0 px-4 py-3 text-xs font-semibold transition-colors border-b-2 ${
                  insightTab === t.id
                    ? dark
                      ? 'border-white text-white bg-gray-800'
                      : 'border-gray-900 text-gray-900 bg-white'
                    : dark
                      ? 'border-transparent text-gray-500 hover:text-gray-300'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-5">
            {loading ? (
              <div className="text-center py-8">
                <p className={`text-sm ${sub}`}>Loading signals…</p>
              </div>
            ) : getInsightPhrases().length === 0 ? (
              <div className="text-center py-8">
                <p className={`text-sm ${sub}`}>
                  No signals yet. Ingest and analyze some audience text to see intelligence here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {getInsightPhrases().map((phrase, i) => (
                  <PhraseRow key={phrase.id || i} phrase={phrase} rank={i + 1} dark={dark} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Audience heatmap */}
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${sub}`}>Audience Heatmap — Segment × Niche</p>
          <AudienceHeatmap heatmap={heatmap} dark={dark} />
        </div>

        {/* Signal timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className={`text-[10px] font-bold uppercase tracking-widest ${sub}`}>Signal Timeline — Last 96h</p>
            <span className={`text-xs ${sub}`}>{timeline.length} signals</span>
          </div>
          {timeline.length === 0 ? (
            <div className={`rounded-xl border p-6 text-center ${dark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'}`}>
              <p className={`text-sm ${sub}`}>No analyzed signals yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {timeline.map(signal => (
                <TimelineSignal key={signal.id} signal={signal} dark={dark} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
