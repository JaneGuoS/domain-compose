import { useState, useEffect, useRef } from 'react';
import './AnalyzePanel.css';

interface Props {
  onClose: () => void;
  onDone: (service: string) => void;
}

type JobStatus = 'idle' | 'running' | 'done' | 'error';
type Mode = 'url' | 'local';

export default function AnalyzePanel({ onClose, onDone }: Props) {
  const [mode, setMode]       = useState<Mode>('url');
  const [url, setUrl]         = useState('');
  const [dir, setDir]         = useState('');
  const [out, setOut]         = useState('');
  const [jobId, setJobId]     = useState<string | null>(null);
  const [status, setStatus]   = useState<JobStatus>('idle');
  const [logs, setLogs]       = useState<string[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [service, setService] = useState('');
  const logRef                = useRef<HTMLDivElement>(null);
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll log tail
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Poll job status while running
  useEffect(() => {
    if (!jobId || status !== 'running') return;
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        setLogs(data.logs || []);
        if (data.status === 'done') {
          setStatus('done');
          setService(data.service);
          clearInterval(pollRef.current!);
        } else if (data.status === 'error') {
          setStatus('error');
          setError(data.error || 'Analysis failed');
          clearInterval(pollRef.current!);
        }
      } catch {
        setStatus('error');
        setError('Lost connection to server');
        clearInterval(pollRef.current!);
      }
    }, 800);
    return () => clearInterval(pollRef.current!);
  }, [jobId, status]);

  const canSubmit = mode === 'url' ? !!url.trim() : !!dir.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('running');
    setLogs([]);
    setError(null);
    try {
      const isUrl = mode === 'url';
      const res = await fetch(isUrl ? '/api/discover' : '/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl
          ? { url: url.trim(), out: out.trim() || undefined }
          : { dir: dir.trim(), out: out.trim() || undefined }
        ),
      });
      const data = await res.json();
      if (!res.ok) { setStatus('error'); setError(data.error); return; }
      setJobId(data.jobId);
      setService(data.service);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
    }
  };

  const switchMode = (m: Mode) => {
    if (status === 'running') return;
    setMode(m);
    setError(null);
  };

  const loadResult = () => { onDone(service); onClose(); };

  return (
    <div className="ap-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ap-panel">
        {/* Header */}
        <div className="ap-header">
          <span className="ap-title">🔍 Analyze a Service</span>
          <button className="ap-close" onClick={onClose}>✕</button>
        </div>

        {/* Mode toggle */}
        <div className="ap-mode-toggle">
          <button
            type="button"
            className={`ap-mode-btn${mode === 'url' ? ' ap-mode-btn--active' : ''}`}
            onClick={() => switchMode('url')}
            disabled={status === 'running'}
          >
            🔗 GitHub URL
          </button>
          <button
            type="button"
            className={`ap-mode-btn${mode === 'local' ? ' ap-mode-btn--active' : ''}`}
            onClick={() => switchMode('local')}
            disabled={status === 'running'}
          >
            📁 Local path
          </button>
        </div>

        {/* Form */}
        <form className="ap-form" onSubmit={submit}>
          {mode === 'url' ? (
            <label className="ap-label">
              GitHub repository URL
              <input
                className="ap-input"
                placeholder="https://github.com/seismic/channel-service"
                value={url}
                onChange={e => setUrl(e.target.value)}
                disabled={status === 'running'}
                autoFocus
              />
            </label>
          ) : (
            <label className="ap-label">
              Repo / directory path
              <input
                className="ap-input"
                placeholder="/path/to/service-repo"
                value={dir}
                onChange={e => setDir(e.target.value)}
                disabled={status === 'running'}
                autoFocus
              />
            </label>
          )}
          <label className="ap-label">
            Service name <span className="ap-optional">(optional — defaults to repo name)</span>
            <input
              className="ap-input"
              placeholder="e.g. content-manager-service"
              value={out}
              onChange={e => setOut(e.target.value)}
              disabled={status === 'running'}
            />
          </label>
          <button
            className="ap-submit"
            type="submit"
            disabled={!canSubmit || status === 'running'}
          >
            {status === 'running' ? (
              <><span className="ap-spinner" /> Analyzing…</>
            ) : 'Run Analysis'}
          </button>
        </form>

        {/* Log output */}
        {(logs.length > 0 || status !== 'idle') && (
          <div className="ap-log-wrap">
            <div className="ap-log-title">
              {status === 'running' && <span className="ap-pulse" />}
              {status === 'running' ? 'Running…' : status === 'done' ? '✅ Done' : '❌ Failed'}
            </div>
            <div className="ap-log" ref={logRef}>
              {logs.map((line, i) => (
                <div key={i} className="ap-log-line">{line}</div>
              ))}
              {status === 'running' && <div className="ap-log-cursor">▌</div>}
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="ap-error">⚠ {error}</div>
        )}

        {/* Done CTA */}
        {status === 'done' && (
          <div className="ap-done">
            <span>Service <code>{service}</code> is ready.</span>
            <button className="ap-load-btn" onClick={loadResult}>Load into Studio →</button>
          </div>
        )}
      </div>
    </div>
  );
}
