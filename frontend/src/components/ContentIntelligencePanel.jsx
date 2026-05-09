import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchContentQueue, generateContentBatch, generateContentPiece,
  updateContentStatus, updateContentPerformance, saveContentHook,
  fetchHookLibrary, deactivateHook, fetchContentStats,
  fetchPainCategories, fetchPillars, fetchPlatforms,
  fetchContentStyles, fetchObjectives,
  fetchPainSignals, addPainSignal, deletePainSignal,
  fetchSignalTypes, fetchSignalSources,
  fetchGenerationSessions, markContentViewed,
} from '../api'
import MarketSignalsPanel from './MarketSignalsPanel'

// ── Meta maps ─────────────────────────────────────────────────────────────────

const PLATFORM_META = {
  tiktok:           { label: 'TikTok',          color: 'bg-pink-500',   pill: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200',     darkPill: 'bg-pink-900/40 text-pink-300 ring-1 ring-pink-700' },
  instagram_reel:   { label: 'Instagram',        color: 'bg-purple-500', pill: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200', darkPill: 'bg-purple-900/40 text-purple-300 ring-1 ring-purple-700' },
  facebook:         { label: 'Facebook',         color: 'bg-blue-500',   pill: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',     darkPill: 'bg-blue-900/40 text-blue-300 ring-1 ring-blue-700' },
  whatsapp_status:  { label: 'WhatsApp',         color: 'bg-green-500',  pill: 'bg-green-50 text-green-700 ring-1 ring-green-200',   darkPill: 'bg-green-900/40 text-green-300 ring-1 ring-green-700' },
}

const PILLAR_META = {
  pain_point:     { label: 'Pain Point',      pill: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',       darkPill: 'bg-rose-900/40 text-rose-300 ring-1 ring-rose-700' },
  academy:        { label: 'Academy',         pill: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',     darkPill: 'bg-amber-900/40 text-amber-300 ring-1 ring-amber-700' },
  growth_os:      { label: 'Growth OS',       pill: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',  darkPill: 'bg-indigo-900/40 text-indigo-300 ring-1 ring-indigo-700' },
  authority:      { label: 'Authority',       pill: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200',  darkPill: 'bg-yellow-900/40 text-yellow-300 ring-1 ring-yellow-700' },
  conversion_cta: { label: 'Conversion',      pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', darkPill: 'bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700' },
}

const STATUS_META = {
  draft:     { label: 'Draft',     bar: 'bg-gray-400',    pill: 'bg-gray-100 text-gray-500',   darkPill: 'bg-gray-700 text-gray-400' },
  approved:  { label: 'Approved',  bar: 'bg-blue-500',    pill: 'bg-blue-50 text-blue-600',    darkPill: 'bg-blue-900/40 text-blue-400' },
  scheduled: { label: 'Scheduled', bar: 'bg-amber-500',   pill: 'bg-amber-50 text-amber-600',  darkPill: 'bg-amber-900/40 text-amber-400' },
  posted:    { label: 'Posted',    bar: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700', darkPill: 'bg-emerald-900/40 text-emerald-400' },
  archived:  { label: 'Archived',  bar: 'bg-gray-200',    pill: 'bg-gray-50 text-gray-400',    darkPill: 'bg-gray-800 text-gray-600' },
}

const REACH_META = {
  viral:  { label: 'Viral',  bg: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200', darkBg: 'bg-emerald-900/30 text-emerald-400 ring-1 ring-emerald-700', dot: 'bg-emerald-500' },
  high:   { label: 'High',   bg: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',          darkBg: 'bg-blue-900/30 text-blue-400 ring-1 ring-blue-700',          dot: 'bg-blue-500' },
  medium: { label: 'Medium', bg: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',        darkBg: 'bg-amber-900/30 text-amber-400 ring-1 ring-amber-700',        dot: 'bg-amber-400' },
  low:    { label: 'Low',    bg: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',           darkBg: 'bg-gray-700/50 text-gray-500 ring-1 ring-gray-600',           dot: 'bg-gray-400' },
}

const SIGNAL_TYPE_META = {
  pain_point:       { label: 'Pain Point',       color: 'text-rose-600',   bg: 'bg-rose-50 ring-rose-200' },
  emotional_phrase: { label: 'Emotional Phrase',  color: 'text-purple-600', bg: 'bg-purple-50 ring-purple-200' },
  frustration:      { label: 'Frustration',       color: 'text-orange-600', bg: 'bg-orange-50 ring-orange-200' },
  objection:        { label: 'Objection',         color: 'text-red-600',    bg: 'bg-red-50 ring-red-200' },
  desire:           { label: 'Desire',            color: 'text-emerald-600', bg: 'bg-emerald-50 ring-emerald-200' },
  trending_concern: { label: 'Trending',          color: 'text-blue-600',   bg: 'bg-blue-50 ring-blue-200' },
  question:         { label: 'Question',          color: 'text-indigo-600', bg: 'bg-indigo-50 ring-indigo-200' },
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseBody(str) {
  try { return str ? (typeof str === 'string' ? JSON.parse(str) : str) : {} }
  catch { return {} }
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtLabel(str) {
  return str ? str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''
}

function scoreColor(score) {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50 ring-emerald-200'
  if (score >= 65) return 'text-blue-600 bg-blue-50 ring-blue-200'
  if (score >= 50) return 'text-amber-600 bg-amber-50 ring-amber-200'
  return 'text-red-500 bg-red-50 ring-red-200'
}

function scoreColorDark(score) {
  if (score >= 80) return 'text-emerald-400 bg-emerald-900/30 ring-emerald-700'
  if (score >= 65) return 'text-blue-400 bg-blue-900/30 ring-blue-700'
  if (score >= 50) return 'text-amber-400 bg-amber-900/30 ring-amber-700'
  return 'text-red-400 bg-red-900/30 ring-red-700'
}

function scoreBarColor(score) {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 65) return 'bg-blue-500'
  if (score >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function timeAgo(d) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const FRESHNESS_META = {
  new:    { label: 'New',    pill: 'bg-violet-100 text-violet-700 ring-1 ring-violet-300',      darkPill: 'bg-violet-900/50 text-violet-300 ring-1 ring-violet-700',   dot: 'bg-violet-500',  pulse: true  },
  viewed: { label: 'Viewed', pill: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',             darkPill: 'bg-gray-700 text-gray-500 ring-1 ring-gray-600',             dot: 'bg-gray-400',    pulse: false },
  edited: { label: 'Edited', pill: 'bg-blue-100 text-blue-600 ring-1 ring-blue-200',             darkPill: 'bg-blue-900/40 text-blue-400 ring-1 ring-blue-700',          dot: 'bg-blue-500',    pulse: false },
  posted: { label: 'Posted', pill: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',    darkPill: 'bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-700', dot: 'bg-emerald-500', pulse: false },
  stale:  { label: 'Stale',  pill: 'bg-amber-100 text-amber-600 ring-1 ring-amber-200',          darkPill: 'bg-amber-900/40 text-amber-400 ring-1 ring-amber-700',        dot: 'bg-amber-400',   pulse: false },
}

const GENERATION_TYPE_META = {
  'manual':        { label: 'Manual',        darkBg: 'bg-gray-700/60 text-gray-400 ring-1 ring-gray-600',          bg: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
  'signal-driven': { label: 'Signal-Driven', darkBg: 'bg-violet-900/50 text-violet-300 ring-1 ring-violet-700',    bg: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  'scheduled':     { label: 'Scheduled',     darkBg: 'bg-blue-900/40 text-blue-400 ring-1 ring-blue-700',          bg: 'bg-blue-50 text-blue-600 ring-1 ring-blue-200' },
  'academy':       { label: 'Academy',       darkBg: 'bg-amber-900/40 text-amber-400 ring-1 ring-amber-700',       bg: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  'viral':         { label: 'Viral',         darkBg: 'bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-700', bg: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  'founder-pov':   { label: 'Founder POV',   darkBg: 'bg-rose-900/40 text-rose-400 ring-1 ring-rose-700',         bg: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
}

// ── Primitive components ──────────────────────────────────────────────────────

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${className}`}>
      {children}
    </span>
  )
}

function ScoreBadge({ label, score, dark }) {
  const cls = dark ? scoreColorDark(score) : scoreColor(score)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ring-1 ${cls}`}>
      <span className="font-bold">{score}</span>
      <span className="opacity-60 font-normal">{label}</span>
    </span>
  )
}

function CopyBtn({ text, label = 'Copy', compact = false, dark = false }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard.writeText(text || '').then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        })
      }}
      className={`inline-flex items-center gap-1 font-medium rounded-lg border transition-all ${
        compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs'
      } ${copied
        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
        : dark
          ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
      }`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

function FieldLabel({ children, dark }) {
  return (
    <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
      {children}
    </p>
  )
}

// ── Score bar visualization ───────────────────────────────────────────────────

function ScoreMeter({ label, score, dark }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-medium ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
        <span className={`text-xs font-bold ${score >= 80 ? 'text-emerald-500' : score >= 65 ? 'text-blue-500' : score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{score}</span>
      </div>
      <div className={`h-1.5 rounded-full ${dark ? 'bg-gray-700' : 'bg-gray-100'}`}>
        <div
          className={`h-1.5 rounded-full transition-all duration-700 ${scoreBarColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

// ── Content card ──────────────────────────────────────────────────────────────

function ContentCard({ piece, onStatusChange, onSaveHook, onOpen, isActive, dark }) {
  const body = parseBody(piece.body)
  const title = body.content_title || piece.hook?.substring(0, 80) || 'Untitled'
  const sm = STATUS_META[piece.status] || STATUS_META.draft
  const pm = PLATFORM_META[piece.platform]
  const pilm = PILLAR_META[piece.pillar]
  const rm = piece.estimatedReach ? REACH_META[piece.estimatedReach] : null
  const hasScores = piece.overallScore > 0
  const fm = FRESHNESS_META[piece.freshnessState] || null
  const isNew = piece.freshnessState === 'new'
  const gtm = GENERATION_TYPE_META[piece.generationType] || null

  return (
    <div
      onClick={() => onOpen(piece)}
      className={`group relative rounded-xl border transition-all cursor-pointer overflow-hidden ${
        isActive
          ? dark
            ? 'border-white/20 shadow-lg bg-gray-800'
            : 'border-gray-900 shadow-md bg-white'
          : isNew
            ? dark
              ? 'border-violet-500/60 shadow-lg shadow-violet-900/20 bg-gray-800/70 hover:border-violet-400/80'
              : 'border-violet-300 shadow-md shadow-violet-100 bg-white hover:border-violet-400'
            : dark
              ? 'border-gray-700/50 hover:border-gray-600 bg-gray-800/60 hover:bg-gray-800'
              : 'border-gray-200 hover:border-gray-300 hover:shadow-sm bg-white'
      }`}
    >
      {/* Status bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${sm.bar}`} />

      {/* NEW badge strip */}
      {isNew && (
        <div className={`absolute top-0 left-[3px] right-0 h-[2px] ${dark ? 'bg-violet-500/70' : 'bg-violet-400/60'}`} />
      )}

      <div className="pl-5 pr-4 py-4">
        {/* NEW AI GENERATED banner + time ago */}
        {isNew && (
          <div className="flex items-center gap-2 mb-2.5">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase ${dark ? 'bg-violet-900/60 text-violet-300 ring-1 ring-violet-700' : 'bg-violet-100 text-violet-700 ring-1 ring-violet-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dark ? 'bg-violet-400' : 'bg-violet-500'} animate-pulse`} />
              New AI Generated
            </span>
            {piece.generatedAt && (
              <span className={`text-[10px] ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
                {timeAgo(piece.generatedAt)}
              </span>
            )}
          </div>
        )}

        {/* Title */}
        <h3 className={`text-sm font-semibold leading-snug mb-3 pr-2 ${dark ? 'text-gray-100' : 'text-gray-900'}`}>
          {title}
        </h3>

        {/* Platform + Pillar pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pm && <Pill className={dark ? pm.darkPill : pm.pill}>{pm.label}</Pill>}
          {pilm && <Pill className={dark ? pilm.darkPill : pilm.pill}>{pilm.label}</Pill>}
          {piece.painCategory && (
            <Pill className={dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : 'bg-gray-50 text-gray-500 ring-gray-200'}>
              {fmtLabel(piece.painCategory)}
            </Pill>
          )}
          {rm && (
            <Pill className={dark ? rm.darkBg : rm.bg}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1 ${rm.dot}`} />
              {rm.label}
            </Pill>
          )}
          {piece.signalInfluenceScore > 0 && (
            <Pill className={dark ? 'bg-violet-900/40 text-violet-400 ring-1 ring-violet-700' : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'}>
              ⚡ Signals
            </Pill>
          )}
        </div>

        {/* Score badges */}
        {hasScores && (
          <div className="flex flex-wrap gap-1 mb-3">
            <ScoreBadge label="Hook" score={piece.hookScore} dark={dark} />
            <ScoreBadge label="Emotion" score={piece.emotionalScore} dark={dark} />
            <ScoreBadge label="Viral" score={piece.viralityScore} dark={dark} />
          </div>
        )}

        {/* Footer */}
        <div className={`flex items-center justify-between pt-3 border-t ${dark ? 'border-gray-700' : 'border-gray-50'}`}>
          <div className="flex items-center gap-2">
            <Pill className={dark ? sm.darkPill : sm.pill}>{sm.label}</Pill>
            {fm && !isNew && (
              <span className={`flex items-center gap-1 text-[10px] font-medium ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${fm.dot}`} />
                {fm.label}
              </span>
            )}
            {piece.isWinning && (
              <span className="text-xs text-amber-500 font-semibold">★ Hook</span>
            )}
            {piece.views > 0 && (
              <span className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                {piece.views.toLocaleString()} views
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <QuickMenu piece={piece} onStatusChange={onStatusChange} onSaveHook={onSaveHook} dark={dark} />
            <button
              onClick={e => { e.stopPropagation(); onOpen(piece) }}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-900 text-white hover:bg-gray-700'
              }`}
            >
              Open →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickMenu({ piece, onStatusChange, onSaveHook, dark }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const actions = [
    { label: 'Approve', fn: () => onStatusChange(piece.id, 'approved'), disabled: ['approved','posted'].includes(piece.status) },
    { label: 'Mark Scheduled', fn: () => onStatusChange(piece.id, 'scheduled'), disabled: piece.status === 'posted' },
    { label: 'Mark Posted', fn: () => onStatusChange(piece.id, 'posted'), disabled: piece.status === 'posted' },
    { label: 'Archive', fn: () => onStatusChange(piece.id, 'archived'), disabled: piece.status === 'archived' },
    null,
    { label: piece.isWinning ? '★ Hook Saved' : '☆ Save to Hook Library', fn: () => onSaveHook(piece.id), disabled: piece.isWinning },
  ]

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`p-1.5 rounded-lg transition-colors ${dark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>
      {open && (
        <div className={`absolute right-0 top-8 z-50 w-48 rounded-xl border shadow-xl py-1 overflow-hidden ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          {actions.map((action, i) =>
            action === null
              ? <div key={i} className={`my-1 border-t ${dark ? 'border-gray-700' : 'border-gray-100'}`} />
              : (
                <button
                  key={action.label}
                  disabled={action.disabled}
                  onClick={() => { action.fn(); setOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-default ${
                    dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {action.label}
                </button>
              )
          )}
        </div>
      )}
    </div>
  )
}

// ── Content Drawer ────────────────────────────────────────────────────────────

function ContentDrawer({ piece, allQueue, onClose, onStatusChange, onSaveHook, onPerformanceUpdate, dark }) {
  const [tab, setTab] = useState('script')
  const [currentId, setCurrentId] = useState(piece.id)
  const current = allQueue.find(p => p.id === currentId) || piece
  const body = parseBody(current.body)
  const idx = allQueue.findIndex(p => p.id === currentId)

  const isVideo = current.contentType === 'short_form_video'
  const isWhatsApp = current.contentType === 'whatsapp_status'
  const segments = body.segments || body.scenes || []

  const fullScript = body.full_script || body.full_video_script || body.voiceover_script ||
    (segments.length ? segments.map(s => `[${s.segment_title || s.scene_title}]\n${s.voiceover || ''}`).join('\n\n') : current.hook)

  const shotListText = body.shot_list
    ? body.shot_list.map(s => `${s.shot_number}. ${s.shot_type} — ${s.description}`).join('\n')
    : (body.status_slides ? body.status_slides.map(s => `Slide ${s.slide_number}:\n${s.slide_text}`).join('\n\n') : '')

  const hasScores = current.overallScore > 0

  const TABS = [
    { id: 'script',      label: 'Script' },
    { id: 'caption',     label: 'Caption' },
    { id: 'shotlist',    label: isWhatsApp ? 'Slides' : 'Shots' },
    { id: 'cta',         label: 'CTA' },
    { id: 'production',  label: 'Production' },
    { id: 'performance', label: 'Performance' },
    { id: 'lineage',     label: 'Lineage' },
  ]

  const bg     = dark ? 'bg-gray-900 border-gray-700/50'  : 'bg-white border-gray-200'
  const header = dark ? 'bg-gray-950 border-gray-800'     : 'bg-gray-50 border-gray-100'
  const tabbar = dark ? 'bg-gray-900 border-gray-800'     : 'bg-white border-gray-100'
  const card   = dark ? 'bg-gray-800 border-gray-700'     : 'bg-white border-gray-200'
  const cardAlt= dark ? 'bg-gray-800/50 border-gray-700/50' : 'bg-gray-50 border-gray-100'
  const text   = dark ? 'text-gray-100' : 'text-gray-900'
  const sub    = dark ? 'text-gray-400' : 'text-gray-500'
  const muted  = dark ? 'text-gray-600' : 'text-gray-400'

  return (
    <div className={`flex flex-col h-full border-l ${bg}`} style={{ width: 600, flexShrink: 0 }}>

      {/* Header */}
      <div className={`flex-shrink-0 px-6 pt-5 pb-4 border-b ${header}`}>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${muted}`}>
              {body.content_structure_type ? fmtLabel(body.content_structure_type) : fmtLabel(current.contentType)}
            </p>
            <h2 className={`text-base font-bold leading-tight ${text}`}>
              {body.content_title || current.hook?.substring(0, 80) || 'Content Script'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${dark ? 'text-gray-600 hover:text-gray-400 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PLATFORM_META[current.platform] && <Pill className={dark ? PLATFORM_META[current.platform].darkPill : PLATFORM_META[current.platform].pill}>{PLATFORM_META[current.platform].label}</Pill>}
          {PILLAR_META[current.pillar] && <Pill className={dark ? PILLAR_META[current.pillar].darkPill : PILLAR_META[current.pillar].pill}>{PILLAR_META[current.pillar].label}</Pill>}
          {current.painCategory && <Pill className={dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : 'bg-gray-50 text-gray-500 ring-gray-200'}>{fmtLabel(current.painCategory)}</Pill>}
          {body._contentStyle && body._contentStyle !== 'auto' && <Pill className={dark ? 'bg-slate-800 text-slate-400 ring-slate-700' : 'bg-slate-50 text-slate-600 ring-slate-200'}>{body._contentStyle}</Pill>}
          {current.ctaStyle && <Pill className={dark ? 'bg-violet-900/40 text-violet-400 ring-violet-700' : 'bg-violet-50 text-violet-600 ring-violet-200'}>{fmtLabel(current.ctaStyle)} CTA</Pill>}
          {current.estimatedReach && REACH_META[current.estimatedReach] && (
            <Pill className={dark ? REACH_META[current.estimatedReach].darkBg : REACH_META[current.estimatedReach].bg}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1 ${REACH_META[current.estimatedReach].dot}`} />
              {REACH_META[current.estimatedReach].label} reach
            </Pill>
          )}
        </div>

        {/* Audience */}
        {body.target_audience && (
          <p className={`text-xs mb-3 leading-relaxed ${sub}`}>
            <span className={`font-semibold ${dark ? 'text-gray-300' : 'text-gray-600'}`}>Audience:</span> {body.target_audience}
          </p>
        )}

        {/* Score meters */}
        {hasScores && (
          <div className={`rounded-xl border p-4 mb-3 ${cardAlt}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${muted}`}>Content Intelligence Score</p>
            <div className="space-y-2.5">
              <ScoreMeter label="Hook Power" score={current.hookScore} dark={dark} />
              <ScoreMeter label="Emotional Depth" score={current.emotionalScore} dark={dark} />
              <ScoreMeter label="Virality Potential" score={current.viralityScore} dark={dark} />
              <ScoreMeter label="Conversion Power" score={current.conversionScore} dark={dark} />
              <ScoreMeter label="Authority Signal" score={current.authorityScore} dark={dark} />
            </div>
            <div className={`mt-3 pt-3 border-t flex items-center justify-between ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
              <span className={`text-xs font-semibold ${sub}`}>Overall Score</span>
              <span className={`text-xl font-bold ${current.overallScore >= 80 ? 'text-emerald-500' : current.overallScore >= 65 ? 'text-blue-500' : current.overallScore >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                {current.overallScore}
                <span className={`text-xs ml-1 ${sub}`}>/ 100</span>
              </span>
            </div>
          </div>
        )}

        {/* Navigation between pieces */}
        {allQueue.length > 1 && (
          <div className="flex items-center gap-2 mb-3">
            <button disabled={idx <= 0} onClick={() => setCurrentId(allQueue[idx - 1].id)}
              className={`px-2.5 py-1 text-xs border rounded-lg transition-colors disabled:opacity-40 ${dark ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>← Prev</button>
            <span className={`text-xs font-medium ${sub}`}>{idx + 1} / {allQueue.length}</span>
            <button disabled={idx >= allQueue.length - 1} onClick={() => setCurrentId(allQueue[idx + 1].id)}
              className={`px-2.5 py-1 text-xs border rounded-lg transition-colors disabled:opacity-40 ${dark ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Next →</button>
          </div>
        )}

        {/* Status controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={current.status}
            onChange={e => onStatusChange(current.id, e.target.value)}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border-0 outline-none cursor-pointer ${STATUS_META[current.status]?.[dark ? 'darkPill' : 'pill'] || ''}`}
          >
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button onClick={() => onStatusChange(current.id, 'approved')}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Approve
          </button>
          <button onClick={() => onStatusChange(current.id, 'posted')}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
            Posted
          </button>
          <button
            onClick={() => onSaveHook(current.id)}
            disabled={current.isWinning}
            className={`ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              current.isWinning
                ? dark ? 'bg-amber-900/40 text-amber-400 cursor-default' : 'bg-amber-50 text-amber-700 cursor-default'
                : 'bg-amber-400 text-amber-900 hover:bg-amber-500'
            }`}
          >
            {current.isWinning ? '★ Hook Saved' : '☆ Save Hook'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className={`flex-shrink-0 flex border-b ${tabbar} px-4`}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? dark ? 'border-white text-white' : 'border-gray-900 text-gray-900'
                : dark ? 'border-transparent text-gray-600 hover:text-gray-400' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* SCRIPT */}
        {tab === 'script' && (
          <>
            <div className={`border rounded-xl p-4 ${dark ? 'bg-amber-900/20 border-amber-800/40' : 'bg-amber-50 border-amber-100'}`}>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel dark={dark}>Opening Hook</FieldLabel>
                <CopyBtn text={current.hook} label="Copy Hook" compact dark={dark} />
              </div>
              <p className={`text-sm font-bold leading-snug ${dark ? 'text-amber-200' : 'text-gray-900'}`}>"{current.hook}"</p>
            </div>

            {isVideo && segments.length > 0 && segments.map(seg => {
              const num = seg.segment_number ?? seg.scene_number
              const title = seg.segment_title ?? seg.scene_title
              return (
                <div key={num} className={`border rounded-xl overflow-hidden ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className={`px-4 py-2.5 flex items-center justify-between ${dark ? 'bg-gray-800' : 'bg-gray-900'}`}>
                    <span className="text-xs font-bold tracking-wide text-white">
                      {num ? `${num}. ` : ''}{title?.toUpperCase() || 'SEGMENT'}
                    </span>
                    {seg.duration && <span className="text-xs text-gray-400">{seg.duration}</span>}
                  </div>
                  <div className={`p-4 space-y-3 ${dark ? 'bg-gray-800/50' : ''}`}>
                    {seg.visual_direction && (
                      <div>
                        <FieldLabel dark={dark}>Camera / Visual</FieldLabel>
                        <p className={`text-sm ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{seg.visual_direction}</p>
                      </div>
                    )}
                    {seg.acting_direction && (
                      <div>
                        <FieldLabel dark={dark}>Acting Direction</FieldLabel>
                        <p className={`text-sm italic ${dark ? 'text-blue-400' : 'text-blue-700'}`}>{seg.acting_direction}</p>
                      </div>
                    )}
                    {seg.on_screen_text && (
                      <div>
                        <FieldLabel dark={dark}>On-Screen Text</FieldLabel>
                        <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-xs font-mono">{seg.on_screen_text}</div>
                      </div>
                    )}
                    {seg.voiceover && (
                      <div>
                        <FieldLabel dark={dark}>Voiceover</FieldLabel>
                        <p className={`text-sm ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{seg.voiceover}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {isWhatsApp && body.status_slides?.map(slide => (
              <div key={slide.slide_number} className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <Pill className={dark ? 'bg-green-900/40 text-green-400 ring-green-700' : 'bg-green-50 text-green-700 ring-green-200'}>Slide {slide.slide_number}</Pill>
                  <CopyBtn text={slide.slide_text} label="Copy" compact dark={dark} />
                </div>
                <p className={`text-sm font-medium mb-2 ${dark ? 'text-gray-200' : 'text-gray-900'}`}>{slide.slide_text}</p>
                {slide.image_video_idea && (
                  <p className={`text-xs rounded-lg px-3 py-2 mb-2 ${dark ? 'text-gray-500 bg-gray-800' : 'text-gray-500 bg-gray-50'}`}>
                    <span className="font-semibold">Visual:</span> {slide.image_video_idea}
                  </p>
                )}
                {slide.cta && <p className={`text-xs font-semibold ${dark ? 'text-blue-400' : 'text-blue-600'}`}>→ {slide.cta}</p>}
              </div>
            ))}

            {!isVideo && !isWhatsApp && body.educational_post && (
              <div className="space-y-3">
                <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200'}`}>
                  <FieldLabel dark={dark}>Intro</FieldLabel>
                  <p className={`text-sm leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{body.educational_post.intro}</p>
                </div>
                {(body.educational_post.body_paragraphs || []).map((para, i) => (
                  <div key={i} className={`border rounded-xl p-4 ${dark ? 'border-gray-700/50 bg-gray-800/30' : 'border-gray-100 bg-gray-50'}`}>
                    <FieldLabel dark={dark}>Paragraph {i + 2}</FieldLabel>
                    <p className={`text-sm leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{para}</p>
                  </div>
                ))}
                {body.educational_post.conclusion && (
                  <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200'}`}>
                    <FieldLabel dark={dark}>Conclusion</FieldLabel>
                    <p className={`text-sm leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{body.educational_post.conclusion}</p>
                  </div>
                )}
              </div>
            )}

            {!isVideo && !isWhatsApp && !body.educational_post && body.hook_slide && (
              <div className="space-y-3">
                <div className={`border rounded-xl p-4 ${dark ? 'border-amber-800/40 bg-amber-900/20' : 'border-amber-100 bg-amber-50'}`}>
                  <Pill className={dark ? 'bg-amber-900/40 text-amber-400 ring-amber-700' : 'bg-amber-100 text-amber-700 ring-amber-200'}>Hook Slide</Pill>
                  <p className={`text-sm font-bold mt-2 ${dark ? 'text-gray-100' : 'text-gray-900'}`}>{body.hook_slide.heading}</p>
                  <p className={`text-sm mt-1 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{body.hook_slide.body}</p>
                </div>
                {(body.problem_slides || []).map(sl => (
                  <div key={sl.slide_number} className={`border rounded-xl p-4 ${dark ? 'border-rose-800/40 bg-rose-900/20' : 'border-rose-100 bg-rose-50'}`}>
                    <Pill className={dark ? 'bg-rose-900/40 text-rose-400 ring-rose-700' : 'bg-rose-100 text-rose-700 ring-rose-200'}>Problem {sl.slide_number}</Pill>
                    <p className={`text-sm font-bold mt-2 ${dark ? 'text-gray-100' : 'text-gray-900'}`}>{sl.heading}</p>
                    <p className={`text-sm mt-1 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{sl.body}</p>
                  </div>
                ))}
                {(body.solution_slides || []).map(sl => (
                  <div key={sl.slide_number} className={`border rounded-xl p-4 ${dark ? 'border-emerald-800/40 bg-emerald-900/20' : 'border-emerald-100 bg-emerald-50'}`}>
                    <Pill className={dark ? 'bg-emerald-900/40 text-emerald-400 ring-emerald-700' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}>Solution {sl.slide_number}</Pill>
                    <p className={`text-sm font-bold mt-2 ${dark ? 'text-gray-100' : 'text-gray-900'}`}>{sl.heading}</p>
                    <p className={`text-sm mt-1 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{sl.body}</p>
                  </div>
                ))}
                {body.cta_slide && (
                  <div className={`border rounded-xl p-4 ${dark ? 'border-blue-800/40 bg-blue-900/20' : 'border-blue-100 bg-blue-50'}`}>
                    <Pill className={dark ? 'bg-blue-900/40 text-blue-400 ring-blue-700' : 'bg-blue-100 text-blue-700 ring-blue-200'}>CTA Slide</Pill>
                    <p className={`text-sm font-bold mt-2 ${dark ? 'text-gray-100' : 'text-gray-900'}`}>{body.cta_slide.heading}</p>
                    <p className={`text-sm mt-1 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{body.cta_slide.body}</p>
                    {body.cta_slide.cta_text && <p className={`text-xs font-bold mt-2 ${dark ? 'text-blue-400' : 'text-blue-700'}`}>→ {body.cta_slide.cta_text}</p>}
                  </div>
                )}
              </div>
            )}

            {isVideo && fullScript && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel dark={dark}>Full Script</FieldLabel>
                  <CopyBtn text={fullScript} label="Copy Script" compact dark={dark} />
                </div>
                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{fullScript}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {fullScript && <CopyBtn text={fullScript} label="Copy Full Script" dark={dark} />}
              {body.voiceover_script && <CopyBtn text={body.voiceover_script} label="Copy Voiceover" dark={dark} />}
            </div>
          </>
        )}

        {/* CAPTION */}
        {tab === 'caption' && (
          <>
            <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <FieldLabel dark={dark}>Post Caption</FieldLabel>
                <CopyBtn text={body.caption || current.cta} label="Copy Caption" compact dark={dark} />
              </div>
              <p className={`text-sm whitespace-pre-wrap leading-relaxed ${dark ? 'text-gray-200' : 'text-gray-900'}`}>{body.caption || current.cta}</p>
            </div>

            {body.hashtags?.length > 0 && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700/50 bg-gray-800/30' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel dark={dark}>Hashtags</FieldLabel>
                  <CopyBtn text={body.hashtags.join(' ')} label="Copy All" compact dark={dark} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {body.hashtags.map((tag, i) => (
                    <span key={i} className={`text-xs rounded-md px-2 py-0.5 font-medium ${dark ? 'text-blue-400 bg-blue-900/30' : 'text-blue-600 bg-blue-50'}`}>{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {body.posting_angle && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-amber-800/40 bg-amber-900/20' : 'border-amber-100 bg-amber-50'}`}>
                <FieldLabel dark={dark}>Posting Angle</FieldLabel>
                <p className={`text-sm leading-relaxed ${dark ? 'text-amber-200' : 'text-gray-800'}`}>{body.posting_angle}</p>
              </div>
            )}
          </>
        )}

        {/* SHOT LIST */}
        {tab === 'shotlist' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h3 className={`text-sm font-bold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{isWhatsApp ? 'Status Slides' : 'Shot List'}</h3>
              <CopyBtn text={shotListText} label={isWhatsApp ? 'Copy All' : 'Copy Shot List'} compact dark={dark} />
            </div>

            {isWhatsApp && body.status_slides?.map(sl => (
              <div key={sl.slide_number} className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <Pill className={dark ? 'bg-green-900/40 text-green-400 ring-green-700' : 'bg-green-50 text-green-700 ring-green-200'}>Slide {sl.slide_number}</Pill>
                  <CopyBtn text={sl.slide_text} label="Copy" compact dark={dark} />
                </div>
                <p className={`text-sm font-medium mb-2 ${dark ? 'text-gray-200' : 'text-gray-900'}`}>{sl.slide_text}</p>
                {sl.image_video_idea && (
                  <p className={`text-xs rounded-lg px-3 py-2 mb-2 ${dark ? 'text-gray-500 bg-gray-800' : 'text-gray-500 bg-gray-50'}`}>
                    <span className="font-semibold">Visual:</span> {sl.image_video_idea}
                  </p>
                )}
                <p className={`text-xs font-semibold ${dark ? 'text-blue-400' : 'text-blue-600'}`}>→ {sl.cta}</p>
              </div>
            ))}

            {!isWhatsApp && body.shot_list?.map(shot => (
              <div key={shot.shot_number} className={`flex gap-3 items-start border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                <div className="w-7 h-7 rounded-lg bg-gray-900 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {shot.shot_number}
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase mb-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{shot.shot_type}</p>
                  <p className={`text-sm ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{shot.description}</p>
                </div>
              </div>
            ))}

            {!isWhatsApp && !body.shot_list && (
              <p className={`text-sm italic ${sub}`}>Shot list not available.</p>
            )}
          </>
        )}

        {/* CTA */}
        {tab === 'cta' && (
          <>
            {[
              { label: 'Primary CTA', text: current.cta, bg: dark ? 'border-blue-800/40 bg-blue-900/20' : 'bg-blue-50 border-blue-100' },
              current.telegramCta && { label: 'Bio CTA', text: current.telegramCta, bg: dark ? 'border-indigo-800/40 bg-indigo-900/20' : 'bg-indigo-50 border-indigo-100' },
              body.academy_cta && { label: 'Academy CTA', text: body.academy_cta, bg: dark ? 'border-amber-800/40 bg-amber-900/20' : 'bg-amber-50 border-amber-100' },
              body.growth_os_cta && { label: 'Growth OS CTA', text: body.growth_os_cta, bg: dark ? 'border-violet-800/40 bg-violet-900/20' : 'bg-violet-50 border-violet-100' },
            ].filter(Boolean).map(item => (
              <div key={item.label} className={`border rounded-xl p-4 ${item.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel dark={dark}>{item.label}</FieldLabel>
                  <CopyBtn text={item.text} label="Copy" compact dark={dark} />
                </div>
                <p className={`text-sm font-semibold ${dark ? 'text-gray-200' : 'text-gray-900'}`}>{item.text}</p>
              </div>
            ))}

            {current.ctaStyle && (
              <div className={`border rounded-xl p-3 ${dark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50'}`}>
                <FieldLabel dark={dark}>CTA Strategy</FieldLabel>
                <p className={`text-sm font-semibold capitalize ${dark ? 'text-violet-400' : 'text-violet-700'}`}>{fmtLabel(current.ctaStyle)} style</p>
                <p className={`text-xs mt-0.5 ${sub}`}>
                  {current.ctaStyle === 'authority' && 'Positions expertise. Makes the bio feel essential.'}
                  {current.ctaStyle === 'curiosity' && 'Triggers curiosity gap. Makes them need to check.'}
                  {current.ctaStyle === 'urgency' && 'Creates time pressure. Drives immediate action.'}
                  {current.ctaStyle === 'soft' && 'Low-pressure. Removes resistance from skeptical viewers.'}
                  {current.ctaStyle === 'luxury' && 'Premium positioning. Attracts high-quality leads.'}
                  {current.ctaStyle === 'founder' && 'Personal brand credibility. Founder-led trust.'}
                  {current.ctaStyle === 'educational' && 'Value-first. Positions bio as a resource, not a sales page.'}
                  {current.ctaStyle === 'anti_sales' && 'Reverses sales resistance. Disarms the skeptic.'}
                </p>
              </div>
            )}
          </>
        )}

        {/* PRODUCTION */}
        {tab === 'production' && (
          <>
            {body.props_needed?.length > 0 && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                <FieldLabel dark={dark}>Props Needed</FieldLabel>
                <ul className="mt-1 space-y-1.5">
                  {body.props_needed.map((prop, i) => (
                    <li key={i} className={`flex items-center gap-2 text-sm ${dark ? 'text-gray-300' : 'text-gray-800'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dark ? 'bg-gray-600' : 'bg-gray-400'}`} />
                      {prop}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {body.suggested_music_mood && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                <FieldLabel dark={dark}>Music Mood</FieldLabel>
                <p className={`text-sm mt-1 ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{body.suggested_music_mood}</p>
              </div>
            )}

            {body.filming_instructions && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-blue-800/40 bg-blue-900/20' : 'border-blue-100 bg-blue-50'}`}>
                <FieldLabel dark={dark}>Filming Instructions</FieldLabel>
                <p className={`text-sm mt-1 leading-relaxed ${dark ? 'text-blue-200' : 'text-gray-800'}`}>{body.filming_instructions}</p>
              </div>
            )}

            {body.editing_instructions && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-purple-800/40 bg-purple-900/20' : 'border-purple-100 bg-purple-50'}`}>
                <FieldLabel dark={dark}>Editing Instructions</FieldLabel>
                <p className={`text-sm mt-1 leading-relaxed ${dark ? 'text-purple-200' : 'text-gray-800'}`}>{body.editing_instructions}</p>
              </div>
            )}

            {body.posting_angle && (
              <div className={`border rounded-xl p-4 ${dark ? 'border-amber-800/40 bg-amber-900/20' : 'border-amber-100 bg-amber-50'}`}>
                <FieldLabel dark={dark}>Posting Angle</FieldLabel>
                <p className={`text-sm mt-1 ${dark ? 'text-amber-200' : 'text-gray-800'}`}>{body.posting_angle}</p>
              </div>
            )}

            {!body.props_needed && !body.filming_instructions && (
              <p className={`text-sm italic ${sub}`}>Production notes not available.</p>
            )}
          </>
        )}

        {/* PERFORMANCE */}
        {tab === 'performance' && (
          <>
            <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
              <FieldLabel dark={dark}>Track Performance</FieldLabel>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { key: 'views', label: 'Views' },
                  { key: 'saves', label: 'Saves' },
                  { key: 'comments', label: 'Comments' },
                  { key: 'replies', label: 'Replies' },
                  { key: 'ctaClicks', label: 'CTA Clicks' },
                  { key: 'leads', label: 'Leads' },
                  { key: 'conversions', label: 'Conversions' },
                  { key: 'watchRetention', label: 'Watch Retention %' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className={`block text-xs font-semibold mb-1.5 ${sub}`}>{label}</label>
                    <input
                      type="number"
                      defaultValue={current[key] || 0}
                      min={0}
                      max={key === 'watchRetention' ? 100 : undefined}
                      step={key === 'watchRetention' ? '0.1' : 1}
                      onBlur={e => onPerformanceUpdate(current.id, { [key]: key === 'watchRetention' ? parseFloat(e.target.value) : parseInt(e.target.value) || 0 })}
                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-100 transition-all ${
                        dark
                          ? 'bg-gray-700 border-gray-600 text-gray-200 focus:border-gray-500 focus:ring-gray-800'
                          : 'border-gray-200 text-gray-900 focus:border-gray-400'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {(current.views > 0 || current.leads > 0) && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Views', value: current.views?.toLocaleString() || 0, color: dark ? 'text-white' : 'text-gray-900' },
                  { label: 'Leads', value: current.leads || 0, color: dark ? 'text-purple-400' : 'text-purple-700' },
                  { label: 'Conversions', value: current.conversions || 0, color: dark ? 'text-emerald-400' : 'text-emerald-700' },
                ].map(kpi => (
                  <div key={kpi.label} className={`border rounded-xl p-4 text-center ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                    <p className={`text-xs mb-1 ${sub}`}>{kpi.label}</p>
                    <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700/50 bg-gray-800/30' : 'border-gray-100'}`}>
              <FieldLabel dark={dark}>Content Metadata</FieldLabel>
              <div className={`space-y-1.5 mt-2 divide-y ${dark ? 'divide-gray-700/50' : 'divide-gray-50'}`}>
                {[
                  { l: 'Model', v: current.claudeModel || '—' },
                  { l: 'Generated', v: fmtDate(current.createdAt) },
                  { l: 'Mode', v: fmtLabel(current.generationMode) },
                  { l: 'CTA Style', v: fmtLabel(current.ctaStyle) || '—' },
                  { l: 'Estimated Reach', v: fmtLabel(current.estimatedReach) || '—' },
                  body._contentStyle && body._contentStyle !== 'auto' && { l: 'Style', v: body._contentStyle },
                  body._objective && body._objective !== 'auto' && { l: 'Objective', v: body._objective },
                ].filter(Boolean).map(item => (
                  <div key={item.l} className="flex justify-between text-xs py-1.5 first:pt-0 last:pb-0">
                    <span className={sub}>{item.l}</span>
                    <span className={`font-medium ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{item.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* LINEAGE */}
        {tab === 'lineage' && (() => {
          const fm = FRESHNESS_META[current.freshnessState] || FRESHNESS_META.viewed
          const gtm = GENERATION_TYPE_META[current.generationType] || GENERATION_TYPE_META['manual']
          const signals = Array.isArray(current.generatedFromSignals) ? current.generatedFromSignals : []
          const painPoints = signals.filter(s => s.type === 'pain_point')
          const otherSignals = signals.filter(s => s.type !== 'pain_point')
          return (
            <>
              {/* Freshness + Generation Type */}
              <div className={`grid grid-cols-2 gap-3`}>
                <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                  <FieldLabel dark={dark}>Freshness State</FieldLabel>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${fm.dot} ${fm.pulse ? 'animate-pulse' : ''}`} />
                    <span className={`text-sm font-semibold ${dark ? 'text-gray-200' : 'text-gray-800'}`}>{fm.label}</span>
                  </div>
                </div>
                <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                  <FieldLabel dark={dark}>Generation Type</FieldLabel>
                  <Pill className={`mt-1.5 ${dark ? gtm.darkBg : gtm.bg}`}>{gtm.label}</Pill>
                </div>
              </div>

              {/* Signal Influence */}
              <div className={`border rounded-xl p-4 ${dark ? 'border-violet-800/40 bg-violet-900/20' : 'border-violet-100 bg-violet-50'}`}>
                <FieldLabel dark={dark}>Signal Influence Score</FieldLabel>
                <div className="flex items-center gap-3 mt-2">
                  <div className={`flex-1 h-2 rounded-full ${dark ? 'bg-gray-700' : 'bg-violet-100'}`}>
                    <div
                      className="h-2 rounded-full bg-violet-500 transition-all duration-700"
                      style={{ width: `${current.signalInfluenceScore || 0}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold flex-shrink-0 ${dark ? 'text-violet-400' : 'text-violet-700'}`}>
                    {current.signalInfluenceScore || 0}
                  </span>
                </div>
                <p className={`text-xs mt-1.5 ${sub}`}>How much real audience signals influenced this content</p>
              </div>

              {/* Generation Reason */}
              {current.generationReason && (
                <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                  <FieldLabel dark={dark}>Generation Reason</FieldLabel>
                  <p className={`text-sm mt-1 leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{current.generationReason}</p>
                </div>
              )}

              {/* Originating Pain Points */}
              {painPoints.length > 0 && (
                <div className={`border rounded-xl p-4 ${dark ? 'border-rose-800/40 bg-rose-900/20' : 'border-rose-100 bg-rose-50'}`}>
                  <FieldLabel dark={dark}>Originating Pain Points ({painPoints.length})</FieldLabel>
                  <div className="mt-2 space-y-2">
                    {painPoints.slice(0, 5).map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`text-xs font-bold mt-0.5 flex-shrink-0 ${dark ? 'text-rose-400' : 'text-rose-600'}`}>{s.frequency}×</span>
                        <p className={`text-xs leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-800'}`}>"{s.phrase}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Other originating phrases */}
              {otherSignals.length > 0 && (
                <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100'}`}>
                  <FieldLabel dark={dark}>Originating Phrases ({otherSignals.length})</FieldLabel>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {otherSignals.slice(0, 8).map((s, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ring-1 ${dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
                        <span className={`text-[9px] font-bold uppercase ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{s.type?.replace(/_/g, ' ')}</span>
                        <span>·</span>
                        {s.phrase?.substring(0, 35)}{s.phrase?.length > 35 ? '…' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {signals.length === 0 && (
                <div className={`border rounded-xl p-4 text-center ${dark ? 'border-gray-700/50 bg-gray-800/30' : 'border-gray-100'}`}>
                  <p className={`text-xs ${sub}`}>No signal phrases used — generated without live audience signals.</p>
                </div>
              )}

              {/* Session + Batch info */}
              <div className={`border rounded-xl p-4 ${dark ? 'border-gray-700/50 bg-gray-800/30' : 'border-gray-100'}`}>
                <FieldLabel dark={dark}>Lineage Metadata</FieldLabel>
                <div className={`space-y-1.5 mt-2 divide-y ${dark ? 'divide-gray-700/50' : 'divide-gray-50'}`}>
                  {[
                    { l: 'Session ID',     v: current.generationSessionId || '—' },
                    { l: 'Batch Label',    v: current.generationBatchLabel || '—' },
                    { l: 'Generated At',   v: current.generatedAt ? new Date(current.generatedAt).toLocaleString('en-NG') : fmtDate(current.createdAt) },
                    { l: 'Generation Mode', v: fmtLabel(current.generationMode) },
                    { l: 'AI Model',       v: current.claudeModel || '—' },
                  ].map(item => (
                    <div key={item.l} className="flex justify-between text-xs py-1.5 first:pt-0 last:pb-0">
                      <span className={sub}>{item.l}</span>
                      <span className={`font-mono text-[11px] ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{item.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        })()}

      </div>
    </div>
  )
}

// ── Hook card ─────────────────────────────────────────────────────────────────

function HookCard({ hook, onDeactivate, dark }) {
  const pm = PLATFORM_META[hook.platform]
  const pilm = PILLAR_META[hook.pillar]
  return (
    <div className={`border rounded-xl p-5 flex flex-col gap-3 transition-all ${
      dark ? 'border-gray-700 bg-gray-800/60 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-300'
    }`}>
      <div className="flex flex-wrap gap-1.5">
        {pm && <Pill className={dark ? pm.darkPill : pm.pill}>{pm.label}</Pill>}
        {pilm && <Pill className={dark ? pilm.darkPill : pilm.pill}>{pilm.label}</Pill>}
        {hook.painCategory && <Pill className={dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : 'bg-gray-50 text-gray-500 ring-gray-200'}>{fmtLabel(hook.painCategory)}</Pill>}
        {hook.hookType && <Pill className={dark ? 'bg-slate-800 text-slate-400 ring-slate-700' : 'bg-slate-50 text-slate-500 ring-slate-200'}>{hook.hookType}</Pill>}
      </div>
      <p className={`text-sm font-semibold italic leading-snug ${dark ? 'text-amber-300' : 'text-gray-900'}`}>"{hook.hook}"</p>
      {hook.performanceNote && (
        <p className={`text-xs rounded-lg px-3 py-2 ${dark ? 'text-gray-500 bg-gray-700/50' : 'text-gray-500 bg-gray-50'}`}>{hook.performanceNote}</p>
      )}
      <div className={`flex gap-2 pt-2 border-t ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
        <CopyBtn text={hook.hook} label="Copy Hook" dark={dark} />
        <button
          onClick={() => onDeactivate(hook.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${dark ? 'bg-red-900/30 border border-red-800 text-red-400 hover:bg-red-900/50' : 'bg-red-50 border border-red-100 text-red-600 hover:bg-red-100'}`}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

// ── Pain Signal card ──────────────────────────────────────────────────────────

function SignalCard({ signal, onDelete, dark }) {
  const meta = SIGNAL_TYPE_META[signal.signalType] || SIGNAL_TYPE_META.pain_point
  return (
    <div className={`border rounded-xl p-4 flex items-start gap-3 transition-all group ${
      dark ? 'border-gray-700 bg-gray-800/60 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-300'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Pill className={`ring-1 ${dark ? 'bg-gray-700 text-gray-400 ring-gray-600' : `${meta.bg} ${meta.color}`}`}>
            {meta.label}
          </Pill>
          <Pill className={dark ? 'bg-gray-700 text-gray-500 ring-gray-600' : 'bg-gray-50 text-gray-400 ring-gray-200'}>
            {fmtLabel(signal.painCategory)}
          </Pill>
          {signal.source !== 'manual' && (
            <Pill className={dark ? 'bg-gray-800 text-gray-600 ring-gray-700' : 'bg-gray-50 text-gray-400 ring-gray-200'}>
              {signal.source}
            </Pill>
          )}
        </div>
        <p className={`text-sm leading-relaxed ${dark ? 'text-gray-200' : 'text-gray-800'}`}>"{signal.signal}"</p>
        {signal.notes && (
          <p className={`text-xs mt-1.5 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{signal.notes}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div className={`text-center px-2.5 py-1 rounded-lg ${dark ? 'bg-gray-700' : 'bg-gray-50'}`}>
          <p className={`text-lg font-bold leading-none ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{signal.frequency}</p>
          <p className={`text-[9px] font-bold uppercase ${dark ? 'text-gray-600' : 'text-gray-400'}`}>seen</p>
        </div>
        <button
          onClick={() => onDelete(signal.id)}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg ${dark ? 'text-red-500 hover:bg-red-900/30' : 'text-red-400 hover:bg-red-50'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContentIntelligencePanel() {
  const [dark, setDark] = useState(true)
  const [view, setView] = useState('queue')
  const [queue, setQueue] = useState([])
  const [hooks, setHooks] = useState([])
  const [signals, setSignals] = useState([])
  const [stats, setStats] = useState(null)
  const [painCategories, setPainCategories] = useState([])
  const [pillars, setPillars] = useState([])
  const [platforms, setPlatforms] = useState([])
  const [contentStyles, setContentStyles] = useState([])
  const [objectives, setObjectives] = useState([])
  const [signalTypes, setSignalTypes] = useState([])
  const [signalSources, setSignalSources] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [activePiece, setActivePiece] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  // Queue filters
  const [fPlatform, setFPlatform] = useState('all')
  const [fPillar, setFPillar]     = useState('all')
  const [fStatus, setFStatus]     = useState('all')
  const [fFreshness, setFFreshness] = useState('all')

  // Signal filters
  const [fSignalType, setFSignalType]     = useState('all')
  const [fSignalCat, setFSignalCat]       = useState('all')

  // Generate form
  const [genForm, setGenForm] = useState({
    platform: 'tiktok', pillar: 'pain_point', painCategory: 'acne',
    contentStyle: 'auto', objective: 'auto',
  })

  // New signal form
  const [newSignal, setNewSignal] = useState({
    signal: '', signalType: 'pain_point', painCategory: 'general', source: 'manual', notes: '',
  })
  const [addingSignal, setAddingSignal] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, sRes, cRes, piRes, plRes, csRes, objRes, sigRes, stRes, ssRes] = await Promise.all([
        fetchContentQueue(),
        fetchContentStats({ days: 30 }),
        fetchPainCategories(),
        fetchPillars(),
        fetchPlatforms(),
        fetchContentStyles(),
        fetchObjectives(),
        fetchPainSignals(),
        fetchSignalTypes().catch(() => ({ data: [] })),
        fetchSignalSources().catch(() => ({ data: [] })),
      ])
      setQueue(qRes.data || [])
      setStats(sRes.data)
      setPainCategories(cRes.data || [])
      setPillars(piRes.data || [])
      setPlatforms(plRes.data || [])
      setContentStyles(csRes.data || [])
      setObjectives(objRes.data || [])
      setSignals(sigRes.data || [])
      setSignalTypes(stRes.data || [])
      setSignalSources(ssRes.data || [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHooks = useCallback(async () => {
    try {
      const res = await fetchHookLibrary()
      setHooks(res.data || [])
    } catch {}
  }, [])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetchGenerationSessions({ limit: 30 })
      setSessions(res.data || [])
    } catch {}
    setSessionsLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (view === 'hooks') loadHooks() }, [view, loadHooks])
  useEffect(() => { if (view === 'sessions') loadSessions() }, [view, loadSessions])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleGenerateBatch = async () => {
    setGenerating(true)
    try {
      await generateContentBatch()
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateSingle = async () => {
    setGenerating(true)
    try {
      await generateContentPiece(genForm)
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleStatusChange = async (id, status) => {
    try {
      await updateContentStatus(id, status)
      setQueue(q => q.map(p => p.id === id ? { ...p, status } : p))
    } catch {}
  }

  const handleSaveHook = async (id) => {
    try {
      await saveContentHook(id)
      setQueue(q => q.map(p => p.id === id ? { ...p, isWinning: true } : p))
    } catch {}
  }

  const handleOpenPiece = useCallback(async (piece) => {
    setActivePiece(piece)
    if (piece.freshnessState === 'new') {
      try {
        await markContentViewed(piece.id)
        setQueue(q => q.map(p => p.id === piece.id ? { ...p, freshnessState: 'viewed' } : p))
      } catch {}
    }
  }, [])

  const handlePerformanceUpdate = async (id, data) => {
    try {
      const res = await updateContentPerformance(id, data)
      if (res.data) setQueue(q => q.map(p => p.id === id ? { ...p, ...res.data } : p))
    } catch {}
  }

  const handleDeactivateHook = async (id) => {
    try {
      await deactivateHook(id)
      setHooks(h => h.filter(x => x.id !== id))
    } catch {}
  }

  const handleAddSignal = async () => {
    if (!newSignal.signal.trim()) return
    setAddingSignal(true)
    try {
      const res = await addPainSignal(newSignal)
      if (res.data) {
        setSignals(s => {
          const idx = s.findIndex(x => x.id === res.data.id)
          if (idx >= 0) return s.map(x => x.id === res.data.id ? res.data : x)
          return [res.data, ...s]
        })
        setNewSignal(p => ({ ...p, signal: '', notes: '' }))
      }
    } catch {}
    setAddingSignal(false)
  }

  const handleDeleteSignal = async (id) => {
    try {
      await deletePainSignal(id)
      setSignals(s => s.filter(x => x.id !== id))
    } catch {}
  }

  // ── Filtered data ────────────────────────────────────────────────────────────

  const filteredQueue = queue.filter(p => {
    if (fPlatform !== 'all' && p.platform !== fPlatform) return false
    if (fPillar !== 'all' && p.pillar !== fPillar) return false
    if (fStatus !== 'all' && p.status !== fStatus) return false
    if (fFreshness === 'new'            && p.freshnessState !== 'new') return false
    if (fFreshness === 'signal'         && !(p.signalInfluenceScore > 0)) return false
    if (fFreshness === 'founder-pov'    && p.generationType !== 'founder-pov') return false
    if (fFreshness === 'viral'          && p.generationType !== 'viral' && p.estimatedReach !== 'viral') return false
    if (fFreshness === 'pain_point'     && p.pillar !== 'pain_point') return false
    if (fFreshness === 'academy'        && p.pillar !== 'academy') return false
    return true
  })

  const filteredSignals = signals.filter(s => {
    if (fSignalType !== 'all' && s.signalType !== fSignalType) return false
    if (fSignalCat !== 'all' && s.painCategory !== fSignalCat) return false
    return true
  })

  // ── Theme ────────────────────────────────────────────────────────────────────

  const bg      = dark ? 'bg-gray-950' : 'bg-gray-50'
  const sidebar  = dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const main     = dark ? 'bg-gray-950' : 'bg-gray-50'
  const text     = dark ? 'text-gray-100' : 'text-gray-900'
  const sub      = dark ? 'text-gray-500' : 'text-gray-400'
  const inputCls = dark
    ? 'bg-gray-800 border-gray-700 text-gray-200 placeholder-gray-600 focus:border-gray-600'
    : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400 focus:border-gray-400'
  const selectCls = dark
    ? 'bg-gray-800 border-gray-700 text-gray-300 focus:border-gray-600'
    : 'bg-white border-gray-200 text-gray-700 focus:border-gray-400'

  // ── Nav items ────────────────────────────────────────────────────────────────

  const newCount = queue.filter(p => p.freshnessState === 'new').length

  const NAV = [
    { id: 'queue',     label: 'Queue',            icon: '▤', badge: filteredQueue.length, alert: newCount > 0 ? newCount : 0 },
    { id: 'sessions',  label: 'Gen Sessions',      icon: '◷', badge: sessions.length },
    { id: 'market',    label: 'Market Signals',    icon: '⊕', badge: 0 },
    { id: 'signals',   label: 'Pain Signals',      icon: '◎', badge: signals.length },
    { id: 'hooks',     label: 'Hook Library',      icon: '★', badge: hooks.length },
    { id: 'analytics', label: 'Analytics',         icon: '◈' },
  ]

  return (
    <div className={`flex h-full overflow-hidden ${bg}`}>

      {/* ── Left sidebar ── */}
      <div className={`flex-shrink-0 flex flex-col border-r ${sidebar}`} style={{ width: 200 }}>
        {/* Branding */}
        <div className={`px-4 py-5 border-b ${dark ? 'border-gray-800' : 'border-gray-100'}`}>
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${sub}`}>Micahskin</p>
          <p className={`text-sm font-bold ${text}`}>Content Studio</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                view === item.id
                  ? dark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                  : dark ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.alert > 0 && (
                <span className={`relative flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${view === item.id ? 'bg-violet-500 text-white' : 'bg-violet-900/60 text-violet-300'}`}>
                  <span className="w-1 h-1 rounded-full bg-violet-300 animate-pulse" />
                  {item.alert}
                </span>
              )}
              {!item.alert && item.badge > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${view === item.id ? (dark ? 'bg-white/20 text-white' : 'bg-gray-900 text-white') : (dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500')}`}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Generate controls */}
        <div className={`px-3 pb-4 border-t pt-3 space-y-2 ${dark ? 'border-gray-800' : 'border-gray-100'}`}>
          <button
            onClick={handleGenerateBatch}
            disabled={generating}
            className="w-full px-3 py-2 text-xs font-bold bg-white text-gray-900 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating…' : '⚡ Auto Generate'}
          </button>
        </div>

        {/* Dark mode toggle */}
        <div className={`px-3 pb-4`}>
          <button
            onClick={() => setDark(d => !d)}
            className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              dark ? 'bg-gray-800 text-gray-400 hover:text-gray-200' : 'bg-gray-100 text-gray-500 hover:text-gray-700'
            }`}
          >
            {dark ? '☀ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className={`flex-1 flex min-w-0 ${main}`}>

        {/* Content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* ════════════════════════════════════════════════════════════
              MARKET SIGNALS VIEW
          ════════════════════════════════════════════════════════════ */}
          {view === 'market' && (
            <div className="flex-1 overflow-hidden">
              <MarketSignalsPanel dark={dark} />
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              GENERATION SESSIONS VIEW (Phase 40)
          ════════════════════════════════════════════════════════════ */}
          {view === 'sessions' && (
            <>
              <div className={`flex-shrink-0 px-6 py-4 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className={`text-lg font-bold ${text}`}>Generation Sessions</h1>
                    <p className={`text-xs mt-0.5 ${sub}`}>{sessions.length} recorded generation runs</p>
                  </div>
                  <button
                    onClick={loadSessions}
                    disabled={sessionsLoading}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${dark ? 'border-gray-700 text-gray-400 hover:border-gray-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {sessionsLoading ? 'Loading…' : '↺ Refresh'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {sessionsLoading && (
                  <p className={`text-sm text-center py-12 ${sub}`}>Loading sessions…</p>
                )}
                {!sessionsLoading && sessions.length === 0 && (
                  <div className="text-center py-12">
                    <p className={`text-sm font-medium ${sub}`}>No generation sessions yet.</p>
                    <p className={`text-xs mt-1 ${sub}`}>Sessions are created automatically when content is generated.</p>
                  </div>
                )}
                {sessions.map(session => {
                  const avgScores = session.averageScores || {}
                  const triggerColors = {
                    batch:            dark ? 'bg-blue-900/40 text-blue-400 ring-1 ring-blue-700'    : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                    manual:           dark ? 'bg-gray-700 text-gray-400 ring-1 ring-gray-600'       : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
                    signal_triggered: dark ? 'bg-violet-900/40 text-violet-400 ring-1 ring-violet-700' : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
                    scheduled:        dark ? 'bg-amber-900/40 text-amber-400 ring-1 ring-amber-700'  : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
                  }
                  const tc = triggerColors[session.triggerType] || triggerColors.manual
                  return (
                    <div key={session.id} className={`border rounded-xl overflow-hidden ${dark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'}`}>
                      <div className={`px-5 py-3.5 flex items-center justify-between border-b ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ${tc}`}>
                            {session.triggerType?.replace(/_/g, ' ') || 'Manual'}
                          </span>
                          {session.batchLabel && (
                            <span className={`text-xs font-semibold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{session.batchLabel}</span>
                          )}
                        </div>
                        <span className={`text-xs ${sub}`}>{timeAgo(session.createdAt)}</span>
                      </div>
                      <div className="px-5 py-4">
                        <div className="grid grid-cols-4 gap-4 mb-4">
                          {[
                            { l: 'Content', v: session.contentCount || 0 },
                            { l: 'Signals Used', v: session.signalCount || 0 },
                            { l: 'Avg Virality', v: avgScores.virality ?? '—' },
                            { l: 'Avg Conversion', v: avgScores.conversion ?? '—' },
                          ].map(kpi => (
                            <div key={kpi.l} className="text-center">
                              <p className={`text-xl font-bold ${dark ? 'text-gray-100' : 'text-gray-900'}`}>{kpi.v}</p>
                              <p className={`text-[10px] uppercase tracking-wide ${sub}`}>{kpi.l}</p>
                            </div>
                          ))}
                        </div>
                        <div className={`flex flex-wrap gap-3 pt-3 border-t ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
                          {session.dominantNiche && (
                            <div className={`text-xs rounded-lg px-3 py-1.5 ${dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                              <span className={`font-bold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>Niche:</span> {fmtLabel(session.dominantNiche)}
                            </div>
                          )}
                          {session.dominantEmotionalCluster && (
                            <div className={`text-xs rounded-lg px-3 py-1.5 ${dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                              <span className={`font-bold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>Cluster:</span> {session.dominantEmotionalCluster}
                            </div>
                          )}
                          {avgScores.overall > 0 && (
                            <div className={`text-xs rounded-lg px-3 py-1.5 ${dark ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                              <span className={`font-bold ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>Avg Score:</span> {avgScores.overall}
                            </div>
                          )}
                          <div className={`ml-auto text-[10px] font-mono ${sub}`}>
                            {new Date(session.createdAt).toLocaleString('en-NG')}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              QUEUE VIEW
          ════════════════════════════════════════════════════════════ */}
          {view === 'queue' && (
            <>
              {/* Top bar */}
              <div className={`flex-shrink-0 px-6 py-4 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className={`text-lg font-bold ${text}`}>Daily Queue</h1>
                    <p className={`text-xs mt-0.5 ${sub}`}>{filteredQueue.length} pieces today</p>
                  </div>
                  <button
                    onClick={handleGenerateSingle}
                    disabled={generating}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                      dark ? 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    + Single Piece
                  </button>
                </div>

                {/* Filters row */}
                <div className="flex gap-3 flex-wrap">
                  {[
                    { label: 'Platform', val: fPlatform, set: setFPlatform, opts: [{ id: 'all', label: 'All Platforms' }, ...platforms] },
                    { label: 'Pillar', val: fPillar, set: setFPillar, opts: [{ id: 'all', label: 'All Pillars' }, ...pillars] },
                    { label: 'Status', val: fStatus, set: setFStatus, opts: [{ id: 'all', label: 'All Status' }, ...Object.entries(STATUS_META).map(([k, v]) => ({ id: k, label: v.label }))] },
                  ].map(f => (
                    <select key={f.label} value={f.val} onChange={e => f.set(e.target.value)}
                      className={`text-xs border rounded-lg px-3 py-1.5 focus:outline-none transition-all ${selectCls}`}>
                      {f.opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  ))}
                </div>

                {/* Freshness / type quick-filter chips */}
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {[
                    { id: 'all',         label: 'All',          dot: null },
                    { id: 'new',         label: 'New',          dot: 'bg-violet-500' },
                    { id: 'signal',      label: 'Signal-Gen',   dot: 'bg-violet-400' },
                    { id: 'founder-pov', label: 'Founder POV',  dot: 'bg-rose-500' },
                    { id: 'viral',       label: 'Viral',        dot: 'bg-emerald-500' },
                    { id: 'pain_point',  label: 'Pain Point',   dot: 'bg-rose-400' },
                    { id: 'academy',     label: 'Academy',      dot: 'bg-amber-500' },
                  ].map(chip => (
                    <button
                      key={chip.id}
                      onClick={() => setFFreshness(chip.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border ${
                        fFreshness === chip.id
                          ? dark ? 'bg-white text-gray-900 border-white' : 'bg-gray-900 text-white border-gray-900'
                          : dark ? 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400' : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      {chip.dot && <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`} />}
                      {chip.label}
                    </button>
                  ))}
                </div>

                {/* Generate form */}
                <details className={`mt-3`}>
                  <summary className={`text-xs cursor-pointer font-medium ${sub} hover:${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                    Configure single piece generation ▾
                  </summary>
                  <div className="grid grid-cols-2 gap-2.5 mt-3">
                    {[
                      { key: 'platform', opts: platforms, label: 'Platform' },
                      { key: 'pillar', opts: pillars, label: 'Pillar' },
                      { key: 'painCategory', opts: painCategories, label: 'Category' },
                      { key: 'contentStyle', opts: contentStyles, label: 'Style' },
                      { key: 'objective', opts: objectives, label: 'Objective' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${sub}`}>{f.label}</label>
                        <select
                          value={genForm[f.key]}
                          onChange={e => setGenForm(p => ({ ...p, [f.key]: e.target.value }))}
                          className={`w-full text-xs border rounded-lg px-2.5 py-1.5 focus:outline-none ${selectCls}`}
                        >
                          {f.opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              {/* Queue list + drawer */}
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                  {error && (
                    <div className="border border-red-200 bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">
                      {error}
                    </div>
                  )}
                  {loading && (
                    <div className={`text-sm text-center py-12 ${sub}`}>Loading content…</div>
                  )}
                  {!loading && filteredQueue.length === 0 && (
                    <div className="text-center py-12">
                      <p className={`text-sm font-medium ${sub}`}>No content for today.</p>
                      <button onClick={handleGenerateBatch} disabled={generating}
                        className="mt-3 px-4 py-2 text-sm font-semibold bg-white text-gray-900 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                        {generating ? 'Generating…' : '⚡ Generate Batch'}
                      </button>
                    </div>
                  )}
                  {filteredQueue.map(piece => (
                    <ContentCard
                      key={piece.id}
                      piece={piece}
                      dark={dark}
                      isActive={activePiece?.id === piece.id}
                      onOpen={handleOpenPiece}
                      onStatusChange={handleStatusChange}
                      onSaveHook={handleSaveHook}
                    />
                  ))}
                </div>

                {/* Right drawer */}
                {activePiece && (
                  <ContentDrawer
                    piece={activePiece}
                    allQueue={filteredQueue}
                    dark={dark}
                    onClose={() => setActivePiece(null)}
                    onStatusChange={handleStatusChange}
                    onSaveHook={handleSaveHook}
                    onPerformanceUpdate={handlePerformanceUpdate}
                  />
                )}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              PAIN SIGNALS VIEW
          ════════════════════════════════════════════════════════════ */}
          {view === 'signals' && (
            <>
              <div className={`flex-shrink-0 px-6 py-4 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className={`text-lg font-bold ${text}`}>Pain Signal Database</h1>
                    <p className={`text-xs mt-0.5 ${sub}`}>Market intelligence from your audience</p>
                  </div>
                </div>

                {/* Add signal form */}
                <div className={`rounded-xl border p-4 mb-4 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${sub}`}>Add Signal</p>
                  <textarea
                    rows={2}
                    placeholder="Enter the pain signal, emotional phrase, frustration, or question…"
                    value={newSignal.signal}
                    onChange={e => setNewSignal(p => ({ ...p, signal: e.target.value }))}
                    className={`w-full text-sm border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 resize-none ${inputCls}`}
                  />
                  <div className="grid grid-cols-3 gap-2.5 mb-3">
                    {[
                      { key: 'signalType', opts: signalTypes.length ? signalTypes : Object.entries(SIGNAL_TYPE_META).map(([k, v]) => ({ id: k, label: v.label })), label: 'Type' },
                      { key: 'painCategory', opts: [{ id: 'general', label: 'General' }, ...painCategories], label: 'Category' },
                      { key: 'source', opts: signalSources.length ? signalSources : [{ id: 'manual', label: 'Manual' }, { id: 'comment', label: 'Comment' }, { id: 'lead', label: 'Lead' }], label: 'Source' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${sub}`}>{f.label}</label>
                        <select
                          value={newSignal[f.key]}
                          onChange={e => setNewSignal(p => ({ ...p, [f.key]: e.target.value }))}
                          className={`w-full text-xs border rounded-lg px-2.5 py-1.5 focus:outline-none ${selectCls}`}
                        >
                          {f.opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Notes (optional) — context, source URL, date…"
                    value={newSignal.notes}
                    onChange={e => setNewSignal(p => ({ ...p, notes: e.target.value }))}
                    className={`w-full text-xs border rounded-lg px-3 py-2 mb-3 focus:outline-none ${inputCls}`}
                  />
                  <button
                    onClick={handleAddSignal}
                    disabled={addingSignal || !newSignal.signal.trim()}
                    className="px-4 py-2 text-xs font-bold bg-white text-gray-900 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  >
                    {addingSignal ? 'Adding…' : '+ Add Signal'}
                  </button>
                </div>

                {/* Filters */}
                <div className="flex gap-2">
                  <select value={fSignalType} onChange={e => setFSignalType(e.target.value)}
                    className={`text-xs border rounded-lg px-3 py-1.5 focus:outline-none ${selectCls}`}>
                    <option value="all">All Types</option>
                    {(signalTypes.length ? signalTypes : Object.entries(SIGNAL_TYPE_META).map(([k, v]) => ({ id: k, label: v.label }))).map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <select value={fSignalCat} onChange={e => setFSignalCat(e.target.value)}
                    className={`text-xs border rounded-lg px-3 py-1.5 focus:outline-none ${selectCls}`}>
                    <option value="all">All Categories</option>
                    {painCategories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {filteredSignals.length === 0 && (
                  <div className="text-center py-12">
                    <p className={`text-sm font-medium mb-1 ${sub}`}>No signals yet.</p>
                    <p className={`text-xs ${sub}`}>Add pain signals from comments, leads, and audience conversations.</p>
                  </div>
                )}
                {filteredSignals.map(signal => (
                  <SignalCard key={signal.id} signal={signal} onDelete={handleDeleteSignal} dark={dark} />
                ))}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              HOOK LIBRARY VIEW
          ════════════════════════════════════════════════════════════ */}
          {view === 'hooks' && (
            <>
              <div className={`flex-shrink-0 px-6 py-4 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
                <h1 className={`text-lg font-bold ${text}`}>Hook Library</h1>
                <p className={`text-xs mt-0.5 ${sub}`}>{hooks.length} winning hooks saved</p>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {hooks.length === 0 && (
                  <div className="text-center py-12">
                    <p className={`text-sm ${sub}`}>No hooks saved yet. Mark content as winning from the queue.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3">
                  {hooks.map(hook => (
                    <HookCard key={hook.id} hook={hook} onDeactivate={handleDeactivateHook} dark={dark} />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              ANALYTICS VIEW
          ════════════════════════════════════════════════════════════ */}
          {view === 'analytics' && stats && (
            <>
              <div className={`flex-shrink-0 px-6 py-4 border-b ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
                <h1 className={`text-lg font-bold ${text}`}>Performance Analytics</h1>
                <p className={`text-xs mt-0.5 ${sub}`}>Last 30 days · {stats.totalPieces} pieces</p>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                {/* KPI row */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { l: 'Total Views', v: stats.totalViews?.toLocaleString() || 0, c: dark ? 'text-white' : 'text-gray-900' },
                    { l: 'Total Saves', v: stats.totalSaves?.toLocaleString() || 0, c: dark ? 'text-blue-400' : 'text-blue-700' },
                    { l: 'Total Leads', v: stats.totalLeads || 0, c: dark ? 'text-purple-400' : 'text-purple-700' },
                    { l: 'Conversion Rate', v: `${stats.conversionRate || 0}%`, c: dark ? 'text-emerald-400' : 'text-emerald-700' },
                  ].map(kpi => (
                    <div key={kpi.l} className={`border rounded-xl p-5 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-white'}`}>
                      <p className={`text-xs mb-2 ${sub}`}>{kpi.l}</p>
                      <p className={`text-2xl font-bold ${kpi.c}`}>{kpi.v}</p>
                    </div>
                  ))}
                </div>

                {/* AI Scores summary */}
                {stats.avgScores && (
                  <div className={`border rounded-xl p-5 ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-white'}`}>
                    <p className={`text-xs font-bold uppercase tracking-widest mb-4 ${sub}`}>Average Content Intelligence Scores</p>
                    <div className="grid grid-cols-2 gap-4">
                      <ScoreMeter label="Hook Power" score={stats.avgScores.hook} dark={dark} />
                      <ScoreMeter label="Emotional Depth" score={stats.avgScores.emotional} dark={dark} />
                      <ScoreMeter label="Virality Potential" score={stats.avgScores.virality} dark={dark} />
                      <ScoreMeter label="Conversion Power" score={stats.avgScores.conversion} dark={dark} />
                      <ScoreMeter label="Authority Signal" score={stats.avgScores.authority} dark={dark} />
                      <ScoreMeter label="Overall Score" score={stats.avgScores.overall} dark={dark} />
                    </div>
                  </div>
                )}

                {/* Top performers */}
                {stats.topPerformers?.length > 0 && (
                  <div className={`border rounded-xl ${dark ? 'border-gray-700' : 'border-gray-200'} overflow-hidden`}>
                    <div className={`px-5 py-3 border-b ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
                      <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>Top Performers by Views</p>
                    </div>
                    <div className={dark ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'}>
                      {stats.topPerformers.map((p, i) => (
                        <div key={p.id} className={`flex items-center gap-4 px-5 py-3 ${dark ? 'bg-gray-800/30' : 'bg-white'}`}>
                          <span className={`text-xs font-bold w-5 text-center ${sub}`}>{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${dark ? 'text-gray-200' : 'text-gray-800'}`}>"{p.hook}"</p>
                            <p className={`text-xs ${sub}`}>{fmtLabel(p.platform)}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{p.views?.toLocaleString()}</p>
                            <p className={`text-xs ${sub}`}>{p.conversionRate}% conv</p>
                          </div>
                          {p.overallScore > 0 && (
                            <ScoreBadge label="Score" score={p.overallScore} dark={dark} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Platform + Pillar breakdown */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'By Platform', data: stats.byPlatform },
                    { label: 'By Pillar', data: stats.byPillar },
                  ].map(({ label, data }) => (
                    <div key={label} className={`border rounded-xl ${dark ? 'border-gray-700' : 'border-gray-200'} overflow-hidden`}>
                      <div className={`px-4 py-3 border-b ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
                        <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>{label}</p>
                      </div>
                      <div className={`p-4 space-y-2 ${dark ? 'bg-gray-800/30' : 'bg-white'}`}>
                        {Object.entries(data || {}).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between">
                            <span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{fmtLabel(k)}</span>
                            <span className={`text-xs font-bold ${dark ? 'text-gray-300' : 'text-gray-800'}`}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Reach distribution */}
                {stats.byEstimatedReach && Object.keys(stats.byEstimatedReach).length > 0 && (
                  <div className={`border rounded-xl ${dark ? 'border-gray-700' : 'border-gray-200'} overflow-hidden`}>
                    <div className={`px-4 py-3 border-b ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
                      <p className={`text-xs font-bold uppercase tracking-widest ${sub}`}>Estimated Reach Distribution</p>
                    </div>
                    <div className={`p-4 flex flex-wrap gap-3 ${dark ? 'bg-gray-800/30' : 'bg-white'}`}>
                      {Object.entries(stats.byEstimatedReach).map(([reach, count]) => {
                        const meta = REACH_META[reach]
                        return meta ? (
                          <div key={reach} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${dark ? meta.darkBg : meta.bg}`}>
                            <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                            <span className="text-xs font-semibold">{meta.label}</span>
                            <span className="text-xs font-bold">{count}</span>
                          </div>
                        ) : null
                      })}
                    </div>
                  </div>
                )}

              </div>
            </>
          )}

          {view === 'analytics' && !stats && (
            <div className="flex-1 flex items-center justify-center">
              <p className={`text-sm ${sub}`}>Loading analytics…</p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
