import { useState, useEffect, useRef } from 'react';
import './AnalyzePanel.css';

interface Props {
  onClose: () => void;
  onDone: (service: string) => void;
}

type JobStatus = 'idle' | 'running' | 'done' | 'error';

export default function AnalyzePanel({ onClose, onDone }: Props) {
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dir.trim()) return;
    setStatus('running');
    setLogs([]);
    setError(null);
    try {
      const res  = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: dir.trim(), out: out.trim() || undefined }),
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

  const loadResult = () => { onDone(service); onClose(); };

  return (
    <div className="ap-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ap-panel">
        {/* Header */}
        <div className="ap-header">
          <span className="ap-title">🔍 Analyze a Service</span>
          <button className="ap-close" onClick={onClose}>✕</button>
        </div>

        {/* Form */}
        <form className="ap-form" onSubmit={submit}>
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
          <label className="ap-label">
            Service name <span className="ap-optional">(optional — defaults to folder name)</span>
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
            disabled={!dir.trim() || status === 'running'}
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
