import { useState, useEffect } from 'react';
import { ServiceData, ImpactResult } from './types';
import DomainGrid from './components/DomainGrid';
import WorkflowPanel from './components/WorkflowPanel';
import ImpactBar from './components/ImpactBar';
import IntegrationPanel from './components/IntegrationPanel';
import './App.css';

export default function App() {
  const [data, setData] = useState<ServiceData | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analyze/content-manager-service')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleImpact = async (req: string) => {
    if (!req.trim()) { setImpact(null); return; }
    const res = await fetch('/api/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'content-manager-service', requirement: req })
    });
    setImpact(await res.json());
  };

  if (loading) return (
    <div className="loading">
      <div className="spinner" />
      <p>Analysing service…</p>
    </div>
  );

  if (!data) return <div className="loading"><p>Failed to load service data.</p></div>;

  const counts = impact ? {
    direct: data.domains.filter(d => impact.domainScores[d.id]?.level === 'direct').length,
    indirect: data.domains.filter(d => impact.domainScores[d.id]?.level === 'indirect').length,
    none: data.domains.filter(d => (impact.domainScores[d.id]?.level ?? 'none') === 'none').length,
  } : null;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo-s">S</span>
          <span className="logo-text">DomainCompose Studio</span>
          <span className="service-badge">{data.service}</span>
        </div>
        <div className="header-meta">Analysed {data.analyzedAt}</div>
      </header>

      {/* Impact bar */}
      <ImpactBar onSearch={handleImpact} counts={counts} requirement={impact?.requirement} />

      {/* Main grid */}
      <main className="main">
        <section>
          <h2 className="section-title">Domain Map</h2>
          <DomainGrid
            domains={data.domains}
            impact={impact}
            selectedWorkflow={selectedWorkflow}
            workflows={data.workflows}
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
    </div>
  );
}
