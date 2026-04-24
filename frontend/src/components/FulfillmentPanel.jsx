import { useState, useEffect, useCallback } from 'react'
import { fetchFulfillmentOrders, updateFulfillmentOrderStatus } from '../api/index.js'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

const STATUS_STYLE = {
  pending_fulfillment: 'bg-amber-100 text-amber-700',
  packed:              'bg-blue-100 text-blue-700',
  delivered:           'bg-green-100 text-green-700',
  cancelled:           'bg-gray-100 text-gray-500',
}

function OrderCard({ order, onRefresh }) {
  const [acting, setActing] = useState(null)
  const [toast,  setToast]  = useState(null)

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleStatus(status) {
    setActing(status)
    try {
      await updateFulfillmentOrderStatus(order.id, status)
      showToast(`Marked as ${status.replace(/_/g, ' ')}`)
      onRefresh()
    } catch (err) {
      showToast(err?.message || 'Failed', false)
    } finally {
      setActing(null)
    }
  }

  const statusStyle = STATUS_STYLE[order.status] || 'bg-gray-100 text-gray-500'

  return (
    <div className="rounded-lg border border-purple-100 bg-white px-3 py-2.5 space-y-2 shadow-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${statusStyle}`}>
          {order.status.replace(/_/g, ' ')}
        </span>
        <span className="text-purple-700 font-bold">
          ₦{order.totalAmount?.toLocaleString('en-NG')}
        </span>
        <span className="text-gray-400 text-[10px]">created {fmtDate(order.createdAt)}</span>
        {order.paymentTransaction?.paidAt && (
          <span className="text-green-600 text-[10px] font-medium">
            paid {fmtDate(order.paymentTransaction.paidAt)}
          </span>
        )}
        {toast && (
          <span className={`ml-auto text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-500'}`}>
            {toast.msg}
          </span>
        )}
      </div>

      {/* Customer details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
        <div><span className="text-gray-400">Customer:</span> {order.customerName}</div>
        {order.customerEmail && (
          <div><span className="text-gray-400">Email:</span> {order.customerEmail}</div>
        )}
        {order.customerPhone && (
          <div><span className="text-gray-400">Phone:</span> {order.customerPhone}</div>
        )}
        {order.paymentTransaction?.paystackReference && (
          <div className="col-span-2">
            <span className="text-gray-400">Paystack ref:</span>{' '}
            <span className="font-mono text-[10px] text-gray-700">
              {order.paymentTransaction.paystackReference}
            </span>
          </div>
        )}
        {order.paymentTransaction?.channel && (
          <div>
            <span className="text-gray-400">Channel:</span>{' '}
            <span className="capitalize">{order.paymentTransaction.channel}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {order.status !== 'delivered' && order.status !== 'cancelled' && (
        <div className="flex gap-2 border-t border-gray-100 pt-2">
          {order.status === 'pending_fulfillment' && (
            <button
              disabled={!!acting}
              onClick={() => handleStatus('packed')}
              className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {acting === 'packed' ? '…' : 'Mark Packed'}
            </button>
          )}
          {(order.status === 'pending_fulfillment' || order.status === 'packed') && (
            <button
              disabled={!!acting}
              onClick={() => handleStatus('delivered')}
              className="rounded border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
            >
              {acting === 'delivered' ? '…' : 'Mark Delivered'}
            </button>
          )}
        </div>
      )}

      {order.status === 'delivered' && (
        <p className="text-xs text-green-600 font-medium border-t border-gray-100 pt-1.5">
          Order delivered ✓
        </p>
      )}
    </div>
  )
}

/**
 * Fulfillment Panel — shows payment confirmation and order status for leads
 * that have completed a product quote purchase. Renders in the expanded lead row.
 */
export default function FulfillmentPanel({ lead }) {
  const [open,    setOpen]    = useState(false)
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchFulfillmentOrders({ leadId: lead.id })
      setOrders(res.orders || [])
    } catch (err) {
      setError(err?.message || 'Failed to load fulfillment data')
    } finally {
      setLoading(false)
    }
  }, [lead.id])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const hasPending  = orders.some(o => o.status === 'pending_fulfillment')
  const hasDelivered = orders.some(o => o.status === 'delivered')

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/10">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
            Fulfillment
          </span>
          {lead.paymentStatus === 'paid' && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
              paid ✓
            </span>
          )}
          {lead.lastPaidAmount > 0 && (
            <span className="text-[10px] text-purple-600 font-medium">
              ₦{lead.lastPaidAmount?.toLocaleString('en-NG')}
            </span>
          )}
          {hasPending && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              pending packing
            </span>
          )}
          {hasDelivered && !hasPending && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              delivered
            </span>
          )}
          {orders.length === 0 && !open && (
            <span className="text-[10px] text-gray-400">click to load orders</span>
          )}
        </div>
        <span className="text-gray-400 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="border-t border-purple-100 px-3 py-2.5 space-y-3"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide">
              Orders ({orders.length})
            </p>
            <button
              onClick={load}
              className="text-[10px] text-gray-400 hover:text-gray-600 underline"
            >
              Refresh
            </button>
          </div>

          {loading && <p className="text-xs text-gray-400">Loading orders…</p>}

          {error && (
            <div className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
              {error}
              <button onClick={load} className="ml-2 underline">Retry</button>
            </div>
          )}

          {!loading && !error && orders.length === 0 && (
            <p className="text-xs text-gray-400 italic">No fulfillment orders yet.</p>
          )}

          {!loading && !error && orders.map(order => (
            <OrderCard key={order.id} order={order} onRefresh={load} />
          ))}

          {/* Payment details summary */}
          {lead.paidAt && (
            <div className="rounded bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-700 space-y-0.5">
              <p className="font-semibold">Payment confirmed</p>
              <p>Amount: ₦{lead.lastPaidAmount?.toLocaleString('en-NG') || '—'}</p>
              <p>Paid at: {fmtDate(lead.paidAt)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
