import React, { useState } from 'react';
import { api } from '../api/client.js';
import toast from 'react-hot-toast';
import {
  Instagram,
  Link as LinkIcon,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Trash2,
  Plus,
  Info
} from 'lucide-react';
import clsx from 'clsx';

export default function ReelUrlImporter({ onSuccess, compact = false }) {
  const [urlInput, setUrlInput] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState('');
  const [results, setResults] = useState(null);

  // Parse URLs entered by user (supports newline or comma-separated)
  const rawUrls = urlInput
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const isValidInstagramUrl = (url) => {
    return /instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i.test(url);
  };

  const validUrls = rawUrls.filter(isValidInstagramUrl);
  const invalidUrls = rawUrls.filter((u) => !isValidInstagramUrl(u));

  const handleImport = async (e) => {
    e.preventDefault();

    if (validUrls.length === 0) {
      toast.error('Please enter at least one valid Instagram Reel URL.');
      return;
    }

    if (!rightsConfirmed) {
      toast.error('Please confirm you own or have permission to use these Reels.');
      return;
    }

    setIsImporting(true);
    setResults(null);
    setImportStep('Triggering Apify Instagram Reel Scraper actor...');

    try {
      // Step feedback updates
      const stepTimer1 = setTimeout(() => {
        setImportStep('Apify is extracting Reel metadata and CDN video stream...');
      }, 3000);

      const stepTimer2 = setTimeout(() => {
        setImportStep('Downloading high-res video file to persistent cloud storage...');
      }, 9000);

      const response = await api.post('/videos/import-reels', { urls: validUrls });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      const resData = response.results || {};
      setResults(resData);

      const importedCount = resData.imported ? resData.imported.length : 0;
      const dupeCount = resData.skippedDuplicates ? resData.skippedDuplicates.length : 0;
      const errorCount = resData.errors ? resData.errors.length : 0;

      if (importedCount > 0) {
        toast.success(`Successfully imported ${importedCount} Reel${importedCount > 1 ? 's' : ''}! AI screening started.`);
        setUrlInput('');
        if (onSuccess) {
          onSuccess(resData);
        }
      } else if (dupeCount > 0 && errorCount === 0) {
        toast('All entered Reels have already been imported.', { icon: 'ℹ️' });
      } else if (errorCount > 0) {
        toast.error(`Import failed for ${errorCount} Reel(s). Check details below.`);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to import Instagram Reel(s)');
    } finally {
      setIsImporting(false);
      setImportStep('');
    }
  };

  return (
    <div className={clsx('card border-indigo-200 bg-white', compact ? 'p-4 sm:p-5' : 'p-6')}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-amber-500 text-white flex items-center justify-center shadow-xs shrink-0">
            <Instagram className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">
              Import from Instagram Reel URL
            </h3>
            <p className="text-xs text-slate-500">
              Powered by Apify Actor (<code className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">apify/instagram-reel-scraper</code>)
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleImport} className="space-y-4">
        {/* URL Input Area */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Instagram Reel URL(s)
          </label>
          <div className="relative">
            <textarea
              rows={compact ? 3 : 4}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isImporting}
              placeholder="Paste one or multiple Instagram Reel URLs (one per line):&#10;https://www.instagram.com/reel/C8XYZ123/&#10;https://www.instagram.com/reel/C8ABC789/"
              className="input-field text-xs sm:text-sm font-mono placeholder:font-sans py-2.5"
            />
          </div>

          {/* Real-time URL validation counter */}
          {rawUrls.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
              <span className="text-emerald-700 flex items-center gap-1 font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{validUrls.length} valid Reel URL{validUrls.length !== 1 ? 's' : ''} detected</span>
              </span>
              {invalidUrls.length > 0 && (
                <span className="text-rose-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{invalidUrls.length} invalid format</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Ownership & Compliance Agreement */}
        <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
              disabled={isImporting}
              className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-amber-900 leading-relaxed">
              <strong>Ownership / Permission Confirmation:</strong> I certify that I own these Instagram Reels or have explicit rights to repurpose and publish them to YouTube Shorts. Videos will be analyzed and screened automatically.
            </span>
          </label>
        </div>

        {/* Loading Progress State */}
        {isImporting && (
          <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>{importStep || 'Processing Instagram Reel(s)...'}</span>
            </div>
            <p className="text-[11px] text-indigo-700">
              Apify runs headless scrapers to retrieve the source MP4. This usually completes in 10-25 seconds.
            </p>
          </div>
        )}

        {/* Action Button */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-400">
            {validUrls.length > 0 ? `${validUrls.length} reel(s) ready` : 'No URLs queued'}
          </span>
          <button
            type="submit"
            disabled={isImporting || validUrls.length === 0 || !rightsConfirmed}
            className="btn-primary py-2 px-5 text-xs font-semibold shadow-xs"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <Instagram className="w-3.5 h-3.5" />
                <span>
                  Import {validUrls.length > 0 ? `${validUrls.length} Reel${validUrls.length > 1 ? 's' : ''}` : 'Reel'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Results Report Card */}
      {results && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          {/* Successfully imported */}
          {results.imported && results.imported.length > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
              <div className="font-semibold flex items-center gap-1.5 mb-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Successfully Imported ({results.imported.length}):</span>
              </div>
              <ul className="space-y-1 pl-5 list-disc text-emerald-700">
                {results.imported.map((item) => (
                  <li key={item.id}>
                    <strong>Reel {item.shortcode}</strong> — saved to storage ({(item.fileSize / 1024 / 1024).toFixed(1)} MB). AI analysis in progress.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Duplicates skipped */}
          {results.skippedDuplicates && results.skippedDuplicates.length > 0 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
              <div className="font-semibold flex items-center gap-1.5 mb-1">
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Duplicate Prevention Triggered ({results.skippedDuplicates.length}):</span>
              </div>
              <ul className="space-y-1 pl-5 list-disc text-slate-600">
                {results.skippedDuplicates.map((item, idx) => (
                  <li key={idx}>
                    <span className="font-medium">{item.url}</span>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Errors */}
          {results.errors && results.errors.length > 0 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <div className="font-semibold flex items-center gap-1.5 mb-1">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Import Errors ({results.errors.length}):</span>
              </div>
              <ul className="space-y-1 pl-5 list-disc text-rose-700">
                {results.errors.map((item, idx) => (
                  <li key={idx}>
                    <span className="font-medium">{item.url}</span>: {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
