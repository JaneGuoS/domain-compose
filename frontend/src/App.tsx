import { useState, useEffect, useCallback } from 'react';
import { ServiceData, ImpactResult, Domain } from './types';
import DomainGrid from './components/DomainGrid';
import WorkflowPanel from './components/WorkflowPanel';
import ImpactBar from './components/ImpactBar';
import IntegrationPanel from './components/IntegrationPanel';
import AnalyzePanel from './components/AnalyzePanel';
import DomainEditModal from './components/DomainEditModal';
import './App.css';

export default function App() {
  const [services, setServices]           = useState<string[]>([]);
  const [activeService, setActiveService] = useState<string>('');
  const [data, setData]                   = useState<ServiceData | null>(null);
  const [impact, setImpact]               = useState<ImpactResult | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [showAnalyze, setShowAnalyze]     = useState(false);

  // Edit modal state
  const [editDomain, setEditDomain]       = useState<Domain | null>(null);
  const [isNewDomain, setIsNewDomain]     = useState(false);

  // Fetch service list
  const refreshServices = useCallback(async () => {
    const res  = await fetch('/api/services');
    const list = await res.json() as string[];
    setServices(list);
    return list;
  }, []);

  // Load a specific service's domain data
  const loadService = useCallback(async (name: string) => {
    setLoading(true);
    setImpact(null);
    setSelectedWorkflow(null);
    const res = await fetch(`/api/analyze/${name}`);
    const d   = await res.json();
    setData(d);
    setActiveService(name);
    setLoading(false);
  }, []);

  // Bootstrap: list services → load first one
  useEffect(() => {
    refreshServices().then(list => {
      if (list.length > 0) loadService(list[0]);
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, [refreshServices, loadService]);

  const handleImpact = async (req: string) => {
    if (!req.trim() || !activeService) { setImpact(null); return; }
    const res = await fetch('/api/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: activeService, requirement: req }),
    });
    setImpact(await res.json());
  };

  // Called when AnalyzePanel finishes a job
  const handleAnalyzeDone = async (service: string) => {
    const list = await refreshServices();
    const target = list.includes(service) ? service : list[0];
    if (target) loadService(target);
  };

  // ── Domain edit handlers ──────────────────────────────────────────────────

  const handleSaveDomain = async (patch: Partial<Domain> & { id: string }) => {
    if (!activeService) return;
    const url = isNewDomain
      ? `/api/services/${activeService}/domains`
      : `/api/services/${activeService}/domains/${patch.id}`;
    const method = isNewDomain ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setData(updated);
    }
    setEditDomain(null);
  };

  const handleDeleteDomain = async (domainId: string) => {
    if (!activeService) return;
    const res = await fetch(`/api/services/${activeService}/domains/${domainId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const updated = await res.json();
      setData(updated);
    }
    setEditDomain(null);
  };

  const counts = impact && data ? {
    direct:   data.domains.filter(d => impact.domainScores[d.id]?.level === 'direct').length,
    indirect: data.domains.filter(d => impact.domainScores[d.id]?.level === 'indirect').length,
    none:     data.domains.filter(d => (impact.domainScores[d.id]?.level ?? 'none') === 'none').length,
  } : null;

  if (loading && !data) return (
    <div className="loading">
      <div className="spinner" />
      <p>Loading service…</p>
    </div>
  );

  if (!data && !loading) return (
    <div className="loading">
      <p style={{ marginBottom: 16 }}>No services found.</p>
      <button className="analyze-btn-empty" onClick={() => setShowAnalyze(true)}>
        + Analyze a service repo
      </button>
    </div>
  );

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo-s">S</span>
          <span className="logo-text">DomainCompose Studio</span>

          {/* Service switcher */}
          {services.length > 0 && (
            <div className="service-switcher">
              <select
                className="service-select"
                value={activeService}
                onChange={e => loadService(e.target.value)}
              >
                {services.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="header-right">
          {data && <span className="header-meta">Analysed {data.analyzedAt}</span>}
          <button className="analyze-btn" onClick={() => setShowAnalyze(true)}>
            + Analyze repo
          </button>
        </div>
      </header>

      {/* Impact bar */}
      <ImpactBar onSearch={handleImpact} counts={counts} requirement={impact?.requirement} />

      {/* Main */}
      {data && (
        <main className="main">
          <section>
            <h2 className="section-title">Domain Map</h2>
            <DomainGrid
              domains={data.domains}
              impact={impact}
              selectedWorkflow={selectedWorkflow}
              workflows={data.workflows}
              onEditDomain={d => { setEditDomain(d); setIsNewDomain(false); }}
              onAddDomain={() => { setEditDomain(null); setIsNewDomain(true); }}
            />
          </section>

          <section>
            <h2 className="section-title">Key Workflows</h2>
            <WorkflowPanel
              workflows={data.workflows}
              impact={impact}
              selected={selectedWorkflow}
              onSelect={setSelectedWorkflow}
            />
          </section>

          <section>
            <h2 className="section-title">External Integrations</h2>
            <IntegrationPanel integrations={data.integrations} />
          </section>
        </main>
      )}

      {/* Analyze panel */}
      {showAnalyze && (
        <AnalyzePanel
          onClose={() => setShowAnalyze(false)}
          onDone={handleAnalyzeDone}
        />
      )}

      {/* Domain edit / add modal */}
      {(editDomain || isNewDomain) && (
        <DomainEditModal
          domain={editDomain}
          isNew={isNewDomain}
          onSave={handleSaveDomain}
          onDelete={isNewDomain ? undefined : handleDeleteDomain}
          onClose={() => { setEditDomain(null); setIsNewDomain(false); }}
        />
      )}
    </div>
  );
}
