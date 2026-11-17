import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import toast from 'react-hot-toast';
import {
  Youtube,
  Settings as SettingsIcon,
  Clock,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
  AlertCircle,
  Unlink,
  Link as LinkIcon,
  Save,
  ShieldAlert
} from 'lucide-react';

export default function Settings() {
  const [searchParams] = useSearchParams();
  const { user, youtubeConnected, youtubeChannel, refreshUserData } = useAuth();

  const [intervalMinutes, setIntervalMinutes] = useState(10);
  const [autoPublish, setAutoPublish] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [connectingYt, setConnectingYt] = useState(false);

  useEffect(() => {
    // Handle OAuth callback redirects
    const ytStatus = searchParams.get('youtube');
    if (ytStatus === 'connected') {
      toast.success('YouTube channel connected successfully!');
      refreshUserData();
    } else if (ytStatus === 'error') {
      const reason = searchParams.get('reason') || 'unknown';
      toast.error(`YouTube connection failed: ${reason}`);
    }
  }, [searchParams, refreshUserData]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.get('/settings');
        setIntervalMinutes(data.publishIntervalMinutes || 10);
        setAutoPublish(data.autoPublish !== undefined ? data.autoPublish : true);
      } catch (err) {
        toast.error('Failed to load user settings');
      } finally {
        setLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  const handleConnectYouTube = async () => {
    setConnectingYt(true);
    try {
      const data = await api.get('/youtube/auth-url');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast.error(err.message || 'Failed to initiate YouTube authorization');
      setConnectingYt(false);
    }
  };

  const handleDisconnectYouTube = async () => {
    if (!window.confirm('Are you sure you want to disconnect your YouTube channel? Queued publishing will pause.')) {
      return;
    }
    try {
      await api.delete('/youtube/disconnect');
      toast.success('YouTube channel disconnected');
      refreshUserData();
    } catch (err) {
      toast.error('Failed to disconnect YouTube');
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await api.put('/settings', {
        publishIntervalMinutes: parseInt(intervalMinutes, 10),
        autoPublish,
      });
      toast.success('Settings saved successfully!');
    } catch (err) {
      toast.error(err.message || 'Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          System Configuration & Integrations
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Manage your verified YouTube Data API connection, FIFO queue intervals, and compliance policies
        </p>
      </div>

      {/* YouTube Connection Card */}
      <div className="card p-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <Youtube className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Official YouTube Data API Integration</h2>
            <p className="text-xs text-slate-500">
              Requires OAuth 2.0 permissions to upload and distribute YouTube Shorts
            </p>
          </div>
        </div>

        <div className="pt-4 space-y-4">
          {youtubeConnected ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  ✓
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">
                      {youtubeChannel?.channelTitle || 'Connected Channel'}
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded-full">
                      ACTIVE
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    Channel ID: <code className="font-mono">{youtubeChannel?.channelId || 'N/A'}</code>
                  </span>
                </div>
              </div>

              <button
                onClick={handleDisconnectYouTube}
                className="btn-secondary py-1.5 px-3 text-xs text-rose-700 border-rose-200 hover:bg-rose-50 shrink-0"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect Channel</span>
              </button>
            </div>
          ) : (
            <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <p className="font-semibold text-amber-950">No YouTube Channel Connected</p>
                  <p className="text-amber-800 mt-0.5">
                    Connect your YouTube channel using Google OAuth 2.0 to enable automatic Shorts publishing from the queue.
                  </p>
                </div>
              </div>

              <button
                onClick={handleConnectYouTube}
                disabled={connectingYt}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg text-xs shadow-sm flex items-center justify-center gap-2 shrink-0 transition-colors"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>{connectingYt ? 'Redirecting...' : 'Connect YouTube'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Queue & Publishing Automation Settings */}
      <div className="card p-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Publishing Queue Parameters</h2>
            <p className="text-xs text-slate-500">
              Configure distribution pacing and automated publishing triggers
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveSettings} className="pt-4 space-y-5">
          {/* Interval setting */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Publishing Interval (Minutes between Shorts)
            </label>
            <div className="flex items-center gap-3 max-w-xs">
              <input
                type="number"
                min="1"
                max="1440"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                required
                className="input-field text-sm"
              />
              <span className="text-xs text-slate-500 shrink-0">min (Default: 10m)</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Spacing out Shorts prevents rate-limiting and optimizes YouTube algorithmic discovery.
            </p>
          </div>

          {/* Auto-publish toggle */}
          <div className="pt-2 flex items-center justify-between max-w-lg p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-900 block">
                Automatic Queue Publishing
              </span>
              <span className="text-xs text-slate-500">
                When enabled, the background worker publishes due videos automatically.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAutoPublish(!autoPublish)}
              className="text-brand-600 hover:text-brand-700 p-1"
            >
              {autoPublish ? (
                <ToggleRight className="w-8 h-8 text-brand-600" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-400" />
              )}
            </button>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={savingSettings}
              className="btn-primary py-2 px-4 text-xs font-semibold"
            >
              <Save className="w-4 h-4" />
              <span>{savingSettings ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Account Info */}
      <div className="card p-6">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
          Account Profile
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="text-slate-500">Name:</span>
            <span className="font-medium text-slate-800">{user?.displayName}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="text-slate-500">Email:</span>
            <span className="font-medium text-slate-800">{user?.email}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">User ID:</span>
            <span className="font-mono text-slate-400 text-[11px]">{user?.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
