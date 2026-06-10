import { useState, useEffect } from 'react';
import { ServiceData, ImpactResult, Domain } from './types';
import DomainGrid from './components/DomainGrid';
import WorkflowPanel from './components/WorkflowPanel';
import ImpactBar from './components/ImpactBar';
import IntegrationPanel from './components/IntegrationPanel';
import DomainEditModal from './components/DomainEditModal';
import Sidebar from './components/Sidebar';
import DddTargetGrid from './components/DddTargetGrid';
import DomainDetail from './components/DomainDetail';
import './App.css';

export default function App() {
  const [services, setServices]           = useState<string[]>([]);
  const [service, setService]             = useState<string>('');
  const [data, setData]                   = useState<ServiceData | null>(null);
  const [impact, setImpact]               = useState<ImpactResult | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain]     = useState<string | null>(null);
  const [view, setView]                   = useState<'current' | 'refactor'>('current');
  const [loading, setLoading]             = useState(true);
  const [modalDomain, setModalDomain]     = useState<Domain | null | undefined>(undefined);

  // Load services list once on mount
  useEffect(() => {
    fetch('/api/services')
      .then(r => r.json())
      .then((list: string[]) => {
        setServices(list);
        if (list.length > 0) setService(list[0]);
      })
      .catch(() => setLoading(false));
  }, []);

  // Load service data whenever selected service changes
  useEffect(() => {
    if (!service) return;
    setLoading(true);
    setData(null);
    setImpact(null);
    setSelectedDomain(null);
    setSelectedWorkflow(null);
    fetch(`/api/analyze/${service}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [service]);

  const handleImpact = async (req: string) => {
    if (!req.trim()) { setImpact(null); return; }
    const res = await fetch('/api/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, requirement: req }),
    });
    setImpact(await res.json());
  };

  const handleDomainSave = async (updated: Domain) => {
    if (!data) return;
    const isNew = !data.domains.find(d => d.id === updated.id);
    const url = isNew
      ? `/api/services/${service}/domains`
      : `/api/services/${service}/domains/${updated.id}`;
    await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setData(prev => {
      if (!prev) return prev;
      const domains = isNew
        ? [...prev.domains, updated]
        : prev.domains.map(d => d.id === updated.id ? updated : d);
      return { ...prev, domains };
    });
    setImpact(null);
    setModalDomain(undefined);
  };

  const handleDomainDelete = async (id: string) => {
    if (!data) return;
    await fetch(`/api/services/${service}/domains/${id}`, { method: 'DELETE' });
    setData(prev => prev ? { ...prev, domains: prev.domains.filter(d => d.id !== id) } : prev);
    setImpact(null);
    setModalDomain(undefined);
  };

  if (loading) return (
    <div className="loading">
      <div className="spinner" />
      <p>Loading{service ? ` ${service}` : ''}…</p>
    </div>
  );

  if (!data) return <div className="loading"><p>Failed to load service data.</p></div>;

  const counts = impact ? {
    direct:   data.domains.filter(d => impact.domainScores[d.id]?.level === 'direct').length,
    indirect: data.domains.filter(d => impact.domainScores[d.id]?.level === 'indirect').length,
    none:     data.domains.filter(d => (impact.domainScores[d.id]?.level ?? 'none') === 'none').length,
  } : null;

  const visibleDomains = selectedDomain
    ? data.domains.filter(d => d.id === selectedDomain)
    : data.domains;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo-s">S</span>
          <span className="logo-text">DomainCompose Studio</span>
          <select
            className="service-select"
            value={service}
            onChange={e => setService(e.target.value)}
          >
            {services.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="view-toggle">
          <button className={`vt-btn${view === 'current' ? ' active' : ''}`} onClick={() => setView('current')}>📄 Domain Map</button>
          <button className={`vt-btn refactor${view === 'refactor' ? ' active' : ''}`} onClick={() => setView('refactor')}>🔧 Refactor Target</button>
        </div>
        <div className="header-meta">Analysed {data.analyzedAt}</div>
      </header>

      <ImpactBar onSearch={handleImpact} counts={counts} requirement={impact?.requirement} />

      <div className="layout">
        <Sidebar
          domains={data.domains}
          selected={selectedDomain}
          onSelect={id => { setSelectedDomain(id); setSelectedWorkflow(null); }}
          impact={impact}
        />

        <main className="main">
          {view === 'current' ? (<>
            {selectedDomain && (() => {
              const dom = data.domains.find(d => d.id === selectedDomain);
              return dom ? <DomainDetail domain={dom} impact={impact} onClose={() => setSelectedDomain(null)} /> : null;
            })()}
            <section>
              <h2 className="section-title">Domain Map</h2>
              <DomainGrid
                domains={visibleDomains}
                impact={impact}
                selectedWorkflow={selectedWorkflow}
                workflows={data.workflows}
                selected={selectedDomain}
                onSelect={setSelectedDomain}
                onEdit={d => setModalDomain(d)}
                onAdd={() => setModalDomain(null)}
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
            {!selectedDomain && (
              <section>
                <h2 className="section-title">External Integrations</h2>
                <IntegrationPanel integrations={data.integrations} />
              </section>
            )}
          </>) : (
            <section>
              <h2 className="section-title">
                {selectedDomain
                  ? `${data.domains.find(d => d.id === selectedDomain)?.name} — DDD Target`
                  : 'DDD Target Design — All Domains'}
              </h2>
              <DddTargetGrid
                domains={visibleDomains}
                selected={selectedDomain}
                onSelect={setSelectedDomain}
              />
            </section>
          )}
        </main>
      </div>

      {modalDomain !== undefined && (
        <DomainEditModal
          domain={modalDomain}
          onSave={handleDomainSave}
          onDelete={handleDomainDelete}
          onClose={() => setModalDomain(undefined)}
        />
      )}
    </div>
  );
}
