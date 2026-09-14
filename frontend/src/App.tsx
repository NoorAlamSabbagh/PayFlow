import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from './store';
import { checkAuth } from './features/auth/authSlice';
import { Login } from './features/auth/Login';
import { Register } from './features/auth/Register';
import { Dashboard } from './features/dashboard/Dashboard';
import { Forbidden } from './components/Forbidden';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';

export const App: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { status, isAuthenticated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    // Attempt automatic session restoration via HttpOnly refresh cookie on application load
    dispatch(checkAuth());
  }, [dispatch]);

  if (status === 'loading' && !isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />}
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="/forbidden" element={<Forbidden />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};

export default App;
