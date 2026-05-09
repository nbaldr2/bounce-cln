'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Upload, Play, Pause, Download, Trash2, RefreshCw } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface EmailList {
  id: string; name: string; fileName: string; totalEmails: number;
  processed: number; valid: number; invalid: number; unknown: number; catchAll: number;
  status: string; uploadedAt: string; completedAt: string | null;
}

const statusBadge: Record<string, string> = {
  PENDING: 'badge-muted', PROCESSING: 'badge-blue', COMPLETED: 'badge-green',
  PAUSED: 'badge-yellow', FAILED: 'badge-red',
};

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="progress-bar-wrap">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{value.toLocaleString()} / {max.toLocaleString()} ({pct}%)</div>
    </div>
  );
}

export default function ListsPage() {
  const [lists, setLists] = useState<EmailList[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [listName, setListName] = useState('');

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/lists`);
      const data = await res.json();
      setLists(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); const t = setInterval(fetch_, 8000); return () => clearInterval(t); }, [fetch_]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', listName || file.name.replace(/\.[^.]+$/, ''));
    try {
      await fetch(`${API}/api/lists/upload`, { method: 'POST', body: fd });
      setListName('');
      fetch_();
    } catch { /* ignore */ }
    finally { setUploading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const startList  = async (id: string) => { await fetch(`${API}/api/lists/${id}/start`,  { method: 'POST' }); fetch_(); };
  const pauseList  = async (id: string) => { await fetch(`${API}/api/lists/${id}/pause`,  { method: 'POST' }); fetch_(); };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Email Lists</h1>
          <p className="page-subtitle">Upload CSV files and launch verification campaigns</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetch_}><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Upload Zone */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">Upload New List</span></div>
        <div className="form-group" style={{ maxWidth: 400 }}>
          <label className="form-label">List Name (optional)</label>
          <input className="input" placeholder="My Email Campaign" value={listName} onChange={e => setListName(e.target.value)} />
        </div>
        <div
          className={`drop-zone ${drag ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
          {uploading ? (
            <><div className="spinner" style={{ margin: '0 auto 12px' }} /><div className="drop-zone-text">Uploading and chunking...</div></>
          ) : (
            <>
              <div className="drop-zone-icon"><Upload size={36} color="var(--accent)" /></div>
              <div className="drop-zone-text">Drop a CSV file here or click to browse</div>
              <div className="drop-zone-sub">One email per row • Duplicates removed automatically</div>
            </>
          )}
        </div>
      </div>

      {/* Lists Table */}
      {loading ? (
        <div className="loading-state"><div className="spinner" /> Loading lists...</div>
      ) : lists.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">No lists uploaded yet</div>
          <div className="empty-state-sub">Upload a CSV file to get started</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Emails</th><th>Status</th><th>Progress</th>
                  <th>Valid</th><th>Invalid</th><th>Catch-All</th><th>Uploaded</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lists.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.fileName}</div>
                    </td>
                    <td>{l.totalEmails.toLocaleString()}</td>
                    <td><span className={`badge ${statusBadge[l.status] || 'badge-muted'}`}>{l.status}</span></td>
                    <td style={{ minWidth: 160 }}><ProgressBar value={l.processed} max={l.totalEmails} /></td>
                    <td><span style={{ color: 'var(--green)', fontWeight: 600 }}>{l.valid.toLocaleString()}</span></td>
                    <td><span style={{ color: 'var(--red)', fontWeight: 600 }}>{l.invalid.toLocaleString()}</span></td>
                    <td><span style={{ color: 'var(--yellow)', fontWeight: 600 }}>{l.catchAll.toLocaleString()}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(l.uploadedAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {l.status === 'PENDING' || l.status === 'PAUSED' ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => startList(l.id)}><Play size={12} /></button>
                        ) : l.status === 'PROCESSING' ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => pauseList(l.id)}><Pause size={12} /></button>
                        ) : null}
                        {l.status === 'COMPLETED' && (
                          <a className="btn btn-ghost btn-sm" href={`${API}/api/lists/${l.id}/download`} download>
                            <Download size={12} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
