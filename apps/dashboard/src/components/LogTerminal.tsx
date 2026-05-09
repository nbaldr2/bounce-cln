'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const connectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${API}/api/nodes/${nodeId}/logs/stream`);
    esRef.current = es;

    let failedOnce = false;

    es.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setLogs(prev => [...prev, log]);
        setErrorMsg(null);
        setRetryCount(0);
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('done', () => {
      setConnected(false);
      es.close();
    });

    es.onopen = () => {
      setConnected(true);
      setErrorMsg(null);
    };

    es.onerror = () => {
      setConnected(false);
      if (!failedOnce) {
        failedOnce = true;
        setRetryCount(c => c + 1);
        if (retryCount > 3) {
          setErrorMsg('Connection lost. Make sure the node ID is correct and the API is running.');
        }
      }
    };
  }, [nodeId, retryCount]);

  useEffect(() => {
    connectSSE();
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, [connectSSE]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleRetry = () => {
    setRetryCount(0);
    setErrorMsg(null);
    setLogs([]);
    connectSSE();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal log-terminal-modal">
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="modal-title" style={{ margin: 0 }}>Provisioning Log</h2>
            <span className={`terminal-dot ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? (
              <span style={{ fontSize: 11, color: 'var(--green)' }}>connected</span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>disconnected</span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="terminal-wrap">
          {/* Error state */}
          {errorMsg && (
            <div className="terminal-line" style={{ padding: '8px 0' }}>
              <div style={{ color: 'var(--red)', marginBottom: 6, fontSize: 13 }}>⚠ {errorMsg}</div>
              <button className="btn btn-sm" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer', padding: '4px 10px', borderRadius: 4, fontSize: 12 }} onClick={handleRetry}>
                Retry Connection
              </button>
            </div>
          )}

          {/* initial connection message */}
          {logs.length === 0 && !errorMsg && !connected && (
            <div className="terminal-line" style={{ color: 'var(--text-muted)' }}>
              Connecting to stream{retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}...
            </div>
          )}

          {logs.length === 0 && connected && !errorMsg && (
            <div className="terminal-line" style={{ color: 'var(--text-muted)' }}>
              Waiting for provisioning logs...
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

          {!connected && logs.length > 0 && !errorMsg && (
            <div className="terminal-line" style={{ color: 'var(--green)', fontWeight: 600 }}>
              ✓ Provisioning complete
            </div>
          )}

          {connected && !errorMsg && (
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