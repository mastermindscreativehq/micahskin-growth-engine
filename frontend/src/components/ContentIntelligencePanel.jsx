import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchContentQueue, generateContentBatch, generateContentPiece,
  updateContentStatus, updateContentPerformance, saveContentHook,
  fetchHookLibrary, deactivateHook, fetchContentStats,
  fetchPainCategories, fetchPillars, fetchPlatforms,
  fetchContentStyles, fetchObjectives,
} from '../api'

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_META = {
  tiktok:           { label: 'TikTok',           dot: 'bg-pink-500',   pill: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200' },
  instagram_reel:   { label: 'Instagram Reels',  dot: 'bg-purple-500', pill: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  facebook:         { label: 'Facebook',          dot: 'bg-blue-500',   pill: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  whatsapp_status:  { label: 'WhatsApp Status',  dot: 'bg-green-500',  pill: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
}

const PILLAR_META = {
  pain_point:     { label: 'Pain Point',      pill: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  academy:        { label: 'Academy',         pill: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  growth_os:      { label: 'Growth OS',       pill: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' },
  authority:      { label: 'Authority',       pill: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  conversion_cta: { label: 'Conversion CTA',  pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
}

const STATUS_META = {
  draft:     { label: 'Draft',     bar: 'bg-gray-300',   pill: 'bg-gray-100 text-gray-500' },
  approved:  { label: 'Approved',  bar: 'bg-blue-400',   pill: 'bg-blue-50 text-blue-600' },
  scheduled: { label: 'Scheduled', bar: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-600' },
  posted:    { label: 'Posted',    bar: 'bg-emerald-400', pill: 'bg-emerald-50 text-emerald-700' },
  archived:  { label: 'Archived',  bar: 'bg-gray-200',   pill: 'bg-gray-50 text-gray-400' },
}

// ── Utility ───────────────────────────────────────────────────────────────────

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

// ── Primitive components ──────────────────────────────────────────────────────

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function CopyBtn({ text, label = 'Copy', compact = false }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }) }}
      className={`inline-flex items-center gap-1 font-medium rounded-lg border transition-all ${
        compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs'
      } ${copied ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'}`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

function FieldLabel({ children }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{children}</p>
}

function SelectField({ label, value, onChange, options, placeholder }) {
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 transition-all"
      >
        {placeholder && <option value="all">{placeholder}</option>}
        {options.map(o => <option key={o.id || o} value={o.id || o}>{o.label || o}</option>)}
      </select>
    </div>
  )
}

// ── Dropdown menu ─────────────────────────────────────────────────────────────

function CardMenu({ piece, onStatusChange, onSaveHook }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const actions = [
    { label: 'Mark Approved', fn: () => onStatusChange(piece.id, 'approved'), disabled: piece.status === 'approved' || piece.status === 'posted' },
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
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-48 bg-white rounded-xl border border-gray-200 shadow-xl py-1 overflow-hidden">
          {actions.map((action, i) =>
            action === null
              ? <div key={i} className="my-1 border-t border-gray-100" />
              : (
                <button
                  key={action.label}
                  disabled={action.disabled}
                  onClick={() => { action.fn(); setOpen(false) }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-default transition-colors"
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

// ── Queue card ─────────────────────────────────────────────────────────────────

function QueueCard({ piece, onStatusChange, onSaveHook, onOpen, isActive }) {
  const body = parseBody(piece.body)
  const title = body.content_title || piece.hook?.substring(0, 80) || 'Untitled'
  const sm = STATUS_META[piece.status] || STATUS_META.draft
  const pm = PLATFORM_META[piece.platform]
  const pilm = PILLAR_META[piece.pillar]
  const hasPerf = piece.views > 0

  return (
    <div
      onClick={() => onOpen(piece)}
      className={`group relative bg-white rounded-xl border transition-all cursor-pointer overflow-hidden ${
        isActive
          ? 'border-gray-900 shadow-md'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {/* Status bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${sm.bar}`} />

      <div className="pl-5 pr-4 py-4">
        {/* Title */}
        <h3 className="text-[14px] font-semibold text-gray-900 leading-snug mb-3 pr-2">
          {title}
        </h3>

        {/* Pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pm && <Pill className={pm.pill}>{pm.label}</Pill>}
          {pilm && <Pill className={pilm.pill}>{pilm.label}</Pill>}
          {piece.painCategory && (
            <Pill className="bg-gray-50 text-gray-500 ring-1 ring-gray-200">{fmtLabel(piece.painCategory)}</Pill>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-50">
          <div className="flex items-center gap-2">
            <Pill className={sm.pill}>{sm.label}</Pill>
            {piece.isWinning && (
              <span className="text-xs text-amber-600 font-semibold">★ Hook</span>
            )}
            {hasPerf && (
              <span className="text-xs text-gray-400">{piece.views.toLocaleString()} views</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <CardMenu piece={piece} onStatusChange={onStatusChange} onSaveHook={onSaveHook} />
            <button
              onClick={e => { e.stopPropagation(); onOpen(piece) }}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Open →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Script viewer (right drawer) ──────────────────────────────────────────────

function ScriptViewer({ piece, allQueue, onClose, onStatusChange, onSaveHook, onPerformanceUpdate }) {
  const [tab, setTab] = useState('script')
  const [currentId, setCurrentId] = useState(piece.id)
  const current = allQueue.find(p => p.id === currentId) || piece
  const body = parseBody(current.body)
  const idx = allQueue.findIndex(p => p.id === currentId)

  const isVideo = current.contentType === 'short_form_video'
  const isWhatsApp = current.contentType === 'whatsapp_status'

  // Support both legacy "scenes" and new "segments"
  const segments = body.segments || body.scenes || []

  const fullScript = body.full_script || body.full_video_script || body.voiceover_script ||
    (segments.length ? segments.map(s => `[${s.segment_title || s.scene_title}]\n${s.voiceover || ''}`).join('\n\n') : current.hook)

  const shotListText = body.shot_list
    ? body.shot_list.map(s => `${s.shot_number}. ${s.shot_type} — ${s.description}`).join('\n')
    : (body.status_slides
      ? body.status_slides.map(s => `Slide ${s.slide_number}:\n${s.slide_text}`).join('\n\n')
      : 'No shot list')

  const TABS = [
    { id: 'script',      label: 'Script' },
    { id: 'caption',     label: 'Caption' },
    { id: 'shotlist',    label: isWhatsApp ? 'Slides' : 'Shot List' },
    { id: 'cta',         label: 'CTA' },
    { id: 'production',  label: 'Production' },
    { id: 'performance', label: 'Performance' },
  ]

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200" style={{ width: 580, flexShrink: 0 }}>

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              {body.content_structure_type ? fmtLabel(body.content_structure_type) : fmtLabel(current.contentType)}
            </p>
            <h2 className="text-base font-bold text-gray-900 leading-tight">
              {body.content_title || current.hook?.substring(0, 70) || 'Content Script'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PLATFORM_META[current.platform] && <Pill className={PLATFORM_META[current.platform].pill}>{PLATFORM_META[current.platform].label}</Pill>}
          {PILLAR_META[current.pillar] && <Pill className={PILLAR_META[current.pillar].pill}>{PILLAR_META[current.pillar].label}</Pill>}
          {current.painCategory && <Pill className="bg-gray-50 text-gray-500 ring-1 ring-gray-200">{fmtLabel(current.painCategory)}</Pill>}
          {body._contentStyle && body._contentStyle !== 'auto' && <Pill className="bg-slate-50 text-slate-600 ring-1 ring-slate-200">{body._contentStyle}</Pill>}
          {body._objective && body._objective !== 'auto' && <Pill className="bg-violet-50 text-violet-600 ring-1 ring-violet-200">{body._objective}</Pill>}
        </div>

        {body.target_audience && (
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            <span className="font-semibold text-gray-600">Audience:</span> {body.target_audience}
          </p>
        )}

        {/* Nav between pieces */}
        {allQueue.length > 1 && (
          <div className="flex items-center gap-2 mb-3">
            <button disabled={idx <= 0} onClick={() => setCurrentId(allQueue[idx - 1].id)}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40">← Prev</button>
            <span className="text-xs text-gray-400 font-medium">{idx + 1} / {allQueue.length}</span>
            <button disabled={idx >= allQueue.length - 1} onClick={() => setCurrentId(allQueue[idx + 1].id)}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next →</button>
          </div>
        )}

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={current.status}
            onChange={e => onStatusChange(current.id, e.target.value)}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border-0 outline-none cursor-pointer ${STATUS_META[current.status]?.pill || 'bg-gray-100 text-gray-500'}`}
          >
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button onClick={() => onStatusChange(current.id, 'approved')}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Approve
          </button>
          <button onClick={() => onStatusChange(current.id, 'posted')}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
            Mark Posted
          </button>
          <button
            onClick={() => onSaveHook(current.id)}
            disabled={current.isWinning}
            className={`ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              current.isWinning ? 'bg-amber-50 text-amber-700 cursor-default' : 'bg-amber-400 text-amber-900 hover:bg-amber-500'
            }`}
          >
            {current.isWinning ? '★ Hook Saved' : '☆ Save Hook'}
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex-shrink-0 flex border-b border-gray-100 bg-gray-50 px-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* ── SCRIPT TAB ── */}
        {tab === 'script' && (
          <>
            {/* Hook callout */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>Opening Hook</FieldLabel>
                <CopyBtn text={current.hook} label="Copy Hook" compact />
              </div>
              <p className="text-sm font-bold text-gray-900 leading-snug">"{current.hook}"</p>
            </div>

            {/* Video segments (new "segments" or legacy "scenes") */}
            {isVideo && segments.length > 0 && segments.map(seg => {
              const num = seg.segment_number ?? seg.scene_number
              const title = seg.segment_title ?? seg.scene_title
              const dur = seg.duration
              return (
                <div key={num} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-900 text-white px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-bold tracking-wide">
                      {num ? `${num}. ` : ''}{title?.toUpperCase() || 'SEGMENT'}
                    </span>
                    {dur && <span className="text-xs text-gray-400">{dur}</span>}
                  </div>
                  <div className="p-4 space-y-3">
                    {seg.visual_direction && (
                      <div>
                        <FieldLabel>Camera / Visual</FieldLabel>
                        <p className="text-sm text-gray-800">{seg.visual_direction}</p>
                      </div>
                    )}
                    {seg.acting_direction && (
                      <div>
                        <FieldLabel>Acting Direction</FieldLabel>
                        <p className="text-sm text-blue-700 italic">{seg.acting_direction}</p>
                      </div>
                    )}
                    {seg.on_screen_text && (
                      <div>
                        <FieldLabel>On-Screen Text</FieldLabel>
                        <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-xs font-mono">
                          {seg.on_screen_text}
                        </div>
                      </div>
                    )}
                    {seg.voiceover && (
                      <div>
                        <FieldLabel>Voiceover</FieldLabel>
                        <p className="text-sm text-gray-800">{seg.voiceover}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* WhatsApp slides */}
            {isWhatsApp && body.status_slides?.map(slide => (
              <div key={slide.slide_number} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <Pill className="bg-green-50 text-green-700 ring-1 ring-green-200">Slide {slide.slide_number}</Pill>
                  <CopyBtn text={slide.slide_text} label="Copy" compact />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-2">{slide.slide_text}</p>
                {slide.image_video_idea && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-2">
                    <span className="font-semibold">Visual:</span> {slide.image_video_idea}
                  </p>
                )}
                {slide.cta && <p className="text-xs text-blue-600 font-semibold">→ {slide.cta}</p>}
              </div>
            ))}

            {/* Facebook educational post */}
            {!isVideo && !isWhatsApp && body.educational_post && (
              <div className="space-y-3">
                <div className="border border-gray-200 rounded-xl p-4">
                  <FieldLabel>Intro</FieldLabel>
                  <p className="text-sm text-gray-800 leading-relaxed">{body.educational_post.intro}</p>
                </div>
                {(body.educational_post.body_paragraphs || []).map((para, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <FieldLabel>Paragraph {i + 2}</FieldLabel>
                    <p className="text-sm text-gray-800 leading-relaxed">{para}</p>
                  </div>
                ))}
                {body.educational_post.conclusion && (
                  <div className="border border-gray-200 rounded-xl p-4">
                    <FieldLabel>Conclusion</FieldLabel>
                    <p className="text-sm text-gray-800 leading-relaxed">{body.educational_post.conclusion}</p>
                  </div>
                )}
              </div>
            )}

            {/* Carousel slides */}
            {!isVideo && !isWhatsApp && !body.educational_post && body.hook_slide && (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <Pill className="bg-amber-100 text-amber-700 mb-2 inline-flex">Hook Slide</Pill>
                  <p className="text-sm font-bold text-gray-900 mt-1">{body.hook_slide.heading}</p>
                  <p className="text-sm text-gray-600 mt-1">{body.hook_slide.body}</p>
                </div>
                {(body.problem_slides || []).map(sl => (
                  <div key={sl.slide_number} className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                    <Pill className="bg-rose-100 text-rose-700 mb-2 inline-flex">Problem {sl.slide_number}</Pill>
                    <p className="text-sm font-bold text-gray-900 mt-1">{sl.heading}</p>
                    <p className="text-sm text-gray-600 mt-1">{sl.body}</p>
                  </div>
                ))}
                {(body.solution_slides || []).map(sl => (
                  <div key={sl.slide_number} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                    <Pill className="bg-emerald-100 text-emerald-700 mb-2 inline-flex">Solution {sl.slide_number}</Pill>
                    <p className="text-sm font-bold text-gray-900 mt-1">{sl.heading}</p>
                    <p className="text-sm text-gray-600 mt-1">{sl.body}</p>
                  </div>
                ))}
                {body.cta_slide && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <Pill className="bg-blue-100 text-blue-700 mb-2 inline-flex">CTA Slide</Pill>
                    <p className="text-sm font-bold text-gray-900 mt-1">{body.cta_slide.heading}</p>
                    <p className="text-sm text-gray-600 mt-1">{body.cta_slide.body}</p>
                    {body.cta_slide.cta_text && <p className="text-xs text-blue-700 font-bold mt-2">→ {body.cta_slide.cta_text}</p>}
                  </div>
                )}
              </div>
            )}

            {/* Full script block */}
            {isVideo && fullScript && (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>Full Script (Continuous Read)</FieldLabel>
                  <CopyBtn text={fullScript} label="Copy Full Script" compact />
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{fullScript}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <CopyBtn text={fullScript} label="Copy Full Script" />
              {body.voiceover_script && <CopyBtn text={body.voiceover_script} label="Copy Voiceover" />}
            </div>
          </>
        )}

        {/* ── CAPTION TAB ── */}
        {tab === 'caption' && (
          <>
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldLabel>Post Caption</FieldLabel>
                <CopyBtn text={body.caption || current.cta} label="Copy Caption" compact />
              </div>
              <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{body.caption || current.cta}</p>
            </div>

            {body.hashtags?.length > 0 && (
              <div className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>Hashtags</FieldLabel>
                  <CopyBtn text={body.hashtags.join(' ')} label="Copy All" compact />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {body.hashtags.map((tag, i) => (
                    <span key={i} className="text-xs text-blue-600 bg-blue-50 rounded-md px-2 py-0.5 font-medium">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {body.posting_angle && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <FieldLabel>Posting Angle</FieldLabel>
                <p className="text-sm text-gray-800 leading-relaxed">{body.posting_angle}</p>
              </div>
            )}
          </>
        )}

        {/* ── SHOT LIST / SLIDES TAB ── */}
        {tab === 'shotlist' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-gray-700">{isWhatsApp ? 'Status Slides' : 'Shot List'}</h3>
              <CopyBtn text={shotListText} label={isWhatsApp ? 'Copy All Slides' : 'Copy Shot List'} compact />
            </div>

            {isWhatsApp && body.status_slides?.map(sl => (
              <div key={sl.slide_number} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <Pill className="bg-green-50 text-green-700 ring-1 ring-green-200">Slide {sl.slide_number}</Pill>
                  <CopyBtn text={sl.slide_text} label="Copy" compact />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-2">{sl.slide_text}</p>
                {sl.image_video_idea && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-2"><span className="font-semibold">Visual:</span> {sl.image_video_idea}</p>
                )}
                <p className="text-xs text-blue-600 font-semibold">→ {sl.cta}</p>
              </div>
            ))}

            {!isWhatsApp && body.shot_list?.map(shot => (
              <div key={shot.shot_number} className="flex gap-3 items-start border border-gray-100 rounded-xl p-4">
                <div className="w-7 h-7 rounded-lg bg-gray-900 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {shot.shot_number}
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase mb-0.5">{shot.shot_type}</p>
                  <p className="text-sm text-gray-800">{shot.description}</p>
                </div>
              </div>
            ))}

            {!isWhatsApp && !body.shot_list && (
              <p className="text-sm text-gray-400 italic">Shot list not available for this piece.</p>
            )}
          </>
        )}

        {/* ── CTA TAB ── */}
        {tab === 'cta' && (
          <>
            {[
              { label: 'Primary CTA', text: current.cta, bg: 'bg-blue-50 border-blue-100' },
              { label: 'Telegram CTA', text: current.telegramCta || body.telegram_cta, bg: 'bg-indigo-50 border-indigo-100' },
              body.academy_cta && { label: 'Academy CTA', text: body.academy_cta, bg: 'bg-amber-50 border-amber-100' },
              body.growth_os_cta && { label: 'Growth OS CTA', text: body.growth_os_cta, bg: 'bg-violet-50 border-violet-100' },
            ].filter(Boolean).map(item => (
              <div key={item.label} className={`border rounded-xl p-4 ${item.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>{item.label}</FieldLabel>
                  <CopyBtn text={item.text} label="Copy" compact />
                </div>
                <p className="text-sm font-semibold text-gray-900">{item.text}</p>
              </div>
            ))}

            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>All CTAs Combined</FieldLabel>
                <CopyBtn text={[current.cta, current.telegramCta || body.telegram_cta, body.academy_cta, body.growth_os_cta].filter(Boolean).join('\n\n')} label="Copy All" compact />
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2.5 leading-relaxed">
                {[current.cta, current.telegramCta || body.telegram_cta, body.academy_cta, body.growth_os_cta].filter(Boolean).join('\n\n')}
              </pre>
            </div>
          </>
        )}

        {/* ── PRODUCTION TAB ── */}
        {tab === 'production' && (
          <>
            {body.props_needed?.length > 0 && (
              <div className="border border-gray-100 rounded-xl p-4">
                <FieldLabel>Props Needed</FieldLabel>
                <ul className="mt-1 space-y-1.5">
                  {body.props_needed.map((prop, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                      {prop}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {body.suggested_music_mood && (
              <div className="border border-gray-100 rounded-xl p-4">
                <FieldLabel>Music Mood</FieldLabel>
                <p className="text-sm text-gray-800 mt-1">{body.suggested_music_mood}</p>
              </div>
            )}

            {body.filming_instructions && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <FieldLabel>Filming Instructions</FieldLabel>
                <p className="text-sm text-gray-800 mt-1 leading-relaxed">{body.filming_instructions}</p>
              </div>
            )}

            {body.editing_instructions && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                <FieldLabel>Editing Instructions</FieldLabel>
                <p className="text-sm text-gray-800 mt-1 leading-relaxed">{body.editing_instructions}</p>
              </div>
            )}

            {body.posting_angle && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <FieldLabel>Posting Angle</FieldLabel>
                <p className="text-sm text-gray-800 mt-1">{body.posting_angle}</p>
              </div>
            )}

            {!body.props_needed && !body.filming_instructions && !body.editing_instructions && (
              <p className="text-sm text-gray-400 italic">Production notes not available.</p>
            )}
          </>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === 'performance' && (
          <>
            <div className="border border-gray-100 rounded-xl p-4">
              <FieldLabel>Track Performance</FieldLabel>
              <div className="grid grid-cols-3 gap-3 mt-2">
                {['views', 'leads', 'conversions'].map(metric => (
                  <div key={metric}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 capitalize">{metric}</label>
                    <input
                      type="number"
                      defaultValue={current[metric] || 0}
                      min={0}
                      onBlur={e => onPerformanceUpdate(current.id, { [metric]: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />
                  </div>
                ))}
              </div>
            </div>

            {(current.views > 0 || current.leads > 0 || current.conversions > 0) && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Views', value: current.views?.toLocaleString() || 0, color: 'text-gray-900' },
                  { label: 'Leads', value: current.leads || 0, color: 'text-purple-700' },
                  { label: 'Conversions', value: current.conversions || 0, color: 'text-emerald-700' },
                ].map(kpi => (
                  <div key={kpi.label} className="border border-gray-100 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-400 mb-1">{kpi.label}</p>
                    <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="border border-gray-100 rounded-xl p-4">
              <FieldLabel>Content Metadata</FieldLabel>
              <div className="space-y-1.5 mt-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Model used</span>
                  <span className="font-mono text-gray-700 font-medium">{current.claudeModel || '—'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Generated</span>
                  <span className="text-gray-700 font-medium">{fmtDate(current.createdAt)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Mode</span>
                  <span className="text-gray-700 font-medium capitalize">{current.generationMode}</span>
                </div>
                {body._contentStyle && body._contentStyle !== 'auto' && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Style</span>
                    <span className="text-gray-700 font-medium">{body._contentStyle}</span>
                  </div>
                )}
                {body._objective && body._objective !== 'auto' && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Objective</span>
                    <span className="text-gray-700 font-medium">{body._objective}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ── Hook card ─────────────────────────────────────────────────────────────────

function HookCard({ hook, onDeactivate }) {
  const pm = PLATFORM_META[hook.platform]
  const pilm = PILLAR_META[hook.pillar]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-all">
      <div className="flex flex-wrap gap-1.5">
        {pm && <Pill className={pm.pill}>{pm.label}</Pill>}
        {pilm && <Pill className={pilm.pill}>{pilm.label}</Pill>}
        {hook.painCategory && <Pill className="bg-gray-50 text-gray-500 ring-1 ring-gray-200">{fmtLabel(hook.painCategory)}</Pill>}
        {hook.hookType && <Pill className="bg-slate-50 text-slate-500 ring-1 ring-slate-200">{hook.hookType}</Pill>}
      </div>
      <p className="text-sm font-semibold text-gray-900 italic leading-snug">"{hook.hook}"</p>
      {hook.performanceNote && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{hook.performanceNote}</p>
      )}
      <div className="flex gap-2 pt-1 border-t border-gray-100">
        <CopyBtn text={hook.hook} label="Copy Hook" />
        <button
          onClick={() => onDeactivate(hook.id)}
          className="px-3 py-1.5 text-xs font-medium bg-red-50 border border-red-100 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContentIntelligencePanel() {
  const [activeTab, setActiveTab]       = useState('queue')
  const [queue, setQueue]               = useState([])
  const [hooks, setHooks]               = useState([])
  const [stats, setStats]               = useState(null)
  const [painCategories, setPainCategories] = useState([])
  const [pillars, setPillars]           = useState([])
  const [platforms, setPlatforms]       = useState([])
  const [contentStyles, setContentStyles] = useState([])
  const [objectives, setObjectives]     = useState([])
  const [loading, setLoading]           = useState(false)
  const [generating, setGenerating]     = useState(false)
  const [error, setError]               = useState(null)
  const [activePiece, setActivePiece]   = useState(null)
  const [sidebarOpen, setSidebarOpen]   = useState(true)

  // Filters
  const [fPlatform, setFPlatform] = useState('all')
  const [fPillar, setFPillar]     = useState('all')
  const [fPain, setFPain]         = useState('all')
  const [fStatus, setFStatus]     = useState('all')

  // Generate form
  const [genForm, setGenForm] = useState({
    platform: 'tiktok',
    pillar: 'pain_point',
    painCategory: 'acne',
    contentStyle: 'auto',
    objective: 'auto',
  })

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, sRes, cRes, piRes, plRes, csRes, objRes] = await Promise.all([
        fetchContentQueue(),
        fetchContentStats({ days: 30 }),
        fetchPainCategories(),
        fetchPillars(),
        fetchPlatforms(),
        fetchContentStyles(),
        fetchObjectives(),
      ])
      setQueue(qRes.data || [])
      setStats(sRes.data)
      setPainCategories(cRes.data || [])
      setPillars(piRes.data || [])
      setPlatforms(plRes.data || [])
      setContentStyles(csRes.data || [])
      setObjectives(objRes.data || [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load content')
    }
    setLoading(false)
  }, [])

  const loadHooks = useCallback(async () => {
    try {
      const result = await fetchHookLibrary()
      setHooks(result.data || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (activeTab === 'hooks') loadHooks() }, [activeTab, loadHooks])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleGenerateBatch = async () => {
    setGenerating(true)
    try {
      const result = await generateContentBatch({ count: 10 })
      if (result.data && Array.isArray(result.data)) setQueue(result.data)
      else await loadAll()
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to generate batch')
    }
    setGenerating(false)
  }

  const handleGenerateSingle = async () => {
    setGenerating(true)
    try {
      const payload = {
        ...genForm,
        contentStyle: genForm.contentStyle === 'auto' ? null : genForm.contentStyle,
        objective: genForm.objective === 'auto' ? null : genForm.objective,
      }
      const result = await generateContentPiece(payload)
      if (result.data) {
        setQueue(prev => [result.data, ...prev])
        setActivePiece(result.data)
      }
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to generate content')
    }
    setGenerating(false)
  }

  const handleStatusChange = async (pieceId, newStatus) => {
    try {
      await updateContentStatus(pieceId, newStatus)
      setQueue(prev => prev.map(p => p.id === pieceId ? { ...p, status: newStatus } : p))
      if (activePiece?.id === pieceId) setActivePiece(prev => ({ ...prev, status: newStatus }))
    } catch (err) { setError(err.message) }
  }

  const handlePerformanceUpdate = async (pieceId, updates) => {
    try {
      await updateContentPerformance(pieceId, updates)
      setQueue(prev => prev.map(p => p.id === pieceId ? { ...p, ...updates } : p))
    } catch (err) { setError(err.message) }
  }

  const handleSaveHook = async (pieceId) => {
    try {
      await saveContentHook(pieceId)
      setQueue(prev => prev.map(p => p.id === pieceId ? { ...p, isWinning: true } : p))
      if (activePiece?.id === pieceId) setActivePiece(prev => ({ ...prev, isWinning: true }))
      if (activeTab === 'hooks') await loadHooks()
    } catch (err) { setError(err.message) }
  }

  const handleDeactivateHook = async (hookId) => {
    try {
      await deactivateHook(hookId)
      setHooks(prev => prev.filter(h => h.id !== hookId))
    } catch (err) { setError(err.message) }
  }

  // ── Filtered queue ────────────────────────────────────────────────────────────

  const filteredQueue = queue.filter(p => {
    if (fPlatform !== 'all' && p.platform !== fPlatform) return false
    if (fPillar !== 'all' && p.pillar !== fPillar) return false
    if (fPain !== 'all' && p.painCategory !== fPain) return false
    if (fStatus !== 'all' && p.status !== fStatus) return false
    return true
  })

  const hasFilters = fPlatform !== 'all' || fPillar !== 'all' || fPain !== 'all' || fStatus !== 'all'

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex bg-gray-50 min-h-screen" style={{ maxHeight: '100vh', overflow: 'hidden' }}>

      {/* ── LEFT SIDEBAR ── */}
      {sidebarOpen && (
        <aside className="flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto flex flex-col" style={{ width: 224 }}>

          {/* Brand mark */}
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Content Studio</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">Micahskin Intelligence</p>
          </div>

          {/* Filters */}
          <div className="px-4 py-4 border-b border-gray-100 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Filters</p>

            <SelectField label="Platform" value={fPlatform} onChange={setFPlatform}
              options={[{ id: 'all', label: 'All Platforms' }, ...platforms]} />
            <SelectField label="Pillar" value={fPillar} onChange={setFPillar}
              options={[{ id: 'all', label: 'All Pillars' }, ...pillars]} />
            <SelectField label="Category" value={fPain} onChange={setFPain}
              options={[{ id: 'all', label: 'All Categories' }, ...painCategories]} />
            <SelectField label="Status" value={fStatus} onChange={setFStatus}
              options={[
                { id: 'all', label: 'All Statuses' },
                ...Object.entries(STATUS_META).map(([k, v]) => ({ id: k, label: v.label }))
              ]} />

            {hasFilters && (
              <button
                onClick={() => { setFPlatform('all'); setFPillar('all'); setFPain('all'); setFStatus('all') }}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Generate */}
          <div className="px-4 py-4 border-b border-gray-100 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Generate Single</p>

            <SelectField label="Platform" value={genForm.platform} onChange={v => setGenForm(f => ({ ...f, platform: v }))}
              options={platforms} />
            <SelectField label="Pillar / Angle" value={genForm.pillar} onChange={v => setGenForm(f => ({ ...f, pillar: v }))}
              options={pillars} />
            <SelectField label="Category" value={genForm.painCategory} onChange={v => setGenForm(f => ({ ...f, painCategory: v }))}
              options={painCategories} />
            <SelectField label="Content Style" value={genForm.contentStyle} onChange={v => setGenForm(f => ({ ...f, contentStyle: v }))}
              options={contentStyles} />
            <SelectField label="Objective" value={genForm.objective} onChange={v => setGenForm(f => ({ ...f, objective: v }))}
              options={objectives} />

            <button
              onClick={handleGenerateSingle}
              disabled={generating}
              className="w-full py-2.5 text-sm font-bold bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generating…' : 'Generate Piece'}
            </button>
          </div>

          {/* Quick stats */}
          <div className="px-4 py-4 space-y-2 mt-auto">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Queue Stats</p>
            {[
              ['Total pieces', queue.length],
              ['Showing', filteredQueue.length],
              ['Posted (30d)', stats?.byStatus?.posted || 0],
              ['Leads (30d)', stats?.totalLeads || 0],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="font-bold text-gray-800">{value}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header className="flex-shrink-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Tab nav */}
            <div className="flex items-center gap-0.5">
              {[
                { id: 'queue',     label: 'Daily Queue' },
                { id: 'hooks',     label: 'Hook Library' },
                { id: 'analytics', label: 'Analytics' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                    activeTab === tab.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-100 text-red-700 rounded-lg text-xs font-medium">
                {error}
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold">✕</button>
              </div>
            )}
            <button onClick={loadAll} disabled={loading}
              className="px-3 py-2 text-xs font-semibold border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button onClick={handleGenerateBatch} disabled={generating}
              className="px-4 py-2 text-xs font-bold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
              {generating ? 'Generating…' : "Generate Today's Batch"}
            </button>
          </div>
        </header>

        {/* Content area: queue + optional right drawer */}
        <div className="flex flex-1 overflow-hidden">

          {/* Center scroll area */}
          <div className="flex-1 overflow-y-auto p-5">

            {/* ── QUEUE TAB ── */}
            {activeTab === 'queue' && (
              <>
                {generating && (
                  <div className="mb-4 flex items-center gap-2.5 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 font-medium">
                    <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Generating production scripts… this may take 30–60 seconds.
                  </div>
                )}

                {filteredQueue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-32 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-5">
                      <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">
                      {queue.length === 0 ? 'No content in queue' : 'No content matches filters'}
                    </p>
                    <p className="text-xs text-gray-400 mb-5">
                      {queue.length === 0 ? 'Generate today\'s batch to get production-ready scripts' : 'Try adjusting the filters in the sidebar'}
                    </p>
                    {queue.length === 0 && (
                      <button onClick={handleGenerateBatch} disabled={generating}
                        className="px-5 py-2.5 text-sm font-bold bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors">
                        Generate Today's Batch
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={`space-y-2.5 ${activePiece ? 'max-w-full' : 'max-w-2xl mx-auto'}`}>
                    {filteredQueue.map(piece => (
                      <QueueCard
                        key={piece.id}
                        piece={piece}
                        onStatusChange={handleStatusChange}
                        onSaveHook={handleSaveHook}
                        onOpen={p => setActivePiece(p)}
                        isActive={activePiece?.id === piece.id}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── HOOKS TAB ── */}
            {activeTab === 'hooks' && (
              <>
                <div className="flex items-center justify-between mb-5 max-w-2xl mx-auto">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Hook Library</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Winning hooks saved for reuse</p>
                  </div>
                  <button onClick={loadHooks}
                    className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50">
                    Refresh
                  </button>
                </div>

                {hooks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center max-w-2xl mx-auto">
                    <p className="text-sm font-semibold text-gray-700 mb-1">No saved hooks yet</p>
                    <p className="text-xs text-gray-400">Open a piece from the queue and save its hook to build your library</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-w-2xl mx-auto">
                    {hooks.map(hook => <HookCard key={hook.id} hook={hook} onDeactivate={handleDeactivateHook} />)}
                  </div>
                )}
              </>
            )}

            {/* ── ANALYTICS TAB ── */}
            {activeTab === 'analytics' && (
              <div className="max-w-3xl mx-auto">
                <div className="mb-6">
                  <h2 className="text-base font-bold text-gray-900">Performance Analytics</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Last 30 days</p>
                </div>

                {stats ? (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      {[
                        { label: 'Total Pieces', value: stats.totalPieces },
                        { label: 'Total Views', value: stats.totalViews?.toLocaleString() },
                        { label: 'Total Leads', value: stats.totalLeads },
                        { label: 'Conversion Rate', value: `${stats.conversionRate || 0}%` },
                      ].map(kpi => (
                        <div key={kpi.label} className="bg-white border border-gray-100 rounded-xl p-5">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{kpi.label}</p>
                          <p className="text-3xl font-bold text-gray-900">{kpi.value}</p>
                        </div>
                      ))}
                    </div>

                    {stats.byPlatform && Object.keys(stats.byPlatform).length > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
                        <h3 className="text-sm font-bold text-gray-700 mb-4">By Platform</h3>
                        <div className="flex flex-wrap gap-3">
                          {Object.entries(stats.byPlatform).map(([platform, count]) => {
                            const pm = PLATFORM_META[platform]
                            return (
                              <div key={platform} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${pm?.pill || 'bg-gray-50 text-gray-700'}`}>
                                <span className="text-xs font-semibold">{pm?.label || platform}</span>
                                <span className="text-xs font-bold opacity-70">{count}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {stats.topPerformers?.length > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl p-5">
                        <h3 className="text-sm font-bold text-gray-700 mb-4">Top Performers</h3>
                        <div className="space-y-1">
                          {stats.topPerformers.map(p => (
                            <div key={p.id} className="flex items-center gap-4 py-2.5 border-t border-gray-50 first:border-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-800 line-clamp-1">{p.hook}</p>
                                <p className="text-xs text-gray-400 mt-0.5">{PLATFORM_META[p.platform]?.label || p.platform}</p>
                              </div>
                              <div className="flex-shrink-0 flex gap-4 text-xs text-gray-400">
                                <span>{p.views.toLocaleString()} views</span>
                                <span>{p.leads} leads</span>
                                <span className="text-emerald-600 font-semibold">{p.conversionRate}% CVR</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-16 text-gray-400 text-sm">Loading analytics…</div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT DRAWER ── */}
          {activePiece && (
            <ScriptViewer
              piece={activePiece}
              allQueue={filteredQueue.length > 0 ? filteredQueue : queue}
              onClose={() => setActivePiece(null)}
              onStatusChange={handleStatusChange}
              onSaveHook={handleSaveHook}
              onPerformanceUpdate={handlePerformanceUpdate}
            />
          )}
        </div>
      </div>
    </div>
  )
}
