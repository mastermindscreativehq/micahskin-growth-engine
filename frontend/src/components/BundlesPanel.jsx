import { useState, useEffect, useCallback } from 'react'
import {
  fetchBundles,
  fetchBundle,
  createBundle,
  updateBundle,
  setBundleStatus,
  addBundleItem,
  removeBundleItem,
  reorderBundleItems,
  fetchProducts,
} from '../api/index.js'

const CONCERN_OPTIONS = [
  '', 'acne', 'hyperpigmentation', 'dry_skin', 'oily_skin',
  'sensitivity', 'stretch_marks', 'body_care', 'routine_building',
]
const SKIN_TYPE_OPTIONS = ['oily', 'dry', 'combination', 'normal', 'sensitive']

const STATUS_META = {
  draft:     { label: 'Draft',     pill: 'bg-gray-100 text-gray-500' },
  published: { label: 'Published', pill: 'bg-green-100 text-green-700' },
  archived:  { label: 'Archived',  pill: 'bg-red-50 text-red-500' },
}

const BLANK_FORM = {
  title: '', slug: '', description: '', concern: '', skinTypes: [],
  price: '', compareAtPrice: '', heroImageUrl: '', ctaText: '', contactCtaText: '',
}

function slugify(input) {
  return String(input || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── Product selector — reuses the existing admin product catalog API ─────────

function ProductSelector({ onSelect }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      fetchProducts({ search, limit: 10 })
        .then(res => setResults(res.data || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search existing products to add…"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
      />
      {open && search.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
          {loading && <p className="px-3 py-2 text-xs text-gray-400">Searching…</p>}
          {!loading && results.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No products found</p>}
          {!loading && results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onSelect(p); setSearch(''); setResults([]); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50"
            >
              {p.imageUrl
                ? <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                : <span className="h-8 w-8 rounded bg-gray-100 shrink-0" />}
              <span className="flex-1">
                <span className="block font-medium text-gray-800">{p.productName}</span>
                <span className="block text-gray-400">{p.brand} · {p.price ? `₦${p.price.toLocaleString('en-NG')}` : 'no price'} · {p.stockStatus?.replace(/_/g, ' ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Builder — create or edit a single bundle ──────────────────────────────────

function BundleBuilder({ bundleId, onClose, onSaved }) {
  const isNew = !bundleId
  const [bundle, setBundle] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [publishErrors, setPublishErrors] = useState([])
  const [slugTouched, setSlugTouched] = useState(!isNew)

  const load = useCallback(() => {
    if (isNew) return
    setLoading(true)
    fetchBundle(bundleId)
      .then(res => {
        const b = res.data
        setBundle(b)
        setForm({
          title: b.title, slug: b.slug, description: b.description || '',
          concern: b.concern || '', skinTypes: b.skinTypes || [],
          price: b.price, compareAtPrice: b.compareAtPrice ?? '',
          heroImageUrl: b.heroImageUrl || '', ctaText: b.ctaText || '', contactCtaText: b.contactCtaText || '',
        })
      })
      .catch(e => setError(e?.message || 'Failed to load bundle'))
      .finally(() => setLoading(false))
  }, [bundleId, isNew])

  useEffect(() => { load() }, [load])

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function handleTitleChange(val) {
    set('title', val)
    if (!slugTouched) set('slug', slugify(val))
  }

  function toggleSkinType(type) {
    setForm(f => ({
      ...f,
      skinTypes: f.skinTypes.includes(type) ? f.skinTypes.filter(t => t !== type) : [...f.skinTypes, type],
    }))
  }

  async function handleSaveDraft() {
    setError(null)
    setPublishErrors([])
    if (!form.title.trim()) { setError('Title is required'); return }
    if (!form.price || Number(form.price) <= 0) { setError('Price must be a positive number'); return }
    setSaving(true)
    try {
      const payload = { ...form, price: Number(form.price), compareAtPrice: form.compareAtPrice === '' ? null : Number(form.compareAtPrice) }
      if (isNew) {
        const res = await createBundle(payload)
        onSaved()
        onClose()
        return res.data
      } else {
        await updateBundle(bundleId, payload)
        load()
        onSaved()
      }
    } catch (e) {
      setError(e?.message || 'Save failed')
      if (e?.errors) setError(e.errors.join(' · '))
    } finally {
      setSaving(false)
    }
  }

  async function handleAddProduct(product) {
    if (isNew) { setError('Save the bundle as a draft first, then add products'); return }
    try {
      const res = await updateAfterItemChange(() => addBundleItem(bundleId, product.id))
      setBundle(res)
    } catch (e) {
      setError(e?.message || 'Failed to add product')
    }
  }

  async function handleRemoveItem(itemId) {
    try {
      const res = await updateAfterItemChange(() => removeBundleItem(bundleId, itemId))
      setBundle(res)
    } catch (e) {
      setError(e?.message || 'Failed to remove product')
    }
  }

  async function updateAfterItemChange(fn) {
    const res = await fn()
    return res.data
  }

  async function moveItem(index, direction) {
    const items = bundle?.items || []
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= items.length) return
    const reordered = [...items]
    ;[reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]]
    try {
      const res = await reorderBundleItems(bundleId, reordered.map(i => i.id))
      setBundle(res.data)
    } catch (e) {
      setError(e?.message || 'Failed to reorder')
    }
  }

  async function handleStatusChange(status) {
    setError(null)
    setPublishErrors([])
    try {
      const res = await setBundleStatus(bundleId, status)
      setBundle(res.data)
      onSaved()
    } catch (e) {
      if (e?.errors?.length) setPublishErrors(e.errors)
      else setError(e?.message || 'Status change failed')
    }
  }

  if (loading) return <p className="text-sm text-gray-400 px-1">Loading…</p>

  const status = bundle?.status || 'draft'
  const meta = STATUS_META[status] || STATUS_META.draft

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800">{isNew ? 'Create Bundle' : 'Edit Bundle'}</h2>
          {!isNew && <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}>{meta.label}</span>}
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">← Back to list</button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}
      {publishErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <p className="font-semibold mb-1">Cannot publish yet:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {publishErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Title *</label>
          <input value={form.title} onChange={e => handleTitleChange(e.target.value)} placeholder="Acne Reset Routine"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Slug *</label>
          <input value={form.slug} onChange={e => { set('slug', slugify(e.target.value)); setSlugTouched(true) }} placeholder="acne-reset-routine"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
          <p className="text-[10px] text-gray-400 mt-0.5">/bundles/{form.slug || '…'}</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Concern</label>
          <select value={form.concern} onChange={e => set('concern', e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400">
            <option value="">— select —</option>
            {CONCERN_OPTIONS.slice(1).map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Skin Types</label>
          <div className="flex flex-wrap gap-2 pt-1">
            {SKIN_TYPE_OPTIONS.map(t => (
              <button key={t} type="button" onClick={() => toggleSkinType(t)}
                className={`rounded px-2 py-1 text-[11px] capitalize border ${form.skinTypes.includes(t) ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</label>
        <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 resize-none"
          placeholder="What this routine is for and why these products were chosen…" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Bundle Price (₦) *</label>
          <input type="number" value={form.price} onChange={e => set('price', e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Compare-at Price (₦)</label>
          <input type="number" value={form.compareAtPrice} onChange={e => set('compareAtPrice', e.target.value)}
            placeholder="Optional — value of items if bought separately"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Hero Image URL</label>
          <input value={form.heroImageUrl} onChange={e => set('heroImageUrl', e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">CTA Button Text</label>
          <input value={form.ctaText} onChange={e => set('ctaText', e.target.value)} placeholder="Get This Routine"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
        </div>
      </div>

      {!isNew && (
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Selected Products</label>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 mb-2">
            {(bundle?.items || []).length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400">No products yet — search below to add some.</p>
            )}
            {(bundle?.items || []).map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                {item.product?.imageUrl
                  ? <img src={item.product.imageUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                  : <span className="h-8 w-8 rounded bg-gray-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {item.product?.productName || <span className="text-red-500">Product no longer exists</span>}
                  </p>
                  {item.product && (
                    <p className="text-[10px] text-gray-400">
                      {item.product.brand} · {item.product.price ? `₦${item.product.price.toLocaleString('en-NG')}` : 'no price'}
                      {!item.product.isActive && <span className="text-red-500"> · inactive</span>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button disabled={idx === 0} onClick={() => moveItem(idx, -1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
                  <button disabled={idx === (bundle.items.length - 1)} onClick={() => moveItem(idx, 1)} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
                  <button onClick={() => handleRemoveItem(item.id)} className="text-[10px] text-red-500 hover:underline ml-2">Remove</button>
                </div>
              </div>
            ))}
          </div>
          <ProductSelector onSelect={handleAddProduct} />
        </div>
      )}

      {isNew && (
        <p className="text-xs text-gray-400 italic">Save as a draft first — then you'll be able to add products.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        <button onClick={handleSaveDraft} disabled={saving}
          className="rounded border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {saving ? 'Saving…' : isNew ? 'Save Draft' : 'Save Changes'}
        </button>
        {!isNew && status !== 'published' && (
          <button onClick={() => handleStatusChange('published')}
            className="rounded bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700">
            Publish
          </button>
        )}
        {!isNew && status === 'published' && (
          <button onClick={() => handleStatusChange('draft')}
            className="rounded border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Unpublish
          </button>
        )}
        {!isNew && status !== 'archived' && (
          <button onClick={() => handleStatusChange('archived')}
            className="rounded border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-50">
            Archive
          </button>
        )}
        {!isNew && status === 'archived' && (
          <button onClick={() => handleStatusChange('draft')}
            className="rounded border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Restore to Draft
          </button>
        )}
        {!isNew && status === 'published' && (
          <a href={`/bundles/${form.slug}`} target="_blank" rel="noopener noreferrer"
            className="ml-auto text-xs text-brand-600 hover:underline">
            Preview live page →
          </a>
        )}
        {!isNew && status !== 'published' && (
          <span className="ml-auto text-[10px] text-gray-400 italic">Publish to preview the live page</span>
        )}
      </div>
    </div>
  )
}

// ── List view ──────────────────────────────────────────────────────────────────

export default function BundlesPanel() {
  const [bundles, setBundles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [view, setView] = useState('list') // 'list' | 'builder'
  const [editingId, setEditingId] = useState(null)
  const [toast, setToast] = useState(null)

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(() => {
    setLoading(true)
    fetchBundles({ search, status: statusFilter })
      .then(res => { setBundles(res.data || []); setTotal(res.total || 0) })
      .catch(e => showToast(e?.message || 'Failed to load bundles', false))
      .finally(() => setLoading(false))
  }, [search, statusFilter])

  useEffect(() => { if (view === 'list') load() }, [load, view])

  if (view === 'builder') {
    return (
      <BundleBuilder
        bundleId={editingId}
        onClose={() => { setView('list'); setEditingId(null) }}
        onSaved={() => showToast(editingId ? 'Bundle updated' : 'Bundle created')}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-800">Product Bundles</h2>
          <p className="text-xs text-gray-400">{total} bundle{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditingId(null); setView('builder') }}
          className="rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
        >
          + Create Bundle
        </button>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${toast.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="text" placeholder="Search bundles…" value={search} onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 flex-1 min-w-[200px]"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Concern</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-400">Loading…</td></tr>}
            {!loading && bundles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No bundles yet — click "+ Create Bundle" to add your first.</td></tr>
            )}
            {!loading && bundles.map(b => {
              const meta = STATUS_META[b.status] || STATUS_META.draft
              return (
                <tr key={b.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 font-medium text-gray-800 text-xs">{b.title}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 capitalize">{(b.concern || '—').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{(b.items || []).length}</td>
                  <td className="px-4 py-2.5 text-xs font-medium text-gray-700">₦{b.price.toLocaleString('en-NG')}</td>
                  <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.pill}`}>{meta.label}</span></td>
                  <td className="px-4 py-2.5 text-[10px] text-gray-400">{new Date(b.updatedAt).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => { setEditingId(b.id); setView('builder') }} className="text-[10px] text-brand-600 hover:underline">Edit</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
