'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Terminal, Cpu, MemoryStick, Activity } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Node {
  id: string; hostname: string; ip: string; sshPort: number; sshUser: string;
  status: string; cpuUsage: number; memoryUsage: number; queueDepth: number;
  lastHeartbeat: string | null; pmtaConfigured: boolean; warmupDay: number;
  maxChecksPerDay: number; errorMessage: string | null;
  ips: { id: string; ip: string; provider: string; reputationScore: number; warmupDay: number; dailyCount: number }[];
}

const statusBadge: Record<string, string> = {
  ONLINE: 'badge-green', OFFLINE: 'badge-red', PROVISIONING: 'badge-yellow',
  ERROR: 'badge-orange', PENDING: 'badge-muted', MAINTENANCE: 'badge-purple',
};

export default function NodesPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ hostname: '', ip: '', sshPort: '22', sshUser: 'root', sshPassword: '' });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/nodes`);
      const data = await res.json();
      setNodes(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); const t = setInterval(fetch_, 10000); return () => clearInterval(t); }, [fetch_]);

  const addNode = async () => {
    if (!form.hostname || !form.ip) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sshPort: parseInt(form.sshPort) }),
      });
      setShowModal(false);
      setForm({ hostname: '', ip: '', sshPort: '22', sshUser: 'root', sshPassword: '' });
      fetch_();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const deleteNode = async (id: string) => {
    if (!confirm('Delete this node?')) return;
    await fetch(`${API}/api/nodes/${id}`, { method: 'DELETE' });
    fetch_();
  };

  const reprovision = async (id: string) => {
    await fetch(`${API}/api/nodes/${id}/provision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    fetch_();
  };

  const statusClass: Record<string, string> = {
    ONLINE: 'online', OFFLINE: 'offline', PROVISIONING: 'provisioning', ERROR: 'error',
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">VPS Nodes</h1>
          <p className="page-subtitle">Manage and monitor PowerMTA verification nodes</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetch_}><RefreshCw size={14} /> Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Node</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Loading nodes...</div>
      ) : nodes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🖥️</div>
          <div className="empty-state-text">No nodes configured</div>
          <div className="empty-state-sub">Add your first VPS node to start verifying emails</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}><Plus size={16} /> Add Node</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {nodes.map(node => (
            <div key={node.id} className={`node-card ${statusClass[node.status] || ''}`}>
              <div className="node-header">
                <div>
                  <div className="node-name">{node.hostname}</div>
                  <div className="node-ip">{node.ip}:{node.sshPort}</div>
                </div>
                <span className={`badge ${statusBadge[node.status] || 'badge-muted'}`}>{node.status}</span>
              </div>

              {node.errorMessage && (
                <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
                  {node.errorMessage}
                </div>
              )}

              <div className="node-metrics">
                <div className="metric-item">
                  <div className="metric-val" style={{ color: node.cpuUsage > 80 ? 'var(--red)' : 'var(--text-primary)' }}>{node.cpuUsage.toFixed(0)}%</div>
                  <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}><Cpu size={10} /> CPU</div>
                </div>
                <div className="metric-item">
                  <div className="metric-val" style={{ color: node.memoryUsage > 85 ? 'var(--red)' : 'var(--text-primary)' }}>{node.memoryUsage.toFixed(0)}%</div>
                  <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}><MemoryStick size={10} /> RAM</div>
                </div>
                <div className="metric-item">
                  <div className="metric-val">{node.queueDepth}</div>
                  <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}><Activity size={10} /> Queue</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge badge-muted">Warmup Day {node.warmupDay}</span>
                <span className="badge badge-muted">Max {node.maxChecksPerDay}/day</span>
                {node.pmtaConfigured && <span className="badge badge-green">PMTA ✓</span>}
              </div>

              {/* IPs */}
              {node.ips.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, fontWeight: 600 }}>IPs</div>
                  {node.ips.map(ip => (
                    <div key={ip.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{ip.ip}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {ip.provider && <span className="badge badge-blue" style={{ fontSize: 10 }}>{ip.provider}</span>}
                        <span style={{ fontSize: 11, color: ip.reputationScore < 50 ? 'var(--red)' : 'var(--green)' }}>Rep: {ip.reputationScore.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                Last heartbeat: {node.lastHeartbeat ? new Date(node.lastHeartbeat).toLocaleTimeString() : 'Never'}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setSelected(node)}>
                  <Terminal size={13} /> Details
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => reprovision(node.id)}>
                  <RefreshCw size={13} />
                </button>
                <button className="btn btn-danger btn-sm btn-icon" onClick={() => deleteNode(node.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Node Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add VPS Node</h2>
            <div className="form-group">
              <label className="form-label">Hostname</label>
              <input className="input" placeholder="node1.example.com" value={form.hostname} onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">IP Address</label>
              <input className="input" placeholder="1.2.3.4" value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">SSH Port</label>
                <input className="input" placeholder="22" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">SSH User</label>
                <input className="input" placeholder="root" value={form.sshUser} onChange={e => setForm(f => ({ ...f, sshUser: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">SSH Password</label>
              <input type="password" className="input" placeholder="Leave blank to use SSH key" value={form.sshPassword} onChange={e => setForm(f => ({ ...f, sshPassword: e.target.value }))} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 6, padding: '10px 12px' }}>
              ℹ️ The master will SSH into this node and automatically install the verification agent.
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addNode} disabled={saving || !form.hostname || !form.ip}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Provisioning...</> : <><Plus size={14} /> Add & Provision</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Node detail modal */}
      {selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2 className="modal-title">{selected.hostname}</h2>
            <div className="code-block">
              {JSON.stringify({ id: selected.id, ip: selected.ip, status: selected.status, warmupDay: selected.warmupDay, pmtaConfigured: selected.pmtaConfigured }, null, 2)}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
