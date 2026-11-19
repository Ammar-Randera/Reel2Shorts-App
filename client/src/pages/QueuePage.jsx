import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import toast from 'react-hot-toast';
import {
  ListOrdered,
  Clock,
  RefreshCw,
  Plus,
  Calendar,
  Zap,
  Timer,
} from 'lucide-react';
import QueueList from '../components/QueueList.jsx';
import { format } from 'date-fns';

/** Live countdown ticker — ticks every second */
function LiveCountdown({ targetDate }) {
  const calc = () => {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) return 'now';
    const totalSeconds = Math.floor(diff / 1000);
    const days    = Math.floor(totalSeconds / 86400);
    const hours   = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0)    return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0)   return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const [display, setDisplay] = useState(calc);

  useEffect(() => {
    const id = setInterval(() => setDisplay(calc()), 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return <span>{display}</span>;
}

export default function QueuePage() {
  const [queue, setQueue]       = useState([]);
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const handleTriggerWorker = async () => {
    try {
      setTriggering(true);
      await api.post('/youtube/queue/process', {});
      toast.success('Publishing worker triggered!');
      setTimeout(() => fetchQueue(), 2000);
    } catch (err) {
      toast.error('Failed to trigger worker: ' + err.message);
    } finally {
      setTriggering(false);
    }
  };

  const fetchQueue = useCallback(async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      const [queueData, statsData] = await Promise.all([
        api.get('/youtube/queue'),
        api.get('/youtube/queue/stats'),
      ]);
      setQueue(queueData.queue || []);
      setStats(statsData || null);
      if (showToast) toast.success('Queue refreshed');
    } catch (err) {
      toast.error('Failed to load publishing queue: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Poll every 30 s — countdowns tick live client-side, we just need fresh scheduled_at values
  useEffect(() => {
    const interval = setInterval(() => fetchQueue(), 30000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleRemove = async (videoId) => {
    try {
      await api.delete(`/videos/${videoId}/queue`);
      toast.success('Removed from queue');
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to remove from queue');
    }
  };

  const handleReorder = async (videoIds) => {
    try {
      await api.put('/youtube/queue/reorder', { videoIds });
      toast.success('Queue order updated');
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to reorder queue');
    }
  };

  const hasQueue    = !loading && queue.length > 0;
  const nextAt      = stats?.nextScheduledAt ? new Date(stats.nextScheduledAt) : null;
  const completedAt = stats?.estimatedCompletionAt ? new Date(stats.estimatedCompletionAt) : null;
  const interval    = stats?.intervalMinutes || 10;
  const isPastDue   = nextAt && nextAt <= new Date();

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Publishing Schedule
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            FIFO queue · publishes every {interval} minutes · times sourced from backend scheduler
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchQueue(true)}
            disabled={refreshing}
            className="btn-secondary py-2 px-3 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link to="/" className="btn-primary py-2 px-3 text-xs">
            <Plus className="w-4 h-4" />
            <span>Add from Dashboard</span>
          </Link>
        </div>
      </div>

      {/* ── Prominent "Next Publication" banner ── */}
      {hasQueue && nextAt && (
        <div
          className={`rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm border ${
            isPastDue
              ? 'bg-orange-50 border-orange-200'
              : 'bg-indigo-50 border-indigo-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isPastDue ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'
              }`}
            >
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                Next Publication
              </p>
              <p className={`text-lg font-bold ${isPastDue ? 'text-orange-700' : 'text-indigo-800'}`}>
                {format(nextAt, "MMMM d, yyyy 'at' h:mm a")}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {queue[0]?.ai_title || queue[0]?.original_filename || 'Next video'}
              </p>
            </div>
          </div>

          {/* Live countdown and action */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
            <div
              className={`flex items-center gap-2 text-2xl font-mono font-bold tracking-tight ${
                isPastDue ? 'text-orange-600' : 'text-indigo-600'
              }`}
            >
              <Timer className="w-6 h-6 shrink-0" />
              {isPastDue
                ? <span className="text-orange-600 text-base font-semibold">Due for publishing</span>
                : <LiveCountdown targetDate={nextAt} />
              }
            </div>

            {isPastDue && (
              <button
                onClick={handleTriggerWorker}
                disabled={triggering}
                className="btn-primary py-1.5 px-3 text-xs bg-orange-600 hover:bg-orange-700 shadow-sm"
                title="Trigger publishing worker now"
              >
                <span>{triggering ? 'Publishing...' : 'Publish Now'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Stats cards ── */}
      {hasQueue && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Total in Queue</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">
              {stats?.totalInQueue ?? queue.length}
            </span>
            <span className="text-xs text-slate-400 ml-1">videos</span>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>Next Slot</span>
            </div>
            <span className="text-sm font-semibold text-indigo-700">
              {nextAt ? format(nextAt, 'PPp') : 'Immediately'}
            </span>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Queue Clears At</span>
            </div>
            <span className="text-sm font-semibold text-slate-700">
              {completedAt ? format(completedAt, 'PPp') : '—'}
            </span>
          </div>
        </div>
      )}

      {/* ── Queue item list ── */}
      <QueueList
        queue={queue}
        onRemove={handleRemove}
        onReorder={handleReorder}
        loading={loading}
      />

    </div>
  );
}
