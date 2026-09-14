import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  CreditCard,
  ReceiptText,
  ShieldAlert,
  Settings,
  X,
  ShieldCheck,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useSelector((state: RootState) => state.auth);

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', active: true },
    { name: 'Wallet', icon: Wallet, path: '#', comingSoon: 'Phase 2' },
    { name: 'Transfers', icon: ArrowLeftRight, path: '#', comingSoon: 'Phase 3' },
    { name: 'Payments', icon: CreditCard, path: '#', comingSoon: 'Phase 4' },
    { name: 'Transactions', icon: ReceiptText, path: '#', comingSoon: 'Phase 2' },
    { name: 'Risk & Security', icon: ShieldAlert, path: '#', comingSoon: 'Phase 6' },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className={`mobile-overlay ${isOpen ? 'active' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Brand Header */}
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--primary) 0%, #4338ca 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)'
            }}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>PayFlow</h2>
              <p style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Payment Platform</p>
            </div>
          </div>

          {/* Mobile Close Button */}
          <button
            onClick={onClose}
            className="btn-ghost md-hidden"
            style={{ display: 'none', padding: '0.35rem', cursor: 'pointer' }}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Sections */}
        <div style={{ flex: 1, padding: '1rem 0', overflowY: 'auto' }}>
          <div className="nav-section-title">Core Platform</div>

          <nav style={{ display: 'flex', flexDirection: 'column' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              if (item.active) {
                return (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    onClick={onClose}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={18} />
                    <span>{item.name}</span>
                  </NavLink>
                );
              }

              return (
                <div
                  key={item.name}
                  className="nav-link disabled"
                  title={`${item.name} is scheduled for ${item.comingSoon}`}
                >
                  <Icon size={18} />
                  <span style={{ flex: 1 }}>{item.name}</span>
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {item.comingSoon}
                  </span>
                </div>
              );
            })}
          </nav>

          <div className="nav-section-title" style={{ marginTop: '1.25rem' }}>Preferences</div>
          <div className="nav-link disabled" title="Settings scheduled for Phase 7">
            <Settings size={18} />
            <span style={{ flex: 1 }}>Settings</span>
            <span style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)'
            }}>
              System
            </span>
          </div>
        </div>

        {/* User Identity Footer */}
        <div style={{
          padding: '1rem 1.25rem',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(9, 13, 22, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: '#c7d2fe'
          }}>
            {user?.fullName?.charAt(0).toUpperCase() || 'U'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.fullName}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.1rem' }}>
              <span className={`badge ${user?.role === 'ADMIN' ? 'badge-warning' : 'badge-primary'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.45rem' }}>
                {user?.role}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Verified</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
