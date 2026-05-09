import React, { useState, useEffect } from 'react'
import {
  fetchContentQueue,
  generateContentBatch,
  generateContentPiece,
  updateContentStatus,
  updateContentPerformance,
  saveContentHook,
  fetchHookLibrary,
  deactivateHook,
  fetchContentStats,
  fetchPainCategories,
  fetchPillars,
  fetchPlatforms,
} from '../api'

export default function ContentIntelligencePanel() {
  const [activeSection, setActiveSection] = useState('queue')
  const [queue, setQueue] = useState([])
  const [hooks, setHooks] = useState([])
  const [stats, setStats] = useState(null)
  const [painCategories, setPainCategories] = useState([])
  const [pillars, setPillars] = useState([])
  const [platforms, setPlatforms] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Form states
  const [generateForm, setGenerateForm] = useState({
    platform: 'tiktok',
    pillar: 'pain_point',
    painCategory: 'general',
    count: 1,
  })

  // Load initial data
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setLoading(true)
    try {
      const [queueData, statsData, categoriesData, pillarsData, platformsData] = await Promise.all([
        fetchContentQueue(),
        fetchContentStats({ days: 30 }),
        fetchPainCategories(),
        fetchPillars(),
        fetchPlatforms(),
      ])
      setQueue(queueData.data || [])
      setStats(statsData.data)
      setPainCategories(categoriesData.data || [])
      setPillars(pillarsData.data || [])
      setPlatforms(platformsData.data || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const loadQueue = async () => {
    try {
      const result = await fetchContentQueue()
      setQueue(result.data || [])
    } catch (err) {
      setError(err.message)
    }
  }

  const loadHooks = async () => {
    try {
      const result = await fetchHookLibrary()
      setHooks(result.data || [])
    } catch (err) {
      setError(err.message)
    }
  }

  const handleGenerateBatch = async () => {
    setLoading(true)
    try {
      const result = await generateContentBatch({
        count: 10,
      })
      setQueue(result.data || [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to generate batch')
    }
    setLoading(false)
  }

  const handleGenerateSingle = async () => {
    setLoading(true)
    try {
      const result = await generateContentPiece(generateForm)
      setQueue([...queue, result.data])
      setGenerateForm({
        platform: 'tiktok',
        pillar: 'pain_point',
        painCategory: 'general',
        count: 1,
      })
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to generate content')
    }
    setLoading(false)
  }

  const handleStatusChange = async (pieceId, newStatus) => {
    try {
      await updateContentStatus(pieceId, newStatus)
      setQueue(
        queue.map(p => (p.id === pieceId ? { ...p, status: newStatus } : p))
      )
    } catch (err) {
      setError(err.message)
    }
  }

  const handlePerformanceUpdate = async (pieceId, updates) => {
    try {
      await updateContentPerformance(pieceId, updates)
      setQueue(
        queue.map(p => (p.id === pieceId ? { ...p, ...updates } : p))
      )
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSaveHook = async (pieceId) => {
    try {
      await saveContentHook(pieceId)
      setQueue(queue.map(p => (p.id === pieceId ? { ...p, isWinning: true } : p)))
      await loadHooks()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDeactivateHook = async (hookId) => {
    try {
      await deactivateHook(hookId)
      setHooks(hooks.filter(h => h.id !== hookId))
    } catch (err) {
      setError(err.message)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  }

  // ═════════════════════════════════════════════════════════════════
  // SECTION: DAILY QUEUE
  // ═════════════════════════════════════════════════════════════════

  const renderQueueSection = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Daily Content Queue</h2>
        <button
          onClick={handleGenerateBatch}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Generating...' : 'Generate Today\'s Batch'}
        </button>
      </div>

      {queue.length === 0 ? (
        <div className="bg-gray-100 p-4 rounded text-center text-gray-600">
          No content in queue. Generate a batch to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {queue.map(piece => (
            <div key={piece.id} className="border border-gray-300 rounded p-4 bg-white">
              <div className="flex gap-2 mb-2">
                <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-semibold">
                  {piece.platform.toUpperCase()}
                </span>
                <span className="inline-block px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded font-semibold">
                  {piece.pillar}
                </span>
                <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs rounded font-semibold">
                  {piece.painCategory}
                </span>
              </div>

              <p className="font-semibold text-sm mb-2 line-clamp-2">{piece.hook}</p>

              <div className="mb-3 p-2 bg-gray-50 rounded text-xs text-gray-700">
                <strong>CTA:</strong> {piece.cta.substring(0, 60)}...
              </div>

              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => copyToClipboard(piece.hook)}
                  className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Copy Hook
                </button>
                <button
                  onClick={() => copyToClipboard(piece.body)}
                  className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Copy Body
                </button>
              </div>

              <div className="flex gap-2 mb-3">
                <select
                  value={piece.status}
                  onChange={(e) => handleStatusChange(piece.id, e.target.value)}
                  className="text-xs px-2 py-1 border rounded flex-1"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="posted">Posted</option>
                </select>
                <button
                  onClick={() => handleSaveHook(piece.id)}
                  disabled={piece.isWinning}
                  className="text-xs px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50"
                >
                  {piece.isWinning ? '⭐ Saved' : 'Save Hook'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <input
                  type="number"
                  placeholder="Views"
                  value={piece.views}
                  onChange={(e) => handlePerformanceUpdate(piece.id, { views: parseInt(e.target.value) || 0 })}
                  className="px-1 py-1 border rounded"
                />
                <input
                  type="number"
                  placeholder="Leads"
                  value={piece.leads}
                  onChange={(e) => handlePerformanceUpdate(piece.id, { leads: parseInt(e.target.value) || 0 })}
                  className="px-1 py-1 border rounded"
                />
                <input
                  type="number"
                  placeholder="Conversions"
                  value={piece.conversions}
                  onChange={(e) => handlePerformanceUpdate(piece.id, { conversions: parseInt(e.target.value) || 0 })}
                  className="px-1 py-1 border rounded"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ═════════════════════════════════════════════════════════════════
  // SECTION: GENERATE
  // ═════════════════════════════════════════════════════════════════

  const renderGenerateSection = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Generate Content</h2>

      <div className="bg-white border border-gray-300 rounded p-4 space-y-3 max-w-md">
        <div>
          <label className="block text-sm font-semibold mb-1">Platform</label>
          <select
            value={generateForm.platform}
            onChange={(e) => setGenerateForm({ ...generateForm, platform: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            {platforms.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Pillar</label>
          <select
            value={generateForm.pillar}
            onChange={(e) => setGenerateForm({ ...generateForm, pillar: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            {pillars.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Pain Category</label>
          <select
            value={generateForm.painCategory}
            onChange={(e) => setGenerateForm({ ...generateForm, painCategory: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            {painCategories.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleGenerateSingle}
          disabled={loading}
          className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 font-semibold"
        >
          {loading ? 'Generating...' : 'Generate Piece'}
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
        <p className="font-semibold mb-2">💡 Quick Generate by Pillar</p>
        <div className="flex flex-wrap gap-2">
          {pillars.map(p => (
            <button
              key={p.id}
              onClick={() => {
                setGenerateForm({ ...generateForm, pillar: p.id })
                setTimeout(handleGenerateSingle, 100)
              }}
              disabled={loading}
              className="px-3 py-1 bg-white border border-blue-300 rounded text-xs hover:bg-blue-100 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // ═════════════════════════════════════════════════════════════════
  // SECTION: HOOK LIBRARY
  // ═════════════════════════════════════════════════════════════════

  const renderHooksSection = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Winning Hooks Library</h2>
        <button
          onClick={loadHooks}
          className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
        >
          Refresh
        </button>
      </div>

      {hooks.length === 0 ? (
        <div className="bg-gray-100 p-4 rounded text-center text-gray-600">
          No saved hooks yet. Mark content as winning to build your library.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hooks.map(hook => (
            <div key={hook.id} className="border border-gray-200 rounded p-3 bg-white">
              <div className="flex gap-1 mb-2">
                <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-800 text-xs rounded">
                  {hook.platform}
                </span>
                <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded">
                  {hook.painCategory}
                </span>
              </div>
              <p className="text-sm mb-2 italic">"{hook.hook.substring(0, 80)}..."</p>
              {hook.performanceNote && (
                <p className="text-xs text-gray-600 mb-2">📊 {hook.performanceNote}</p>
              )}
              <button
                onClick={() => {
                  copyToClipboard(hook.hook)
                  alert('Hook copied!')
                }}
                className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded mr-2"
              >
                Copy
              </button>
              <button
                onClick={() => handleDeactivateHook(hook.id)}
                className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded"
              >
                Deactivate
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ═════════════════════════════════════════════════════════════════
  // SECTION: PAIN POINTS
  // ═════════════════════════════════════════════════════════════════

  const renderPainPointsSection = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Pain Point Categories</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {painCategories.map(cat => (
          <div key={cat.id} className="border border-gray-200 rounded p-3 bg-white text-center">
            <h3 className="font-semibold text-sm mb-2">{cat.label}</h3>
            <p className="text-2xl font-bold text-blue-600 mb-2">{cat.painPointCount}</p>
            <button
              onClick={() => {
                setGenerateForm({
                  ...generateForm,
                  painCategory: cat.id,
                })
                setActiveSection('generate')
              }}
              className="w-full text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded"
            >
              Generate
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  // ═════════════════════════════════════════════════════════════════
  // SECTION: PERFORMANCE
  // ═════════════════════════════════════════════════════════════════

  const renderPerformanceSection = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Performance Analytics</h2>

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded p-3">
              <p className="text-gray-600 text-xs font-semibold">TOTAL PIECES</p>
              <p className="text-3xl font-bold text-blue-600">{stats.totalPieces}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded p-3">
              <p className="text-gray-600 text-xs font-semibold">TOTAL VIEWS</p>
              <p className="text-3xl font-bold text-green-600">{stats.totalViews}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded p-3">
              <p className="text-gray-600 text-xs font-semibold">TOTAL LEADS</p>
              <p className="text-3xl font-bold text-purple-600">{stats.totalLeads}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded p-3">
              <p className="text-gray-600 text-xs font-semibold">CONVERSION RATE</p>
              <p className="text-3xl font-bold text-orange-600">{stats.conversionRate || '0'}%</p>
            </div>
          </div>

          {stats.topPerformers && stats.topPerformers.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Top Performers (30 days)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {stats.topPerformers.map(p => (
                  <div key={p.id} className="border border-gray-200 rounded p-2 text-sm">
                    <p className="font-semibold">{p.hook}</p>
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>{p.platform}</span>
                      <span>👁 {p.views}</span>
                      <span>👤 {p.leads}</span>
                      <span>✓ {p.conversions} ({p.conversionRate}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  // ═════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═════════════════════════════════════════════════════════════════

  return (
    <div className="p-4 bg-gray-50">
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-800 rounded">
          {error}
          <button onClick={() => setError(null)} className="float-right text-sm">✕</button>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { id: 'queue', label: '📋 Daily Queue' },
          { id: 'generate', label: '✨ Generate' },
          { id: 'hooks', label: '🎯 Hook Library' },
          { id: 'painpoints', label: '💔 Pain Points' },
          { id: 'performance', label: '📊 Performance' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={`px-3 py-2 rounded font-semibold text-sm ${
              activeSection === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded border border-gray-200 p-4">
        {loading && activeSection === 'queue' && (
          <div className="text-center text-gray-500 py-8">Generating content...</div>
        )}

        {activeSection === 'queue' && renderQueueSection()}
        {activeSection === 'generate' && renderGenerateSection()}
        {activeSection === 'hooks' && renderHooksSection()}
        {activeSection === 'painpoints' && renderPainPointsSection()}
        {activeSection === 'performance' && renderPerformanceSection()}
      </div>
    </div>
  )
}
