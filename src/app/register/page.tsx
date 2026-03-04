'use client'

import { useState } from 'react'

const SRI_LANKA_DISTRICTS = [
  'Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya',
  'Galle','Matara','Hambantota','Jaffna','Kilinochchi','Mannar',
  'Mullaitivu','Vavuniya','Trincomalee','Batticaloa','Ampara',
  'Kurunegala','Puttalam','Anuradhapura','Polonnaruwa','Badulla',
  'Monaragala','Ratnapura','Kegalle'
]

export default function RegisterPage() {
  const [form, setForm] = useState({
    email:'', password:'', confirmPassword:'', businessName:'',
    phone:'', whatsapp:'', location:'', address:'', description:'',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  function updateForm(key: string, value: string) { setForm((prev) => ({ ...prev, [key]: value })) }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (form.password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
    if (!form.businessName.trim()) { setError('Business name is required'); setLoading(false); return }
    if (!form.phone.trim()) { setError('Phone number is required'); setLoading(false); return }
    if (!form.location) { setError('Please select your district'); setLoading(false); return }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          businessName: form.businessName.trim(),
          phone: form.phone.trim(),
          whatsapp: form.whatsapp.trim() || form.phone.trim(),
          location: form.location,
          address: form.address.trim(),
          description: form.description.trim(),
        }),
      })
      const json = await res.json()
      if (json.success) {
        setSuccess(true)
      } else {
        setError(json.error || 'Registration failed')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-black text-slate-900 mb-2">Registration Submitted!</h2>
          <p className="text-sm text-slate-500 mb-6">Your shop <strong>{form.businessName}</strong> is pending approval.</p>
          <a href="/" className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-6 py-2.5 rounded-lg transition">Back to Marketplace</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <a href="/" className="text-2xl font-black text-orange-500">kuruma.lk</a>
          <h1 className="text-xl font-black text-slate-900 mt-3">Start Selling</h1>
          <p className="text-sm text-slate-500 mt-1">Register your auto parts shop</p>
        </div>
        <form onSubmit={handleRegister} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Account Details</h3>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Email Address</label>
            <input type="email" required value={form.email} onChange={(e) => updateForm('email', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="your@email.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Password</label><input type="password" required value={form.password} onChange={(e) => updateForm('password', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="Min 6 chars" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Confirm Password</label><input type="password" required value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="Re-enter" /></div>
          </div>
          <hr className="border-slate-100" />
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Shop Information</h3>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Business Name *</label><input type="text" required value={form.businessName} onChange={(e) => updateForm('businessName', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="e.g. Colombo Auto Spares" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Phone *</label><input type="tel" required value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="077XXXXXXX" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">WhatsApp</label><input type="tel" value={form.whatsapp} onChange={(e) => updateForm('whatsapp', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="Same as phone if blank" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">District *</label><select required value={form.location} onChange={(e) => updateForm('location', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition"><option value="">Select your district</option>{SRI_LANKA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Street Address</label><input type="text" value={form.address} onChange={(e) => updateForm('address', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="123 Main St, Colombo 03" /></div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">About Your Shop</label><textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition resize-none" placeholder="What parts do you specialize in?" /></div>
          {error && <p className="text-red-500 text-sm font-semibold bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">{loading ? 'Registering...' : 'Register My Shop'}</button>
          <p className="text-center text-xs text-slate-400">Already have an account? <a href="/login" className="text-orange-500 font-semibold">Log In</a></p>
        </form>
      </div>
    </div>
  )
}
