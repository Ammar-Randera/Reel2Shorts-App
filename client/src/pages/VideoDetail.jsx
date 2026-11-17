import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Film,
  Clock,
  HardDrive,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Youtube,
  ExternalLink,
  Trash2,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  Copy,
  Check
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge.jsx';
import { format } from 'date-fns';

export default function VideoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedDesc, setCopiedDesc] = useState(false);

  const fetchVideo = useCallback(async () => {
    try {
      const data = await api.get(`/videos/${id}`);
      setVideo(data.video);
    } catch (err) {
      toast.error('Failed to load video details: ' + err.message);
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchVideo();
  }, [fetchVideo]);

  // Polling if processing
  useEffect(() => {
    if (!video || (video.status !== 'processing' && video.status !== 'publishing')) {
      return;
    }
    const timer = setInterval(() => {
      fetchVideo();
    }, 4000);
    return () => clearInterval(timer);
  }, [video, fetchVideo]);

  const handleQueue = async () => {
    try {
      await api.post(`/videos/${id}/queue`, {});
      toast.success('Added to publishing queue!');
      fetchVideo();
    } catch (err) {
      toast.error(err.message || 'Queueing failed');
    }
  };

  const handleDequeue = async () => {
    try {
      await api.delete(`/videos/${id}/queue`);
      toast.success('Removed from publishing queue');
      fetchVideo();
    } catch (err) {
      toast.error(err.message || 'Dequeuing failed');
    }
  };

  const handleRetry = async () => {
    try {
      await api.post(`/videos/${id}/retry`, {});
      toast.success('Queued for reprocessing');
      fetchVideo();
    } catch (err) {
      toast.error(err.message || 'Retry failed');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this video?')) return;
    try {
      await api.delete(`/videos/${id}`);
      toast.success('Video deleted');
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'title') {
      setCopiedTitle(true);
      setTimeout(() => setCopiedTitle(false), 2000);
    } else {
      setCopiedDesc(true);
      setTimeout(() => setCopiedDesc(false), 2000);
    }
    toast.success('Copied to clipboard');
  };

  if (loading) {
    return (
      <div className="card p-12 text-center max-w-4xl mx-auto">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-brand-500 border-t-transparent"></div>
        <p className="text-xs text-slate-500 mt-2">Loading video analysis...</p>
      </div>
    );
  }

  if (!video) return null;

  const policy = video.policy_result;
  const analysis = video.ai_analysis;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back Link & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>

        <div className="flex items-center gap-2">
          {video.status === 'analyzed' && (
            <button onClick={handleQueue} className="btn-primary py-1.5 px-3 text-xs">
              <PlusCircle className="w-4 h-4" />
              <span>Add to Queue</span>
            </button>
          )}

          {video.status === 'queued' && (
            <button
              onClick={handleDequeue}
              className="btn-secondary py-1.5 px-3 text-xs text-amber-700 border-amber-300"
            >
              <MinusCircle className="w-4 h-4" />
              <span>Remove from Queue</span>
            </button>
          )}

          {(video.status === 'failed' || video.status === 'rejected') && (
            <button onClick={handleRetry} className="btn-secondary py-1.5 px-3 text-xs text-indigo-700">
              <RefreshCw className="w-4 h-4" />
              <span>Retry Analysis</span>
            </button>
          )}

          <button onClick={handleDelete} className="btn-danger py-1.5 px-3 text-xs">
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Main Video Overview Card */}
      <div className="card p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={video.status} />
              {video.queuePosition && (
                <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full border border-indigo-200">
                  Position #{video.queuePosition}
                </span>
              )}
            </div>
            <h1 className="text-lg font-bold text-slate-900">
              {video.ai_title || video.original_filename}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Original: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">{video.original_filename}</code>
            </p>
          </div>

          {video.youtube_url && (
            <a
              href={video.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg text-xs shadow-sm self-start shrink-0"
            >
              <Youtube className="w-4 h-4" />
              <span>View on YouTube Shorts</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Technical Specs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
          <div>
            <span className="text-slate-400 block mb-0.5">Duration</span>
            <span className="font-semibold text-slate-800">
              {video.duration_seconds ? `${Math.round(video.duration_seconds)}s` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-0.5">Dimensions</span>
            <span className="font-semibold text-slate-800">
              {video.width && video.height ? `${video.width} x ${video.height}` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-0.5">File Size</span>
            <span className="font-semibold text-slate-800">
              {(video.file_size / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-0.5">Uploaded</span>
            <span className="font-semibold text-slate-800">
              {video.created_at ? format(new Date(video.created_at), 'MMM d, yyyy') : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Policy & Risk Screening Card */}
      {policy && (
        <div className={`card p-6 border-l-4 ${policy.approved ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {policy.approved ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-rose-600" />
              )}
              <h2 className="text-sm font-bold text-slate-900">
                Automated Policy, Copyright & Reused-Content Screen
              </h2>
            </div>
            <span
              className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                policy.approved
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {policy.approved ? 'PASSED — SAFE' : 'REJECTED — HIGH RISK'}
            </span>
          </div>

          {policy.rejectionReasons && policy.rejectionReasons.length > 0 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl mb-4 text-xs text-rose-800">
              <p className="font-bold mb-1">Strict Rejection Triggered:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {policy.rejectionReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Itemized Risk Assessment:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {policy.risks.map((risk, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2 text-xs"
                >
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      risk.severity === 'low'
                        ? 'bg-emerald-500'
                        : risk.severity === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  />
                  <div>
                    <span className="font-semibold text-slate-800">{risk.category}: </span>
                    <span className="text-slate-600">{risk.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AI Generated YouTube Metadata */}
      {video.ai_title && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Cpu className="w-5 h-5 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-900">
              AI-Generated YouTube Shorts Metadata
            </h2>
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Title ({video.ai_title.length}/100 chars)
              </label>
              <button
                onClick={() => copyToClipboard(video.ai_title, 'title')}
                className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
              >
                {copiedTitle ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedTitle ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-900">
              {video.ai_title}
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Description
              </label>
              <button
                onClick={() => copyToClipboard(video.ai_description, 'desc')}
                className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
              >
                {copiedDesc ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedDesc ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 whitespace-pre-line leading-relaxed">
              {video.ai_description}
            </div>
          </div>

          {/* Hashtags */}
          {video.ai_hashtags && video.ai_hashtags.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">
                Suggested Hashtags ({video.ai_hashtags.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {video.ai_hashtags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-md font-mono"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Content Analysis Specs */}
          {analysis && (
            <div className="pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Quality Score</span>
                <span className="font-bold text-slate-800 text-sm">
                  {analysis.qualityScore}/10
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Primary Language</span>
                <span className="font-semibold text-slate-800 uppercase">
                  {analysis.language || 'en'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Categories</span>
                <span className="font-semibold text-slate-800">
                  {analysis.categories ? analysis.categories.join(', ') : 'General'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
