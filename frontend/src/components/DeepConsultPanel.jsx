import { useState, useEffect, useCallback } from 'react'
import { fetchDeepConsultation, markDeepConsultHumanReview, sendHumanConsultOffer } from '../api/index.js'

const STAGE_NAMES = {
  1:  'Patient Profile',
  2:  'Chief Complaint',
  3:  'Symptom Interrogation',
  4:  'Medical & Hormonal History',
  5:  'Medication & Supplement Audit',
  6:  'Trigger & Exposure Audit',
  7:  'Skincare Routine Audit',
  8:  'Lifestyle Factors',
  9:  'Photo Review',
  10: 'Diagnosis & Assessment',
  11: 'Treatment Protocol',
  12: 'Follow-up Protocol',
}

const FLAG_LABELS = {
  bleeding:                   'Bleeding reported',
  spreading_rapidly:          'Spreading rapidly',
  severe_pain:                'Severe pain',
  infection_signs:            'Infection signs',
  pregnancy_or_breastfeeding: 'Pregnant / breastfeeding',
  steroid_or_bleaching_misuse: 'Steroid / bleaching misuse',
  hormonal_systemic_issue:    'Hormonal / systemic issue',
  systemic_autoimmune:        'Autoimmune condition',
}

const STATUS_STYLE = {
  in_progress: 'bg-amber-100 text-amber-700',
  completed:   'bg-green-100 text-green-700',
  abandoned:   'bg-gray-100 text-gray-500',
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * DeepConsultPanel
 *
 * Shown in the expanded CRM lead row for leads who have started
 * (or completed) an AI deep consultation via the CONSULT keyword.
 *
 * @param {{ lead: object }} props
 */
export default function DeepConsultPanel({ lead }) {
  const [consult, setConsult]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [expanded, setExpanded]     = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [saving, setSaving]         = useState(null) // 'review' | 'offer' | null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDeepConsultation(lead.id)
      setConsult(data.consultation)
    } catch {
      setError('Failed to load consultation.')
    } finally {
      setLoading(false)
    }
  }, [lead.id])

  useEffect(() => { load() }, [load])

  async function handleMarkHumanReview() {
    setSaving('review')
    try {
      const data = await markDeepConsultHumanReview(lead.id, reviewNote)
      setConsult(data.consultation)
      setReviewNote('')
    } catch {
      alert('Failed to mark for human review.')
    } finally {
      setSaving(null)
    }
  }

  async function handleSendHumanOffer() {
    if (!lead.telegramChatId) {
      alert('Lead has no Telegram chat ID — cannot send offer.')
      return
    }
    if (!window.confirm(`Send human consultation offer to ${lead.fullName} via Telegram?`)) return
    setSaving('offer')
    try {
      await sendHumanConsultOffer(lead.id)
      alert('Human consult offer sent via Telegram.')
    } catch (err) {
      alert(`Failed to send: ${err?.message || 'Unknown error'}`)
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-teal-100 bg-teal-50/40 px-3 py-2.5">
        <p className="text-xs text-teal-400 italic">Loading deep consultation…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50/40 px-3 py-2.5">
        <p className="text-xs text-red-500">{error}</p>
      </div>
    )
  }

  if (!consult) {
    return (
      <div className="rounded-lg border border-teal-100 bg-teal-50/40 px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-teal-700 uppercase tracking-wide">Deep Consult</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">Not started</span>
        </div>
        <p className="text-xs text-gray-400 italic">
          Lead can start a consultation by replying <strong>CONSULT</strong> on Telegram after diagnosis.
        </p>
      </div>
    )
  }

  const answers = consult.answers && typeof consult.answers === 'object' ? consult.answers : {}
  const answerKeys = Object.keys(answers).sort((a, b) => {
    const na = parseInt(a.replace('stage_', ''))
    const nb = parseInt(b.replace('stage_', ''))
    return na - nb
  })

  const stageProgress = consult.status === 'completed'
    ? 'Complete'
    : `Stage ${consult.currentStage} — ${STAGE_NAMES[consult.currentStage] || `Stage ${consult.currentStage}`}`

  return (
    <div className="rounded-lg border border-teal-100 bg-teal-50/40 px-3 py-2.5 space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-teal-700 uppercase tracking-wide">Deep Consult</span>

        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[consult.status] || 'bg-gray-100 text-gray-500'}`}>
          {consult.status.replace('_', ' ')}
        </span>

        {consult.needsHumanReview && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 uppercase tracking-wide">
            ⚠ Needs Human Review
          </span>
        )}

        <span className="text-teal-500 text-[10px]">{stageProgress}</span>

        {consult.completedAt && (
          <span className="text-teal-400 text-[10px]">Completed: {fmtDateTime(consult.completedAt)}</span>
        )}
      </div>

      {/* Red flags */}
      {consult.redFlags && consult.redFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mr-0.5">Red Flags:</span>
          {consult.redFlags.map(flag => (
            <span key={flag} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
              {FLAG_LABELS[flag] || flag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Human review note */}
      {consult.humanReviewReason && (
        <p className="text-xs text-amber-700 italic border-t border-teal-100 pt-1.5">
          <span className="font-semibold">Review note:</span> {consult.humanReviewReason}
        </p>
      )}

      {/* Expand/collapse answers */}
      <div className="border-t border-teal-100 pt-1.5">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[11px] font-semibold text-teal-600 hover:text-teal-800 underline decoration-dotted"
        >
          {expanded ? '▲ Hide answers' : `▼ View ${answerKeys.length} collected answer${answerKeys.length !== 1 ? 's' : ''}`}
        </button>

        {expanded && (
          <div className="mt-2 space-y-2">
            {answerKeys.length === 0 && (
              <p className="text-xs text-gray-400 italic">No answers collected yet.</p>
            )}
            {answerKeys.map(key => {
              const stageNum  = parseInt(key.replace('stage_', ''))
              const stageName = STAGE_NAMES[stageNum] || `Stage ${stageNum}`
              const text      = answers[key]
              return (
                <div key={key} className="rounded border border-teal-100 bg-white px-2.5 py-2 space-y-0.5">
                  <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wide">
                    Stage {stageNum} — {stageName}
                  </p>
                  <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{text}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Assessment (if completed) */}
      {consult.assessment && (
        <div className="border-t border-teal-100 pt-1.5">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[11px] font-semibold text-teal-600 hover:text-teal-800 underline decoration-dotted"
          >
            {expanded ? '▲ Hide assessment' : '▼ View assessment'}
          </button>
          {expanded && (
            <div className="mt-2 rounded border border-teal-100 bg-white px-2.5 py-2">
              <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wide mb-1">Generated Assessment</p>
              <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
                {consult.assessment.replace(/<[^>]+>/g, '')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Admin actions */}
      <div className="border-t border-teal-100 pt-1.5 flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
        {/* Mark needs human review */}
        {!consult.needsHumanReview && (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Review note (optional)…"
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700 outline-none focus:border-amber-300 w-44"
            />
            <button
              disabled={saving === 'review'}
              onClick={handleMarkHumanReview}
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-200 disabled:opacity-50 transition-colors"
            >
              {saving === 'review' ? 'Saving…' : '⚑ Mark Needs Human Review'}
            </button>
          </div>
        )}

        {consult.needsHumanReview && (
          <span className="rounded bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
            ✓ Flagged for Human Review
          </span>
        )}

        {/* Send human consult offer */}
        <button
          disabled={saving === 'offer' || !lead.telegramChatId}
          onClick={handleSendHumanOffer}
          title={!lead.telegramChatId ? 'Lead has no Telegram chat ID' : 'Send human consultation offer via Telegram'}
          className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 transition-colors"
        >
          {saving === 'offer' ? 'Sending…' : '📲 Send Human Consult Offer'}
        </button>
      </div>

      <p className="text-[10px] text-gray-400 italic pt-0.5">
        Started: {fmtDateTime(consult.createdAt)}
      </p>
    </div>
  )
}
