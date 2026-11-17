import React from 'react';
import clsx from 'clsx';
import {
  Upload,
  Cpu,
  CheckCircle,
  ListOrdered,
  ArrowUpCircle,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react';

export default function StatusBadge({ status, className }) {
  const configs = {
    uploaded: {
      label: 'Uploaded',
      bg: 'bg-slate-100 text-slate-700 border-slate-200',
      icon: Upload,
      animate: false,
    },
    processing: {
      label: 'Analyzing AI',
      bg: 'bg-amber-100 text-amber-800 border-amber-300',
      icon: Cpu,
      animate: true,
    },
    analyzed: {
      label: 'Passed Screen',
      bg: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: ShieldCheck,
      animate: false,
    },
    queued: {
      label: 'In Queue',
      bg: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      icon: ListOrdered,
      animate: false,
    },
    publishing: {
      label: 'Publishing',
      bg: 'bg-purple-100 text-purple-800 border-purple-300',
      icon: ArrowUpCircle,
      animate: true,
    },
    published: {
      label: 'Published',
      bg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      icon: CheckCircle,
      animate: false,
    },
    rejected: {
      label: 'Rejected (Risk)',
      bg: 'bg-rose-100 text-rose-800 border-rose-300',
      icon: ShieldAlert,
      animate: false,
    },
    failed: {
      label: 'Failed',
      bg: 'bg-red-100 text-red-800 border-red-300',
      icon: AlertTriangle,
      animate: false,
    },
  };

  const config = configs[status] || {
    label: status,
    bg: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: Upload,
    animate: false,
  };

  const Icon = config.icon;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border shadow-xs select-none',
        config.bg,
        config.animate && 'animate-pulse',
        className
      )}
    >
      <Icon className={clsx('w-3.5 h-3.5', config.animate && 'animate-spin')} />
      <span>{config.label}</span>
    </span>
  );
}
