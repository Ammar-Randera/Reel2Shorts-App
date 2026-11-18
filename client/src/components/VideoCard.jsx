import React from 'react';
import { Link } from 'react-router-dom';
import {
  Film,
  Clock,
  HardDrive,
  ExternalLink,
  Trash2,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  Eye,
  AlertCircle,
  Instagram
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import StatusBadge from './StatusBadge.jsx';

export default function VideoCard({ video, onQueue, onDequeue, onRetry, onDelete }) {
  const formatFileSize = (bytes) => {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="card hover:shadow-md transition-shadow duration-200 flex flex-col justify-between">
      <div className="p-4 sm:p-5">
        {/* Top Header: Badge + Date */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <StatusBadge status={video.status} />
          <span className="text-xs text-slate-400">
            {video.created_at ? formatDistanceToNow(new Date(video.created_at), { addSuffix: true }) : ''}
          </span>
        </div>

        {/* Video Title or Filename */}
        <div className="mb-2">
          <h3 className="font-semibold text-slate-900 line-clamp-2 text-sm leading-snug">
            {video.ai_title || video.original_filename}
          </h3>
          {video.ai_title && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              File: {video.original_filename}
            </p>
          )}
        </div>

        {/* Video Metadata Pills */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 my-3">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{formatDuration(video.duration_seconds)}</span>
          </div>
          <div className="flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
            <span>{formatFileSize(video.file_size)}</span>
          </div>
          {video.width && video.height && (
            <div className="flex items-center gap-1">
              <Film className="w-3.5 h-3.5 text-slate-400" />
              <span>{video.width}x{video.height}</span>
            </div>
          )}
        </div>

        {/* Status-specific Alerts / Details */}
        {video.status === 'rejected' && video.rejection_reason && (
          <div className="mt-2.5 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
            <div className="font-semibold flex items-center gap-1 mb-0.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Policy Rejection:</span>
            </div>
            <p className="line-clamp-2">{video.rejection_reason}</p>
          </div>
        )}

        {video.status === 'failed' && video.error_message && (
          <div className="mt-2.5 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <div className="font-semibold flex items-center gap-1 mb-0.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span>Error ({video.retry_count || 0} retries):</span>
            </div>
            <p className="line-clamp-2">{video.error_message}</p>
          </div>
        )}

        {/* Hashtags Preview */}
        {video.ai_hashtags && video.ai_hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {video.ai_hashtags.slice(0, 3).map((tag, idx) => (
              <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                #{tag}
              </span>
            ))}
            {video.ai_hashtags.length > 3 && (
              <span className="text-[10px] text-slate-400 py-0.5">
                +{video.ai_hashtags.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card Actions Footer */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
        <Link
          to={`/videos/${video.id}`}
          className="text-xs font-semibold text-brand-600 hover:text-brand-800 flex items-center gap-1"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Details</span>
        </Link>

        <div className="flex items-center gap-1.5">
          {video.status === 'analyzed' && (
            <button
              onClick={() => onQueue && onQueue(video.id)}
              className="btn-primary py-1 px-2.5 text-xs font-medium"
              title="Add to Publishing Queue"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Queue</span>
            </button>
          )}

          {video.status === 'queued' && (
            <button
              onClick={() => onDequeue && onDequeue(video.id)}
              className="btn-secondary py-1 px-2.5 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
              title="Remove from Publishing Queue"
            >
              <MinusCircle className="w-3.5 h-3.5" />
              <span>Dequeue</span>
            </button>
          )}

          {(video.status === 'failed' || video.status === 'rejected') && (
            <button
              onClick={() => onRetry && onRetry(video.id)}
              className="btn-secondary py-1 px-2.5 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50"
              title="Retry analysis"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          )}

          {video.status === 'published' && video.youtube_url && (
            <a
              href={video.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md"
            >
              <span>Watch</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <button
            onClick={() => onDelete && onDelete(video.id)}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete video"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
