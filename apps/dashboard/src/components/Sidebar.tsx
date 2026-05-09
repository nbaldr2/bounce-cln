'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Server, ListChecks, Briefcase,
  Mail, Settings, ShieldCheck, Sliders
} from 'lucide-react';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const navItems = [
  { label: 'Overview',    href: '/',          icon: LayoutDashboard },
  { label: 'Nodes',       href: '/nodes',     icon: Server },
  { label: 'Lists',       href: '/lists',     icon: ListChecks },
  { label: 'Jobs',        href: '/jobs',      icon: Briefcase },
  { label: 'Domains',     href: '/domains',   icon: Mail },
  { label: 'PMTA Config', href: '/pmta',      icon: Sliders },
  { label: 'Rate Limits', href: '/rates',     icon: ShieldCheck },
  { label: 'Settings',    href: '/settings',  icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch(`${API}/api/dashboard/alerts?resolved=false`);
        const data = await res.json();
        setAlertCount(Array.isArray(data) ? data.length : 0);
      } catch { /* ignore */ }
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon">⚡</div>
          <div>
            <div className="logo-text">Bounce-CLN</div>
            <div className="logo-sub">SMTP Orchestrator</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon className="nav-icon" size={18} />
              <span>{item.label}</span>
              {item.href === '/nodes' && alertCount > 0 && (
                <span className="nav-badge">{alertCount}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <div className="status-dot" />
          <span>API Connected</span>
        </div>
      </div>
    </aside>
  );
}
