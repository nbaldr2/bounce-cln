'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Job {
  id: string; batchIndex: number; emailCount: number; status: string;
  attempts: number; startedAt: string | null; completedAt: string | null; createdAt: string;
  node?: { hostname: string; ip: string } | null;
}

const statusBadge: Record<string, string> = {
  QUEUED:'badge-muted', ASSIGNED:'badge-blue', PROCESSING:'badge-purple',
  COMPLETED:'badge-green', FAILED:'badge-red', RETRYING:'badge-yellow',
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');

  const fetch_ = useCallback(async () => {
    try {
      const url = `${API}/api/jobs?page=${page}&limit=50${filter ? `&status=${filter}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setTotal(data.total || 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [page, filter]);

  useEffect(() => { fetch_(); const t = setInterval(fetch_, 5000); return () => clearInterval(t); }, [fetch_]);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">Real-time batch verification job monitor ({total.toLocaleString()} total)</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetch_}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['', 'QUEUED','ASSIGNED','PROCESSING','COMPLETED','FAILED','RETRYING'].map(s => (
          <button key={s} className={`btn btn-ghost btn-sm ${filter === s ? 'active' : ''}`}
            style={filter === s ? { background: 'var(--accent-dim)', color: 'var(--accent-light)', borderColor: 'var(--accent)' } : {}}
            onClick={() => { setFilter(s); setPage(1); }}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚙️</div>
          <div className="empty-state-text">No jobs yet</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th><th>Emails</th><th>Status</th><th>Node</th>
                  <th>Attempts</th><th>Started</th><th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const duration = j.startedAt && j.completedAt
                    ? `${Math.round((new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s`
                    : j.startedAt ? 'Running…' : '—';
                  return (
                    <tr key={j.id}>
                      <td><span className="td-mono">#{j.batchIndex}</span></td>
                      <td>{j.emailCount.toLocaleString()}</td>
                      <td><span className={`badge ${statusBadge[j.status] || 'badge-muted'}`}>{j.status}</span></td>
                      <td>
                        {j.node ? (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{j.node.hostname}</div>
                            <div className="td-mono">{j.node.ip}</div>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td>{j.attempts}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {j.startedAt ? new Date(j.startedAt).toLocaleTimeString() : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{duration}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ lineHeight: '30px', fontSize: 13, color: 'var(--text-muted)' }}>Page {page}</span>
            <button className="btn btn-ghost btn-sm" disabled={jobs.length < 50} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
