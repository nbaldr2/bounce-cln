'use client';
import { useEffect, useState, useCallback } from 'react';
import { Save, RefreshCw } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RateLimit {
  id: string; provider: string; maxSmtpOut: number;
  maxMsgRatePerHour: number; connectTimeout: number; description: string | null;
}

interface Setting { key: string; value: string; description: string | null }

export default function RatesPage() {
  const [limits, setLimits] = useState<RateLimit[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const [rl, st] = await Promise.all([
        fetch(`${API}/api/rate-limits`).then(r => r.json()),
        fetch(`${API}/api/settings`).then(r => r.json()),
      ]);
      setLimits(Array.isArray(rl) ? rl : []);
      setSettings(Array.isArray(st) ? st : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const updateLimit = async (l: RateLimit) => {
    await fetch(`${API}/api/rate-limits/${l.provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(l),
    });
    setSaved(l.provider);
    setTimeout(() => setSaved(null), 2000);
  };

  const updateSetting = async (s: Setting) => {
    await fetch(`${API}/api/settings/${s.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: s.value }),
    });
    setSaved(s.key);
    setTimeout(() => setSaved(null), 2000);
  };

  if (loading) return <div className="loading-state"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Rate Limits & Settings</h1>
          <p className="page-subtitle">Configure per-provider SMTP rate limits and system settings</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetch_}><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Rate Limits */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">Provider Rate Limits</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th><th>Max SMTP Out</th><th>Max Msg/Hour</th><th>Connect Timeout (s)</th><th>Description</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {limits.map(l => (
                <tr key={l.id}>
                  <td><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--accent-light)' }}>{l.provider}</span></td>
                  <td>
                    <input type="number" className="input" style={{ width: 80 }} value={l.maxSmtpOut}
                      onChange={e => setLimits(ls => ls.map(x => x.id === l.id ? { ...x, maxSmtpOut: parseInt(e.target.value) } : x))} />
                  </td>
                  <td>
                    <input type="number" className="input" style={{ width: 100 }} value={l.maxMsgRatePerHour}
                      onChange={e => setLimits(ls => ls.map(x => x.id === l.id ? { ...x, maxMsgRatePerHour: parseInt(e.target.value) } : x))} />
                  </td>
                  <td>
                    <input type="number" className="input" style={{ width: 80 }} value={l.connectTimeout}
                      onChange={e => setLimits(ls => ls.map(x => x.id === l.id ? { ...x, connectTimeout: parseInt(e.target.value) } : x))} />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.description}</td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => updateLimit(l)}>
                      {saved === l.provider ? '✓ Saved' : <><Save size={12} /> Save</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Settings */}
      <div className="card">
        <div className="card-header"><span className="card-title">System Settings</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {settings.map(s => (
            <div key={s.key} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
              <label className="form-label">{s.key.replace(/_/g, ' ')}</label>
              {s.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{s.description}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={s.value}
                  onChange={e => setSettings(ss => ss.map(x => x.key === s.key ? { ...x, value: e.target.value } : x))} />
                <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => updateSetting(s)}>
                  {saved === s.key ? '✓' : <Save size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
