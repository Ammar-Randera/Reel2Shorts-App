import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeChannel, setYoutubeChannel] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('reel2shorts_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setYoutubeConnected(data.youtubeConnected);
      setYoutubeChannel(data.youtubeChannel);
    } catch (err) {
      console.warn('Auth check failed:', err.message);
      localStorage.removeItem('reel2shorts_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('reel2shorts_token', data.token);
    setUser(data.user);
    await checkAuth();
    return data;
  };

  const register = async (email, password, displayName) => {
    const data = await api.post('/auth/register', { email, password, displayName });
    localStorage.setItem('reel2shorts_token', data.token);
    setUser(data.user);
    await checkAuth();
    return data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {}
    localStorage.removeItem('reel2shorts_token');
    setUser(null);
    setYoutubeConnected(false);
    setYoutubeChannel(null);
  };

  const refreshUserData = async () => {
    await checkAuth();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        youtubeConnected,
        youtubeChannel,
        loading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUserData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
