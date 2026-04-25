import { useState, useEffect, useCallback } from 'react'
import { fetchSkinImages, updateSkinImage } from '../api/index.js'

const STATUS_STYLE = {
  uploaded: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const REVIEW_STATUS_STYLE = {
  pending:      'bg-amber-100 text-amber-700',
  reviewed:     'bg-green-100 text-green-700',
  not_required: 'bg-gray-100 text-gray-500',
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * SkinImagesPanel
 *
 * Shown inside the expanded CRM lead row.
 * Fetches LeadSkinImage records for the given lead and lets admin
 * mark each as reviewed and add notes.
 *
 * @param {{ leadId, imageUploadStatus, imageUploadCount, imageReviewStatus }} props
 */
export default function SkinImagesPanel({ leadId, imageUploadStatus, imageUploadCount, imageReviewStatus }) {
  const [images, setImages]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [editNotes, setEditNotes] = useState({})   // { [imageId]: string }
  const [saving, setSaving]       = useState({})   // { [imageId]: boolean }
  const [error, setError]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSkinImages(leadId)
      setImages(data.images || [])
    } catch {
      setError('Failed to load images.')
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { load() }, [load])

  async function handleMarkReviewed(img) {
    setSaving(s => ({ ...s, [img.id]: true }))
    try {
      const note = editNotes[img.id] ?? img.notes ?? ''
      await updateSkinImage(leadId, img.id, { status: 'reviewed', notes: note || undefined })
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'reviewed', notes: note } : i))
    } catch {
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(s => ({ ...s, [img.id]: false }))
    }
  }

  async function handleSaveNote(img) {
    const note = editNotes[img.id]
    if (note === undefined) return
    setSaving(s => ({ ...s, [img.id]: true }))
    try {
      await updateSkinImage(leadId, img.id, { notes: note })
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, notes: note } : i))
      setEditNotes(n => { const c = { ...n }; delete c[img.id]; return c })
    } catch {
      alert('Failed to save note.')
    } finally {
      setSaving(s => ({ ...s, [img.id]: false }))
    }
  }

  // Derive upload status label for panel header
  const uploadLabel =
    imageUploadStatus === 'uploaded' ? `${imageUploadCount || 0} photo${(imageUploadCount || 0) !== 1 ? 's' : ''} uploaded` :
    imageUploadStatus === 'skipped'  ? 'Skipped (no photos)' :
    imageUploadStatus === 'pending'  ? 'Awaiting upload or SKIP' :
    'No photos'

  return (
    <div className="rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2.5 space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-rose-700 uppercase tracking-wide">Skin Images</span>

        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          imageUploadStatus === 'uploaded' ? 'bg-blue-100 text-blue-700' :
          imageUploadStatus === 'skipped'  ? 'bg-gray-100 text-gray-500' :
          imageUploadStatus === 'pending'  ? 'bg-amber-100 text-amber-700' :
          'bg-gray-100 text-gray-400'
        }`}>
          {uploadLabel}
        </span>

        {imageReviewStatus && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            REVIEW_STATUS_STYLE[imageReviewStatus] || 'bg-gray-100 text-gray-400'
          }`}>
            Review: {imageReviewStatus.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Body */}
      {loading && (
        <p className="text-xs text-gray-400 italic">Loading images…</p>
      )}

      {!loading && error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {!loading && !error && imageUploadStatus === 'skipped' && images.length === 0 && (
        <p className="text-xs text-gray-400 italic">Lead skipped photo upload.</p>
      )}

      {!loading && !error && imageUploadStatus === 'pending' && images.length === 0 && (
        <p className="text-xs text-amber-600 italic">Waiting for lead to upload photos or type SKIP.</p>
      )}

      {!loading && !error && images.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, idx) => {
            const isEditing  = editNotes[img.id] !== undefined
            const noteValue  = isEditing ? editNotes[img.id] : (img.notes || '')
            const isSaving   = saving[img.id] || false

            return (
              <div key={img.id} className="rounded border border-rose-100 bg-white p-2 space-y-1.5 text-xs">
                {/* Thumbnail */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-medium text-gray-500 w-5">#{idx + 1}</span>
                  {img.fileUrl ? (
                    <a
                      href={img.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-rose-50 border border-rose-100 px-2 py-1 text-rose-700 hover:bg-rose-100 transition-colors"
                      title="Open full image in new tab"
                    >
                      🖼 View photo
                    </a>
                  ) : (
                    <span className="text-gray-300 italic">URL unavailable (file may have expired)</span>
                  )}
                </div>

                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[img.status] || 'bg-gray-100 text-gray-500'}`}>
                    {img.status}
                  </span>
                  <span className="text-gray-400">{fmtDateTime(img.uploadedAt)}</span>
                </div>

                {/* Notes */}
                <textarea
                  rows={2}
                  placeholder="Add internal note…"
                  value={noteValue}
                  onChange={e => setEditNotes(n => ({ ...n, [img.id]: e.target.value }))}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] text-gray-700 resize-none outline-none focus:border-rose-300"
                />

                {/* Actions */}
                <div className="flex gap-1.5">
                  {img.status !== 'reviewed' && (
                    <button
                      disabled={isSaving}
                      onClick={() => handleMarkReviewed(img)}
                      className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors"
                    >
                      {isSaving ? 'Saving…' : '✓ Mark reviewed'}
                    </button>
                  )}
                  {isEditing && (
                    <button
                      disabled={isSaving}
                      onClick={() => handleSaveNote(img)}
                      className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors"
                    >
                      {isSaving ? 'Saving…' : 'Save note'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
