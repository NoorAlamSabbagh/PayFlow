import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { logoutUser } from '../features/auth/authSlice';
import { Menu, LogOut, Shield } from 'lucide-react';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.auth);

  const handleLogout = () => {
    dispatch(logoutUser());
  };

  return (
    <header className="app-header">
      {/* Left: Mobile Toggle & Page Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={onToggleSidebar}
          className="btn-secondary"
          style={{ padding: '0.45rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          aria-label="Toggle navigation menu"
        >
          <Menu size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Financial Overview
          </h1>
          <span className="badge badge-neutral" style={{ fontSize: '0.675rem' }}>
            SIMULATED
          </span>
        </div>
      </div>

      {/* Right: Security Pill & Sign Out Action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0.75rem',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          color: '#6ee7b7'
        }}>
          <Shield size={13} />
          <span style={{ fontWeight: 600 }}>Active Session ({user?.role})</span>
        </div>

        <button
          onClick={handleLogout}
          id="header-logout-btn"
          className="btn btn-secondary btn-sm"
          style={{ gap: '0.4rem' }}
        >
          <LogOut size={15} />
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
};
