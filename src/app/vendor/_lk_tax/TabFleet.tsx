'use client'
import { useState, useEffect, useRef } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FleetAccount {
  id: string
  company_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tin: string | null
  credit_limit: number
  payment_terms: number
  is_active: boolean
  notes: string | null
  created_at: string
}

type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'other'

interface Vehicle {
  id: string
  plate_no: string
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  fuel_type: FuelType | null
  engine_no: string | null
  chassis_no: string | null
  notes: string | null
  fleet_account_id: string | null
  fleet_company: string | null
  customer_id: string | null
  is_active: boolean
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRs(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

const FUEL_COLORS: Record<FuelType, string> = {
  petrol: 'bg-blue-100 text-blue-700',
  diesel: 'bg-slate-100 text-slate-700',
  hybrid: 'bg-green-100 text-green-700',
  electric: 'bg-teal-100 text-teal-700',
  other: 'bg-gray-100 text-gray-600',
}

function FuelBadge({ type }: { type: FuelType | null }) {
  if (!type) return <span className="text-slate-300">—</span>
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${FUEL_COLORS[type]}`}>
      {type}
    </span>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
      Active
    </span>
  ) : (
    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      Inactive
    </span>
  )
}

// ── Blank form state factories ────────────────────────────────────────────────

function blankAccount(): Omit<FleetAccount, 'id' | 'created_at' | 'is_active'> & { is_active: boolean } {
  return {
    company_name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    tin: '',
    credit_limit: 0,
    payment_terms: 30,
    notes: '',
    is_active: true,
  }
}

function blankVehicle(): Omit<Vehicle, 'id' | 'created_at' | 'is_active' | 'fleet_company'> & { is_active: boolean } {
  return {
    plate_no: '',
    make: '',
    model: '',
    year: null,
    color: '',
    fuel_type: null,
    engine_no: '',
    chassis_no: '',
    notes: '',
    fleet_account_id: null,
    customer_id: null,
    is_active: true,
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabFleet({ vendor, showToast }: Props) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'vehicles'>('accounts')

  // Data
  const [accounts, setAccounts] = useState<FleetAccount[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [saving, setSaving] = useState(false)

  // Modal state — null = closed, 'new' = add, FleetAccount/Vehicle = edit
  const [editingAccount, setEditingAccount] = useState<FleetAccount | 'new' | null>(null)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | 'new' | null>(null)

  // Form data for the modals
  const [accountForm, setAccountForm] = useState(blankAccount())
  const [vehicleForm, setVehicleForm] = useState(blankVehicle())

  // Plate search
  const [plateSearch, setPlateSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  async function fetchAccounts() {
    setLoadingAccounts(true)
    try {
      const res = await fetch('/api/vendor/fleet')
      if (!res.ok) throw new Error('Failed to load fleet accounts')
      const data = await res.json()
      setAccounts(data.accounts ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading fleet accounts')
    } finally {
      setLoadingAccounts(false)
    }
  }

  async function fetchVehicles(plate?: string) {
    setLoadingVehicles(true)
    try {
      const params = new URLSearchParams()
      if (plate) params.set('plate_no', plate)
      const res = await fetch(`/api/vendor/vehicles${params.toString() ? '?' + params.toString() : ''}`)
      if (!res.ok) throw new Error('Failed to load vehicles')
      const data = await res.json()
      setVehicles(data.vehicles ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading vehicles')
    } finally {
      setLoadingVehicles(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
    fetchVehicles()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Plate search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchVehicles(plateSearch.trim() || undefined)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [plateSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Account handlers ───────────────────────────────────────────────────────

  function openAddAccount() {
    setAccountForm(blankAccount())
    setEditingAccount('new')
  }

  function openEditAccount(account: FleetAccount) {
    setAccountForm({
      company_name: account.company_name,
      contact_name: account.contact_name ?? '',
      phone: account.phone ?? '',
      email: account.email ?? '',
      address: account.address ?? '',
      tin: account.tin ?? '',
      credit_limit: account.credit_limit,
      payment_terms: account.payment_terms,
      notes: account.notes ?? '',
      is_active: account.is_active,
    })
    setEditingAccount(account)
  }

  async function handleSaveAccount() {
    if (!accountForm.company_name.trim()) {
      showToast('Company name is required')
      return
    }
    setSaving(true)
    try {
      const isNew = editingAccount === 'new'
      const body: Record<string, unknown> = {
        action: isNew ? 'create' : 'update',
        company_name: accountForm.company_name.trim(),
        contact_name: accountForm.contact_name?.trim() || null,
        phone: accountForm.phone?.trim() || null,
        email: accountForm.email?.trim() || null,
        address: accountForm.address?.trim() || null,
        tin: accountForm.tin?.trim() || null,
        credit_limit: Math.round(Number(accountForm.credit_limit)) || 0,
        payment_terms: Math.round(Number(accountForm.payment_terms)) || 30,
        notes: accountForm.notes?.trim() || null,
      }
      if (!isNew) {
        body.accountId = (editingAccount as FleetAccount).id
        body.is_active = accountForm.is_active
      }
      const res = await fetch('/api/vendor/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to save fleet account')
      }
      showToast(isNew ? 'Fleet account added' : 'Fleet account updated')
      setEditingAccount(null)
      await fetchAccounts()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Vehicle handlers ───────────────────────────────────────────────────────

  function openAddVehicle() {
    setVehicleForm(blankVehicle())
    setEditingVehicle('new')
  }

  function openEditVehicle(vehicle: Vehicle) {
    setVehicleForm({
      plate_no: vehicle.plate_no,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      year: vehicle.year,
      color: vehicle.color ?? '',
      fuel_type: vehicle.fuel_type,
      engine_no: vehicle.engine_no ?? '',
      chassis_no: vehicle.chassis_no ?? '',
      notes: vehicle.notes ?? '',
      fleet_account_id: vehicle.fleet_account_id,
      customer_id: vehicle.customer_id,
      is_active: vehicle.is_active,
    })
    setEditingVehicle(vehicle)
  }

  async function handleSaveVehicle() {
    if (!vehicleForm.plate_no.trim()) {
      showToast('Plate number is required')
      return
    }
    setSaving(true)
    try {
      const isNew = editingVehicle === 'new'
      const body: Record<string, unknown> = {
        action: isNew ? 'create' : 'update',
        plate_no: vehicleForm.plate_no.trim().toUpperCase(),
        make: vehicleForm.make?.trim() || null,
        model: vehicleForm.model?.trim() || null,
        year: vehicleForm.year ?? null,
        color: vehicleForm.color?.trim() || null,
        fuel_type: vehicleForm.fuel_type || null,
        engine_no: vehicleForm.engine_no?.trim() || null,
        chassis_no: vehicleForm.chassis_no?.trim() || null,
        notes: vehicleForm.notes?.trim() || null,
        fleet_account_id: vehicleForm.fleet_account_id || null,
      }
      if (!isNew) {
        body.vehicleId = (editingVehicle as Vehicle).id
        body.is_active = vehicleForm.is_active
      }
      const res = await fetch('/api/vendor/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to save vehicle')
      }
      showToast(isNew ? 'Vehicle added' : 'Vehicle updated')
      setEditingVehicle(null)
      await fetchVehicles(plateSearch.trim() || undefined)
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
            activeTab === 'accounts'
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
          }`}
        >
          Fleet Accounts
        </button>
        <button
          onClick={() => setActiveTab('vehicles')}
          className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
            activeTab === 'vehicles'
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
          }`}
        >
          Vehicles
        </button>
      </div>

      {/* ── Fleet Accounts tab ─────────────────────────────────────────────── */}
      {activeTab === 'accounts' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-black text-slate-900">Fleet Accounts</h1>
            <button
              onClick={openAddAccount}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
            >
              <span className="text-base leading-none">+</span>
              Add Fleet Account
            </button>
          </div>

          {loadingAccounts ? (
            <Spinner />
          ) : accounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold text-sm">No fleet accounts yet.</p>
              <p className="text-slate-300 text-xs mt-1">Add a fleet account to start tracking corporate customers.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Company</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Contact</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Phone</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Credit Limit</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Payment Terms</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acct) => (
                      <tr key={acct.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800 text-sm">{acct.company_name}</p>
                          {acct.tin && (
                            <p className="text-xs text-slate-400 mt-0.5">TIN: {acct.tin}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {acct.contact_name ? (
                            <p className="text-xs text-slate-600 font-semibold">{acct.contact_name}</p>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {acct.phone ? (
                            <p className="text-xs text-slate-500">{acct.phone}</p>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {acct.credit_limit > 0 ? (
                            <span className="font-bold text-orange-500 text-sm">{formatRs(acct.credit_limit)}</span>
                          ) : (
                            <span className="text-slate-300 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs text-slate-500">{acct.payment_terms} days</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ActiveBadge active={acct.is_active} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEditAccount(acct)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Vehicles tab ───────────────────────────────────────────────────── */}
      {activeTab === 'vehicles' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-2xl font-black text-slate-900">Vehicles</h1>
            <button
              onClick={openAddVehicle}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
            >
              <span className="text-base leading-none">+</span>
              Add Vehicle
            </button>
          </div>

          {/* Plate search bar */}
          <div className="relative mb-5">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              {loadingVehicles ? (
                <div className="w-4 h-4 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              )}
            </div>
            <input
              type="text"
              placeholder="Search by plate number…"
              value={plateSearch}
              onChange={e => setPlateSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
            />
          </div>

          {loadingVehicles && vehicles.length === 0 ? (
            <Spinner />
          ) : vehicles.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold text-sm">
                {plateSearch ? `No vehicles found matching "${plateSearch}".` : 'No vehicles yet.'}
              </p>
              {!plateSearch && (
                <p className="text-slate-300 text-xs mt-1">Add a vehicle to link it to a fleet account or customer.</p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Plate No.</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Make &amp; Model</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Year</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Fuel</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Fleet Account</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm font-bold text-slate-800 uppercase">{v.plate_no}</span>
                        </td>
                        <td className="px-4 py-3">
                          {(v.make || v.model) ? (
                            <p className="text-sm text-slate-700 font-semibold">
                              {[v.make, v.model].filter(Boolean).join(' ')}
                            </p>
                          ) : (
                            <span className="text-slate-300 text-sm">—</span>
                          )}
                          {v.color && (
                            <p className="text-xs text-slate-400 mt-0.5">{v.color}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {v.year ? (
                            <span className="text-xs text-slate-500">{v.year}</span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <FuelBadge type={v.fuel_type} />
                        </td>
                        <td className="px-4 py-3">
                          {v.fleet_company ? (
                            <p className="text-xs text-slate-600 font-semibold">{v.fleet_company}</p>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ActiveBadge active={v.is_active} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEditVehicle(v)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD / EDIT FLEET ACCOUNT MODAL ─────────────────────────────────── */}
      {editingAccount !== null && (
        <Modal
          title={editingAccount === 'new' ? 'Add Fleet Account' : 'Edit Fleet Account'}
          onClose={() => setEditingAccount(null)}
        >
          <div className="flex flex-col gap-3">
            {/* Company Name */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. ABC Logistics (Pvt) Ltd"
                value={accountForm.company_name}
                onChange={e => setAccountForm(p => ({ ...p, company_name: e.target.value }))}
              />
            </div>

            {/* Contact Name + Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Contact Name</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Contact person"
                  value={accountForm.contact_name ?? ''}
                  onChange={e => setAccountForm(p => ({ ...p, contact_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Phone</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="0777 000 000"
                  value={accountForm.phone ?? ''}
                  onChange={e => setAccountForm(p => ({ ...p, phone: e.target.value }))}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Email</label>
              <input
                type="email"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="fleet@company.lk"
                value={accountForm.email ?? ''}
                onChange={e => setAccountForm(p => ({ ...p, email: e.target.value }))}
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Address</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                placeholder="Street, City"
                value={accountForm.address ?? ''}
                onChange={e => setAccountForm(p => ({ ...p, address: e.target.value }))}
              />
            </div>

            {/* TIN */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">TIN (Tax Identification Number)</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono"
                placeholder="9-digit TIN"
                value={accountForm.tin ?? ''}
                onChange={e => setAccountForm(p => ({ ...p, tin: e.target.value }))}
              />
            </div>

            {/* Credit Limit + Payment Terms */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Credit Limit (Rs.)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="0"
                  value={accountForm.credit_limit}
                  onChange={e => setAccountForm(p => ({ ...p, credit_limit: Math.round(Number(e.target.value)) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Payment Terms (days)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={accountForm.payment_terms}
                  onChange={e => setAccountForm(p => ({ ...p, payment_terms: Math.round(Number(e.target.value)) || 30 }))}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                placeholder="Optional notes"
                value={accountForm.notes ?? ''}
                onChange={e => setAccountForm(p => ({ ...p, notes: e.target.value }))}
              />
            </div>

            {/* Is Active — edit only */}
            {editingAccount !== 'new' && (
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={accountForm.is_active}
                  onChange={e => setAccountForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="rounded accent-orange-500"
                />
                Active account
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={() => setEditingAccount(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAccount}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── ADD / EDIT VEHICLE MODAL ────────────────────────────────────────── */}
      {editingVehicle !== null && (
        <Modal
          title={editingVehicle === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}
          onClose={() => setEditingVehicle(null)}
        >
          <div className="flex flex-col gap-3">
            {/* Plate No. */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                Plate No. <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. CAR-1234"
                value={vehicleForm.plate_no}
                onChange={e => setVehicleForm(p => ({ ...p, plate_no: e.target.value.toUpperCase() }))}
                onBlur={e => setVehicleForm(p => ({ ...p, plate_no: e.target.value.trim().toUpperCase() }))}
              />
            </div>

            {/* Make + Model */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Make</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Toyota"
                  value={vehicleForm.make ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, make: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Model</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Aqua"
                  value={vehicleForm.model ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, model: e.target.value }))}
                />
              </div>
            </div>

            {/* Year + Color */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Year</label>
                <input
                  type="number"
                  min={1900}
                  max={2099}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="2022"
                  value={vehicleForm.year ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, year: e.target.value ? Number(e.target.value) : null }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Color</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Silver"
                  value={vehicleForm.color ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, color: e.target.value }))}
                />
              </div>
            </div>

            {/* Fuel Type */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Fuel Type</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                value={vehicleForm.fuel_type ?? ''}
                onChange={e => setVehicleForm(p => ({ ...p, fuel_type: (e.target.value as FuelType) || null }))}
              >
                <option value="">— Select —</option>
                <option value="petrol">Petrol</option>
                <option value="diesel">Diesel</option>
                <option value="hybrid">Hybrid</option>
                <option value="electric">Electric</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Engine No. + Chassis No. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Engine No.</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Engine number"
                  value={vehicleForm.engine_no ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, engine_no: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Chassis No.</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Chassis number"
                  value={vehicleForm.chassis_no ?? ''}
                  onChange={e => setVehicleForm(p => ({ ...p, chassis_no: e.target.value }))}
                />
              </div>
            </div>

            {/* Fleet Account */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Fleet Account</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                value={vehicleForm.fleet_account_id ?? ''}
                onChange={e => setVehicleForm(p => ({ ...p, fleet_account_id: e.target.value || null }))}
              >
                <option value="">None</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.company_name}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                placeholder="Optional notes"
                value={vehicleForm.notes ?? ''}
                onChange={e => setVehicleForm(p => ({ ...p, notes: e.target.value }))}
              />
            </div>

            {/* Is Active — edit only */}
            {editingVehicle !== 'new' && (
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={vehicleForm.is_active}
                  onChange={e => setVehicleForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="rounded accent-orange-500"
                />
                Active vehicle
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={() => setEditingVehicle(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveVehicle}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-black text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
    </div>
  )
}
