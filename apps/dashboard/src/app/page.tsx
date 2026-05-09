'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Server, CheckCircle, XCircle, AlertTriangle, RefreshCw, Activity } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Overview {
  nodes: { online: number; offline: number; provisioning: number; error: number };
  results: { total: number; valid: number; invalid: number; unknown: number; catchAll: number; softBounce: number; greylisted: number; timeout: number };
  lists: Record<string, number>;
  retryQueueDepth: number;
  activeAlerts: number;
}

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
  node?: { hostname: string; ip: string };
}

const STATUS_COLORS = ['#22c55e','#ef4444','#f59e0b','#94a3b8','#a855f7','#f97316'];

const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [throughput, setThroughput] = useState<{ hour: string; count: number }[]>([]);
  const [providers, setProviders] = useState<Record<string, Record<string, number>>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [ov, tp, pv, al] = await Promise.all([
        fetch(`${API}/api/dashboard/overview`).then(r => r.json()),
        fetch(`${API}/api/dashboard/throughput`).then(r => r.json()),
        fetch(`${API}/api/dashboard/providers`).then(r => r.json()),
        fetch(`${API}/api/dashboard/alerts?resolved=false`).then(r => r.json()),
      ]);
      setOverview(ov);
      setThroughput(Array.isArray(tp) ? tp.map((d: any) => ({
        hour: new Date(d.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        count: d.count,
      })) : []);
      setProviders(pv || {});
      setAlerts(Array.isArray(al) ? al.slice(0, 5) : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);

  const resolveAlert = async (id: string) => {
    await fetch(`${API}/api/dashboard/alerts/${id}/resolve`, { method: 'PUT' });
    setAlerts(a => a.filter(x => x.id !== id));
  };

  const resultPie = overview ? [
    { name: 'Valid', value: overview.results.valid },
    { name: 'Invalid', value: overview.results.invalid },
    { name: 'Soft Bounce', value: overview.results.softBounce },
    { name: 'Unknown', value: overview.results.unknown },
    { name: 'Catch-All', value: overview.results.catchAll },
    { name: 'Timeout', value: overview.results.timeout },
  ].filter(d => d.value > 0) : [];

  const providerBar = Object.entries(providers).map(([p, stats]) => ({
    provider: p,
    valid: stats['VALID'] || 0,
    invalid: stats['INVALID'] || 0,
    unknown: (stats['UNKNOWN'] || 0) + (stats['SOFT_BOUNCE'] || 0),
  }));

  if (loading) return (
    <div className="loading-state"><div className="spinner" /> Loading dashboard...</div>
  );

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Real-time verification orchestration metrics</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {alerts.map(a => (
            <div key={a.id} className={`alert-banner ${a.severity.toLowerCase()}`}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="alert-message">{a.message}</span>
              <span className="alert-time">{new Date(a.createdAt).toLocaleTimeString()}</span>
              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => resolveAlert(a.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Top stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' }}>
        {[
          { label: 'Total Verified',  value: fmt(overview?.results.total || 0), color: 'var(--accent)', icon: <Activity size={16} /> },
          { label: 'Valid',           value: fmt(overview?.results.valid || 0),   color: 'var(--green)',  icon: <CheckCircle size={16} /> },
          { label: 'Hard Bounces',    value: fmt(overview?.results.invalid || 0), color: 'var(--red)',   icon: <XCircle size={16} /> },
          { label: 'Nodes Online',    value: `${overview?.nodes.online || 0}`,    color: 'var(--blue)',  icon: <Server size={16} /> },
          { label: 'Retry Queue',     value: `${overview?.retryQueueDepth || 0}`, color: 'var(--yellow)', icon: <RefreshCw size={16} /> },
          { label: 'Active Alerts',   value: `${overview?.activeAlerts || 0}`,    color: 'var(--orange)', icon: <AlertTriangle size={16} /> },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ ['--accent-color' as any]: s.color }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="stat-label">{s.label}</span>
              <span style={{ color: s.color, opacity: 0.8 }}>{s.icon}</span>
            </div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* Throughput */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Emails/Hour (Last 24h)</span>
          </div>
          {throughput.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <div className="empty-state-text">No throughput data yet</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={throughput}>
                <defs>
                  <linearGradient id="tpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#1a1d24', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#tpGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Result breakdown pie */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Result Breakdown</span>
          </div>
          {resultPie.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <div className="empty-state-text">No results yet</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={resultPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {resultPie.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a1d24', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Provider bar chart */}
      {providerBar.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Results by MX Provider</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={providerBar} barSize={20}>
              <XAxis dataKey="provider" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1a1d24', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="valid"   fill="#22c55e" radius={[4,4,0,0]} />
              <Bar dataKey="invalid" fill="#ef4444" radius={[4,4,0,0]} />
              <Bar dataKey="unknown" fill="#f59e0b" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
