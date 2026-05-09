'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Node {
  id: string; hostname: string; ip: string; status: string;
  ips: { ip: string; provider: string }[];
}

export default function PmtaPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [domains, setDomains] = useState<{ id: string; domain: string; dnsVerified: boolean }[]>([]);
  const [selectedNode, setSelectedNode] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [config, setConfig] = useState('');
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      const [n, d] = await Promise.all([
        fetch(`${API}/api/nodes`).then(r => r.json()),
        fetch(`${API}/api/domains`).then(r => r.json()),
      ]);
      setNodes(Array.isArray(n) ? n.filter((x: Node) => x.status === 'ONLINE') : []);
      setDomains(Array.isArray(d) ? d : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const generateConfig = async () => {
    if (!selectedNode) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/pmta/generate/${selectedNode}?domain=${selectedDomain}`, { method: 'POST' });
      const data = await res.json();
      setConfig(data.config || '# Error generating config');
    } catch { setConfig('# Failed to connect to API'); }
    finally { setLoading(false); }
  };

  const downloadConfig = () => {
    const blob = new Blob([config], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'config.xml'; a.click();
    URL.revokeObjectURL(url);
  };

  const node = nodes.find(n => n.id === selectedNode);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PowerMTA Config Generator</h1>
        <p className="page-subtitle">Generate and deploy PowerMTA configuration files to your nodes</p>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Configuration Options</span></div>

          <div className="form-group">
            <label className="form-label">Target Node</label>
            <select className="select" value={selectedNode} onChange={e => setSelectedNode(e.target.value)}>
              <option value="">Select a node...</option>
              {nodes.map(n => (
                <option key={n.id} value={n.id}>{n.hostname} ({n.ip})</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Sending Domain (for DKIM)</label>
            <select className="select" value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)}>
              <option value="">None</option>
              {domains.map(d => (
                <option key={d.id} value={d.domain}>
                  {d.domain} {d.dnsVerified ? '✓ Verified' : '⚠ Unverified'}
                </option>
              ))}
            </select>
          </div>

          {node && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Node IPs</div>
              {node.ips.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No IPs configured for this node</div>
              ) : (
                node.ips.map(ip => (
                  <div key={ip.ip} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12 }}>{ip.ip}</span>
                    {ip.provider && <span className="badge badge-blue" style={{ fontSize: 10 }}>{ip.provider}</span>}
                  </div>
                ))
              )}
            </div>
          )}

          <button className="btn btn-primary" style={{ width: '100%' }} onClick={generateConfig} disabled={!selectedNode || loading}>
            {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating...</> : '⚡ Generate Config'}
          </button>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Rate Limits Applied</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { provider: 'gmail.com', limit: '3 out / 100/hr' },
                { provider: 'outlook.com', limit: '2 out / 50/hr' },
                { provider: 'yahoo.com', limit: '5 out / 200/hr' },
                { provider: 'icloud.com', limit: '3 out / 80/hr' },
                { provider: 'default', limit: '10 out / 500/hr' },
              ].map(r => (
                <div key={r.provider} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--accent-light)' }}>{r.provider}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{r.limit}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Warm-up schedule</strong> is automatically applied per IP:<br />
            Day 1–3: 200/IP/day · Day 4–7: 500/IP/day · Week 2+: 2000/IP/day
          </div>
        </div>
      </div>

      {/* Config Output */}
      {config && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Generated Config</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={downloadConfig}><Download size={13} /> Download config.xml</button>
              <button className="btn btn-ghost btn-sm" onClick={() => fetch(`${API}/api/pmta/deploy/${selectedNode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })}>
                🚀 Deploy via SSH
              </button>
            </div>
          </div>
          <pre className="code-block" style={{ maxHeight: 500, overflowY: 'auto' }}>{config}</pre>
        </div>
      )}
    </div>
  );
}
