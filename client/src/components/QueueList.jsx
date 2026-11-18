import React, { useState, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  X,
  Clock,
  Calendar,
  CheckCircle2,
  Loader2,
  RadioTower,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';

/** Return a human-readable countdown string from now until `targetDate`. */
function formatCountdown(targetDate) {
  const diff = targetDate - Date.now();
  if (diff <= 0) return 'now';

  const totalSeconds = Math.floor(diff / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0)   return `in ${days}d ${hours}h`;
  if (hours > 0)  return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds}s`;
  return `in ${seconds}s`;
}

/** Map video status to a colour-coded badge */
function StatusBadge({ status }) {
  const map = {
    queued:     { label: 'Queued',     cls: 'bg-indigo-100 text-indigo-700' },
    scheduled:  { label: 'Scheduled',  cls: 'bg-yellow-100 text-yellow-700' },
    publishing: { label: 'Publishing', cls: 'bg-orange-100 text-orange-700' },
    published:  { label: 'Published',  cls: 'bg-emerald-100 text-emerald-700' },
    failed:     { label: 'Failed',     cls: 'bg-red-100 text-red-700' },
  };

  const Icon = {
    queued:     Clock,
    scheduled:  Calendar,
    publishing: RadioTower,
    published:  CheckCircle2,
    failed:     AlertCircle,
  }[status] || Clock;

  const { label, cls } = map[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

/** A single queue item card with live countdown */
function QueueItem({ item, index, total, onMoveUp, onMoveDown, onRemove }) {
  const scheduledDate = item.scheduled_at ? new Date(item.scheduled_at) : null;
  const [countdown, setCountdown] = useState(scheduledDate ? formatCountdown(scheduledDate) : '—');
  const isNext = index === 0;

  // Tick every second for live countdown
  useEffect(() => {
    if (!scheduledDate) return;
    const id = setInterval(() => {
      setCountdown(formatCountdown(scheduledDate));
    }, 1000);
    return () => clearInterval(id);
  }, [item.scheduled_at]);

  return (
    <div
      className={`card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 ${
        isNext ? 'border-l-indigo-600 bg-indigo-50/30' : 'border-l-slate-200'
      }`}
    >
      {/* Left: position + info */}
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Position badge */}
        <div
          className={`w-9 h-9 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
            isNext
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          #{item.position || index + 1}
        </div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h4 className="font-semibold text-slate-900 text-sm truncate max-w-xs">
              {item.ai_title || item.original_filename}
            </h4>
            {isNext && (
              <span className="text-[10px] bg-indigo-600 text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                Up Next
              </span>
            )}
            <StatusBadge status={item.status} />
          </div>

          {/* Schedule row */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {/* Exact date/time */}
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium text-slate-700">
                {scheduledDate ? format(scheduledDate, 'MMM d, yyyy \'at\' h:mm a') : 'Immediately'}
              </span>
            </span>

            {/* Live countdown */}
            {scheduledDate && (
              <>
                <span className="text-slate-300">•</span>
                <span className="flex items-center gap-1 font-semibold text-indigo-600">
                  <Clock className="w-3.5 h-3.5" />
                  {countdown}
                </span>
              </>
            )}

            {/* Filename (secondary) */}
            <span className="text-slate-300">•</span>
            <span className="text-slate-400 truncate max-w-[140px]">{item.original_filename}</span>
          </div>
        </div>
      </div>

      {/* Right: reorder + remove controls */}
      <div className="flex items-center justify-end gap-1 shrink-0 self-end sm:self-center">
        <button
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:pointer-events-none"
          title="Move up in queue"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:pointer-events-none"
          title="Move down in queue"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
        <button
          onClick={() => onRemove(item.video_id || item.id)}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg ml-1"
          title="Remove from queue"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function QueueList({ queue, onRemove, onReorder, loading }) {
  if (loading) {
    return (
      <div className="card p-10 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-2" />
        <p className="text-xs text-slate-500">Loading publishing queue...</p>
      </div>
    );
  }

  if (!queue || queue.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl mx-auto flex items-center justify-center mb-3">
          <Clock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-800">The Publishing Queue is Empty</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Uploaded videos that pass AI policy screening can be added to this FIFO queue. They will
          automatically be published to YouTube Shorts on their scheduled time.
        </p>
      </div>
    );
  }

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newQueue = [...queue];
    [newQueue[index - 1], newQueue[index]] = [newQueue[index], newQueue[index - 1]];
    onReorder(newQueue.map((item) => item.video_id || item.id));
  };

  const handleMoveDown = (index) => {
    if (index === queue.length - 1) return;
    const newQueue = [...queue];
    [newQueue[index + 1], newQueue[index]] = [newQueue[index], newQueue[index + 1]];
    onReorder(newQueue.map((item) => item.video_id || item.id));
  };

  return (
    <div className="space-y-3">
      {queue.map((item, index) => (
        <QueueItem
          key={item.queue_id || item.id}
          item={item}
          index={index}
          total={queue.length}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
