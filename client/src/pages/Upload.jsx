import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { uploadFiles } from '../api/client.js';
import toast from 'react-hot-toast';
import {
  Upload as UploadIcon,
  CheckCircle,
  ShieldAlert,
  ArrowRight,
  Info
} from 'lucide-react';
import UploadZone from '../components/UploadZone.jsx';

export default function UploadPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedVideos, setUploadedVideos] = useState([]);
  const navigate = useNavigate();

  const handleUpload = async (files) => {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const isMultiple = files.length > 1;
      const response = await uploadFiles(files, isMultiple, (progress) => {
        setUploadProgress(progress);
      });

      const items = response.videos || (response.video ? [response.video] : []);
      setUploadedVideos(items);
      toast.success(
        `Successfully uploaded ${items.length} video${items.length > 1 ? 's' : ''}! Analysis started in background.`
      );
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Upload Instagram Reels
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Submit Reels you own or have permission to reuse. Videos are analyzed by AI and strictly screened for copyright and policy compliance before publishing.
        </p>
      </div>

      {/* Automated Pipeline Notice */}
      <div className="card p-4 bg-gradient-to-r from-brand-50 to-indigo-50/50 border-brand-200">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </div>
          <div className="text-xs text-slate-700 leading-relaxed">
            <p className="font-semibold text-brand-900 mb-1">
              Automated 4-Step Processing Pipeline:
            </p>
            <ol className="list-decimal pl-4 space-y-1 text-slate-600">
              <li><strong>Secure Storage:</strong> Stored locally in encrypted, isolated storage.</li>
              <li><strong>AI Video & Audio Analysis:</strong> Gemini scans the video, detects topics, languages, and generates high-converting titles, descriptions, and hashtags.</li>
              <li><strong>Strict Policy & Copyright Screen:</strong> Scans for third-party music, logos, community guideline violations, and uncredited reused content. <em>Uncertain cases are rejected automatically.</em></li>
              <li><strong>Publishing Queue:</strong> Eligible videos are queued for FIFO distribution to your verified YouTube channel.</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Main Upload Dropzone */}
      <UploadZone
        onUpload={handleUpload}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
      />

      {/* Successfully Uploaded State */}
      {uploadedVideos.length > 0 && (
        <div className="card p-5 border-emerald-200 bg-emerald-50/30">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-2">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <span>{uploadedVideos.length} Video(s) Processing in Background</span>
          </div>
          <p className="text-xs text-slate-600 mb-4">
            AI analysis and risk screening take approximately 10-30 seconds per video. You can monitor progress on your dashboard.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="btn-primary py-2 px-4 text-xs font-semibold"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setUploadedVideos([])}
              className="btn-secondary py-2 px-4 text-xs"
            >
              Upload More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
