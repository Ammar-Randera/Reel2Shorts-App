import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import toast from 'react-hot-toast';
import {
  Film,
  Upload,
  Cpu,
  ListOrdered,
  CheckCircle,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Plus,
  Filter
} from 'lucide-react';
import VideoCard from '../components/VideoCard.jsx';
import clsx from 'clsx';

export default function Dashboard() {
  const [videos, setVideos] = useState([]);
  const [counts, setCounts] = useState({});
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchVideos = useCallback(async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      const statusParam = activeTab === 'all' ? '' : `?status=${activeTab}`;
      const data = await api.get(`/videos${statusParam}`);
      setVideos(data.videos || []);
      setCounts(data.counts || {});
      if (showToast) toast.success('Dashboard refreshed');
    } catch (err) {
      toast.error('Failed to load videos: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Polling for processing/publishing videos every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchVideos();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchVideos]);

  const handleQueue = async (videoId) => {
    try {
      await api.post(`/videos/${videoId}/queue`, {});
      toast.success('Video added to publishing queue!');
      fetchVideos();
    } catch (err) {
      toast.error(err.message || 'Failed to add video to queue');
    }
  };

  const handleDequeue = async (videoId) => {
    try {
      await api.delete(`/videos/${videoId}/queue`);
      toast.success('Removed video from queue');
      fetchVideos();
    } catch (err) {
      toast.error(err.message || 'Failed to remove from queue');
    }
  };

  const handleRetry = async (videoId) => {
    try {
      await api.post(`/videos/${videoId}/retry`, {});
      toast.success('Queued for reprocessing');
      fetchVideos();
    } catch (err) {
      toast.error(err.message || 'Failed to retry video');
    }
  };

  const handleDelete = async (videoId) => {
    if (!window.confirm('Are you sure you want to delete this video file and record?')) {
      return;
    }
    try {
      await api.delete(`/videos/${videoId}`);
      toast.success('Video deleted');
      fetchVideos();
    } catch (err) {
      toast.error(err.message || 'Failed to delete video');
    }
  };

  const tabs = [
    { id: 'all', label: 'All Videos', count: Object.values(counts).reduce((a, b) => a + b, 0) },
    { id: 'processing', label: 'Processing', count: (counts.uploaded || 0) + (counts.processing || 0) },
    { id: 'analyzed', label: 'Screened & Ready', count: counts.analyzed || 0 },
    { id: 'queued', label: 'In Queue', count: counts.queued || 0 },
    { id: 'published', label: 'Published', count: counts.published || 0 },
    { id: 'rejected', label: 'Rejected', count: counts.rejected || 0 },
    { id: 'failed', label: 'Failed', count: counts.failed || 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Video Management Hub
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Automated screening, AI metadata generation, and FIFO publishing for YouTube Shorts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchVideos(true)}
            disabled={refreshing}
            className="btn-secondary py-2 px-3 text-xs"
            title="Refresh dashboard"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link to="/upload" className="btn-primary py-2 px-3 text-xs">
            <Plus className="w-4 h-4" />
            <span>Upload Reels</span>
          </Link>
        </div>
      </div>

      {/* Stats Counter Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-3.5 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Analyzing</span>
            <Cpu className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {(counts.uploaded || 0) + (counts.processing || 0)}
          </div>
        </div>

        <div className="card p-3.5 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Passed Screen</span>
            <Film className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {counts.analyzed || 0}
          </div>
        </div>

        <div className="card p-3.5 border-l-4 border-l-indigo-600">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Queued</span>
            <ListOrdered className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {counts.queued || 0}
          </div>
        </div>

        <div className="card p-3.5 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Published</span>
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {counts.published || 0}
          </div>
        </div>

        <div className="card p-3.5 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Rejected</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {counts.rejected || 0}
          </div>
        </div>

        <div className="card p-3.5 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Failed</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {counts.failed || 0}
          </div>
        </div>
      </div>

      {/* Tabs Filter */}
      <div className="border-b border-slate-200 overflow-x-auto scrollbar-none">
        <nav className="flex space-x-2 min-w-max pb-px">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5',
                  isActive
                    ? 'border-brand-600 text-brand-600 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={clsx(
                    'px-1.5 py-0.2 rounded-full text-[10px]',
                    isActive ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Videos List Grid */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-brand-500 border-t-transparent"></div>
          <p className="text-xs text-slate-500 mt-2">Loading videos...</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
            <Film className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800">No videos found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {activeTab === 'all'
              ? 'Get started by uploading your Instagram Reels for automated AI screening and Shorts publishing.'
              : `There are currently no videos with the status "${activeTab}".`}
          </p>
          <div className="mt-4">
            <Link to="/upload" className="btn-primary py-2 px-4 text-xs">
              <Upload className="w-4 h-4" />
              <span>Upload Video Now</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onQueue={handleQueue}
              onDequeue={handleDequeue}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
