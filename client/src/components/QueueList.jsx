import React from 'react';
import {
  GripVertical,
  ArrowUp,
  ArrowDown,
  X,
  Clock,
  Youtube,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import StatusBadge from './StatusBadge.jsx';

export default function QueueList({ queue, onRemove, onReorder, loading }) {
  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-brand-500 border-t-transparent"></div>
        <p className="text-xs text-slate-500 mt-2">Loading publishing queue...</p>
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
          Uploaded videos that pass strict AI policy screening can be added to this FIFO queue. They will automatically be published to YouTube Shorts according to your configured interval.
        </p>
      </div>
    );
  }

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newQueue = [...queue];
    const temp = newQueue[index - 1];
    newQueue[index - 1] = newQueue[index];
    newQueue[index] = temp;
    const videoIds = newQueue.map((item) => item.video_id || item.id);
    onReorder(videoIds);
  };

  const handleMoveDown = (index) => {
    if (index === queue.length - 1) return;
    const newQueue = [...queue];
    const temp = newQueue[index + 1];
    newQueue[index + 1] = newQueue[index];
    newQueue[index] = temp;
    const videoIds = newQueue.map((item) => item.video_id || item.id);
    onReorder(videoIds);
  };

  return (
    <div className="space-y-3">
      {queue.map((item, index) => {
        const scheduledDate = item.scheduled_at ? new Date(item.scheduled_at) : null;
        const isNext = index === 0;

        return (
          <div
            key={item.queue_id || item.id}
            className={`card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 ${
              isNext ? 'border-l-indigo-600 bg-indigo-50/20' : 'border-l-slate-300'
            }`}
          >
            {/* Position and Title */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                #{item.position || index + 1}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-slate-900 text-sm truncate">
                    {item.ai_title || item.original_filename}
                  </h4>
                  {isNext && (
                    <span className="text-[10px] bg-indigo-600 text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                      Up Next
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {scheduledDate ? format(scheduledDate, 'PPp') : 'Immediately'}
                    </span>
                  </span>
                  <span>•</span>
                  <span>{item.original_filename}</span>
                </div>
              </div>
            </div>

            {/* Reorder and Remove Controls */}
            <div className="flex items-center justify-end gap-1.5 shrink-0 self-end sm:self-center">
              <button
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:pointer-events-none"
                title="Move up in queue"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleMoveDown(index)}
                disabled={index === queue.length - 1}
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
      })}
    </div>
  );
}
