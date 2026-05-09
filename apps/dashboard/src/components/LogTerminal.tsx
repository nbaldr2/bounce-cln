'use client';
import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface LogEntry {
  id: string;
  nodeId: string;
  message: string;
  level: string;
  command?: string | null;
  createdAt: string;
}

interface Props {
  nodeId: string;
  onClose: () => void;
}

const LOG_COLORS: Record<string, string> = {
  INFO: '#94a3b8',
  SUCCESS: '#22c55e',
  WARN: '#f59e0b',
  ERROR: '#ef4444',
  OUTPUT: '#e2e8f0',
};

export default function LogTerminal({ nodeId, onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/api/nodes/${nodeId}/logs/stream`);

    es.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setLogs(prev => [...prev, log]);
      } catch { /* ignore */ }
    };

    es.addEventListener('done', () => {
      setConnected(false);
      es.close();
    });

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [nodeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal log-terminal-modal">
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="modal-title" style={{ margin: 0 }}>Provisioning Log</h2>
            <span className={`terminal-dot ${connected ? 'connected' : 'disconnected'}`} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="terminal-wrap">
          {/* initial connection message */}
          {logs.length === 0 && !connected && (
            <div className="terminal-line" style={{ color: 'var(--text-muted)' }}>
              Connecting to stream...
            </div>
          )}

          {/* Timestamp header */}
          {logs.length > 0 && (
            <div className="terminal-line terminal-header-line">
              Logs from {new Date(logs[0].createdAt).toLocaleString()}
            </div>
          )}

          {logs.map(log => (
            <div key={log.id} className="terminal-line">
              <span className="terminal-time">
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
              <span className="terminal-level" style={{ color: LOG_COLORS[log.level] || '#94a3b8' }}>
                [{log.level.padEnd(7)}]
              </span>
              <span className="terminal-msg">
                {log.level === 'OUTPUT' ? (
                  <span className="terminal-output">{log.message}</span>
                ) : (
                  log.message
                )}
              </span>
              {log.command && (
                <span className="terminal-cmd">{log.command}</span>
              )}
            </div>
          ))}

          {!connected && logs.length > 0 && (
            <div className="terminal-line" style={{ color: 'var(--green)', fontWeight: 600 }}>
              ✓ Provisioning complete
            </div>
          )}

          {connected && (
            <div className="terminal-line">
              <span className="terminal-cursor" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}