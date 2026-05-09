'use client';
export default function SettingsPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Global system configuration</p>
      </div>
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          System settings are managed on the <a href="/rates" style={{ color: 'var(--accent-light)' }}>Rate Limits page</a>.
        </p>
      </div>
    </div>
  );
}
