import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileVideo, X, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

export default function UploadZone({ onUpload, isUploading, uploadProgress }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const onDrop = useCallback((acceptedFiles) => {
    setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.webm', '.avi', '.mkv'],
    },
    maxSize: 500 * 1024 * 1024, // 500MB
    disabled: isUploading,
  });

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setSelectedFiles([]);
  };

  const handleStartUpload = () => {
    if (!rightsConfirmed) return;
    if (selectedFiles.length === 0) return;
    onUpload(selectedFiles);
  };

  const formatSize = (bytes) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drag & Drop Area */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center',
          isDragActive
            ? 'border-brand-500 bg-brand-50/50 scale-[0.99]'
            : 'border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50/50',
          isUploading && 'pointer-events-none opacity-60'
        )}
      >
        <input {...getInputProps()} />
        <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-4 shadow-xs">
          <Upload className="w-7 h-7" />
        </div>
        <h3 className="text-base font-semibold text-slate-800">
          {isDragActive ? 'Drop your Instagram Reels here' : 'Drag & drop Instagram Reels here, or browse'}
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Supports MP4, MOV, WebM, MKV up to 500MB each. Upload multiple files at once.
        </p>
      </div>

      {/* File Rejections Warning */}
      {fileRejections.length > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
          <div>
            <p className="font-semibold">Some files could not be accepted:</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              {fileRejections.map(({ file, errors }) => (
                <li key={file.name}>
                  {file.name}: {errors.map((e) => e.message).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
            <span className="text-sm font-semibold text-slate-800">
              Selected Videos ({selectedFiles.length})
            </span>
            {!isUploading && (
              <button
                onClick={clearAll}
                className="text-xs text-slate-500 hover:text-rose-600 font-medium"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {selectedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <FileVideo className="w-4 h-4 text-brand-600 shrink-0" />
                  <span className="font-medium text-slate-800 truncate">{file.name}</span>
                  <span className="text-slate-400 shrink-0">({formatSize(file.size)})</span>
                </div>
                {!isUploading && (
                  <button
                    onClick={() => removeFile(idx)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Legal / Policy Compliance Confirmation */}
          <div className="mt-4 p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                disabled={isUploading}
                className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-amber-900 leading-relaxed">
                <strong>Legal & Ownership Confirmation:</strong> I certify that I own these videos or have explicit legal rights and permissions to reuse and publish them. Videos with detected copyright infringements or uncredited reused content will be rejected automatically.
              </span>
            </label>
          </div>

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>Uploading videos...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-brand-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload Action Button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleStartUpload}
              disabled={isUploading || !rightsConfirmed || selectedFiles.length === 0}
              className="btn-primary w-full sm:w-auto"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isUploading ? `Uploading (${uploadProgress}%)...` : `Upload & Analyze ${selectedFiles.length} Video${selectedFiles.length > 1 ? 's' : ''}`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
