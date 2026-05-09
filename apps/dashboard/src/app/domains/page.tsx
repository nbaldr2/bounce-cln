'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Copy, CheckCircle, RefreshCw, Trash2, Shield } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Domain {
  id: string; domain: string; dkimSelector: string; dkimDnsRecord: string;
  spfRecord: string | null; dnsVerified: boolean; lastDnsCheck: string | null; createdAt: string;
}

interface DnsRecord { type: string; name: string; value: string; purpose: string }

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ domain: '', selector: 'bounce' });
  const [saving, setSaving] = useState(false);
  const [dnsRecords, setDnsRecords] = useState<{ domain: string; records: DnsRecord[] } | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/domains`);
      const data = await res.json();
      setDomains(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const addDomain = async () => {
    if (!form.domain) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setShowModal(false);
      setForm({ domain: '', selector: 'bounce' });
      fetch_();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const viewDns = async (domain: Domain) => {
    const res = await fetch(`${API}/api/domains/${domain.id}/dns-records`);
    const data = await res.json();
    setDnsRecords(data);
  };

  const verifyDns = async (id: string) => {
    setVerifying(id);
    try {
      await fetch(`${API}/api/domains/${id}/verify-dns`, { method: 'POST' });
      fetch_();
    } catch { /* ignore */ }
    finally { setVerifying(null); }
  };

  const deleteDomain = async (id: string) => {
    if (!confirm('Delete this domain?')) return;
    await fetch(`${API}/api/domains/${id}`, { method: 'DELETE' });
    fetch_();
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Sending Domains</h1>
          <p className="page-subtitle">Manage DKIM/SPF records for your PowerMTA sending domains</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Domain</button>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : domains.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📧</div>
          <div className="empty-state-text">No sending domains configured</div>
          <div className="empty-state-sub">Add a domain to generate DKIM keys automatically</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}><Plus size={16} /> Add Domain</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {domains.map(d => (
            <div key={d.id} className="card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{d.domain}</span>
                    <span className={`badge ${d.dnsVerified ? 'badge-green' : 'badge-yellow'}`}>
                      {d.dnsVerified ? '✓ DNS Verified' : '⚠ DNS Unverified'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Selector: <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.dkimSelector}</code>
                    {d.lastDnsCheck && <span style={{ marginLeft: 12 }}>Last check: {new Date(d.lastDnsCheck).toLocaleString()}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => viewDns(d)}>
                    <Shield size={13} /> DNS Records
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => verifyDns(d.id)} disabled={verifying === d.id}>
                    {verifying === d.id ? <><div className="spinner" style={{ width: 12, height: 12 }} /></> : <><RefreshCw size={13} /> Verify DNS</>}
                  </button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => deleteDomain(d.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Domain Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add Sending Domain</h2>
            <div className="form-group">
              <label className="form-label">Domain</label>
              <input className="input" placeholder="mail.example.com" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">DKIM Selector</label>
              <input className="input" placeholder="bounce" value={form.selector} onChange={e => setForm(f => ({ ...f, selector: e.target.value }))} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 6, padding: '10px 12px' }}>
              ✨ An RSA-2048 DKIM key pair will be generated automatically. You'll see the DNS records to add after creation.
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addDomain} disabled={saving || !form.domain}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /></> : <><Plus size={14} /> Generate & Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DNS Records Modal */}
      {dnsRecords && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDnsRecords(null)}>
          <div className="modal" style={{ maxWidth: 600 }}>
            <h2 className="modal-title">DNS Records for {dnsRecords.domain}</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Add these records to your DNS provider. DKIM verification may take up to 24–48 hours to propagate.
            </p>
            {dnsRecords.records.map((r, i) => (
              <div key={i} className="dns-record">
                <div className="dns-record-type">{r.type} · {r.purpose}</div>
                <div className="dns-record-name">Name: {r.name}</div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
                  <div className="dns-record-value" style={{ flex: 1 }}>{r.value}</div>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ flexShrink: 0 }} onClick={() => copyText(r.value, `${i}`)}>
                    {copied === `${i}` ? <CheckCircle size={13} color="var(--green)" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            ))}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDnsRecords(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
