import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Film,
  LayoutDashboard,
  Upload,
  ListOrdered,
  Settings,
  LogOut,
  Menu,
  X,
  Youtube,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';

export default function Layout({ children }) {
  const { user, logout, youtubeConnected, youtubeChannel } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Upload Reels', href: '/upload', icon: Upload },
    { name: 'Publishing Queue', href: '/queue', icon: ListOrdered },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <Link to="/" className="flex items-center gap-2 group">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform duration-200">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xl font-bold bg-gradient-to-r from-brand-700 to-indigo-700 bg-clip-text text-transparent">
                    Reel2Shorts
                  </span>
                  <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    Pro
                  </span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={clsx(
                      'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
                      isActive
                        ? 'bg-brand-50 text-brand-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Right Status & User Menu */}
            <div className="hidden md:flex items-center gap-4">
              {/* YouTube Status Indicator */}
              <div
                className={clsx(
                  'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
                  youtubeConnected
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                )}
                title={youtubeConnected ? `Connected: ${youtubeChannel?.channelTitle}` : 'YouTube not connected'}
              >
                <Youtube className="w-3.5 h-3.5" />
                <span className="font-medium truncate max-w-[120px]">
                  {youtubeConnected ? youtubeChannel?.channelTitle || 'Connected' : 'Not Connected'}
                </span>
                {youtubeConnected ? (
                  <CheckCircle className="w-3 h-3 text-red-600" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                )}
              </div>

              {/* User Dropdown / Logout */}
              <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
                <span className="text-xs text-slate-500 font-medium truncate max-w-[140px]">
                  {user?.displayName || user?.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mobile menu button */}
            <div className="flex md:hidden items-center">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-2 pb-4 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                    isActive
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.name}
                </Link>
              );
            })}
            <div className="pt-3 mt-2 border-t border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs">
                  {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
                </div>
                <div className="text-xs">
                  <p className="font-medium text-slate-900">{user?.displayName}</p>
                  <p className="text-slate-500 truncate max-w-[160px]">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="btn-secondary py-1 px-3 text-xs"
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4">
          Reel2Shorts &copy; {new Date().getFullYear()} — Production Ready Instagram Reels to YouTube Shorts Automation.
        </div>
      </footer>
    </div>
  );
}
