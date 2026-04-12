export const COUNTRY_CODES = [
  { key: 'NG', code: '+234', label: 'Nigeria (+234)' },
  { key: 'GB', code: '+44',  label: 'UK (+44)' },
  { key: 'US', code: '+1',   label: 'US (+1)' },
  { key: 'CA', code: '+1',   label: 'Canada (+1)' },
  { key: 'GH', code: '+233', label: 'Ghana (+233)' },
  { key: 'KE', code: '+254', label: 'Kenya (+254)' },
  { key: 'ZA', code: '+27',  label: 'South Africa (+27)' },
]

/**
 * Combines a country key + local number into a single E.164-style phone string.
 * Strips leading zero from local number before prefixing the dial code.
 */
export function combinePhone(countryKey, localPhone) {
  const entry = COUNTRY_CODES.find(c => c.key === countryKey) || COUNTRY_CODES[0]
  const local = localPhone.replace(/\s/g, '').replace(/^0/, '')
  return local ? `${entry.code}${local}` : ''
}

export default function PhoneInput({ countryKey, localPhone, onCountryChange, onLocalChange }) {
  return (
    <div className="flex gap-2">
      <select
        value={countryKey}
        onChange={(e) => onCountryChange(e.target.value)}
        aria-label="Country code"
        className="shrink-0 border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition bg-white"
        style={{ minWidth: '9rem' }}
      >
        {COUNTRY_CODES.map(c => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>
      <input
        type="tel"
        className="form-input flex-1 min-w-0"
        placeholder="0806 000 0000"
        value={localPhone}
        onChange={(e) => onLocalChange(e.target.value)}
        aria-label="Phone number"
      />
    </div>
  )
}
