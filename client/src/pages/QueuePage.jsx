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
  AlertCircle
} from 'lucide-react';
import QueueList from '../components/QueueList.jsx';
import { format } from 'date-fns';

export default function QueuePage() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Periodic polling every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchQueue();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleRemove = async (videoId) => {
    try {
      await api.delete(`/videos/${videoId}/queue`);
      toast.success('Removed video from queue');
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            FIFO Publishing Queue
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Ordered sequence of approved Shorts waiting for automated publishing to YouTube
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

      {/* Queue Stats Banner */}
      {stats && stats.totalInQueue > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card p-4">
            <span className="text-xs text-slate-400 block mb-1">Total Queued</span>
            <span className="text-xl font-bold text-slate-900">{stats.totalInQueue} Videos</span>
          </div>
          <div className="card p-4">
            <span className="text-xs text-slate-400 block mb-1">Next Video Scheduled</span>
            <span className="text-sm font-semibold text-indigo-700">
              {stats.nextScheduledAt
                ? format(new Date(stats.nextScheduledAt), 'PPp')
                : 'Immediately'}
            </span>
          </div>
          <div className="card p-4">
            <span className="text-xs text-slate-400 block mb-1">Estimated Completion</span>
            <span className="text-sm font-semibold text-slate-800">
              {stats.estimatedCompletionAt
                ? format(new Date(stats.estimatedCompletionAt), 'PPp')
                : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Queue Items List */}
      <QueueList
        queue={queue}
        onRemove={handleRemove}
        onReorder={handleReorder}
        loading={loading}
      />
    </div>
  );
}
