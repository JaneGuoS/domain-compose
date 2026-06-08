import { Domain, ImpactResult, Workflow } from '../types';
import './DomainGrid.css';

interface Props {
  domains: Domain[];
  impact: ImpactResult | null;
  selectedWorkflow: string | null;
  workflows: Workflow[];
}

const HEALTH_LABEL = { good: '✅ Rich model', partial: '🟡 Partial', anemic: '🔴 Anemic' };

export default function DomainGrid({ domains, impact, selectedWorkflow, workflows }: Props) {
  // Domains touched by selected workflow
  const wfDomains = selectedWorkflow
    ? workflows.find(w => w.id === selectedWorkflow)?.domains ?? []
    : [];

  return (
    <div className="domain-grid">
      {domains.map(d => {
        const impactLevel = impact?.domainScores[d.id]?.level ?? 'none';
        const inWorkflow = wfDomains.includes(d.id);
        const cls = [
          'domain-card',
          impact ? `impact-${impactLevel}` : '',
          inWorkflow ? 'in-workflow' : ''
        ].filter(Boolean).join(' ');

        return (
          <div key={d.id} className={cls}>
            <div className="dc-header">
              <span className="dc-icon">{d.icon}</span>
              <span className="dc-name">{d.name}</span>
              {impact && impactLevel !== 'none' && (
                <span className={`dc-badge ${impactLevel}`}>
                  {impactLevel === 'direct' ? '🔴 IMPACTED' : '🟡 AFFECTED'}
                </span>
              )}
            </div>
            <div className="dc-health">{HEALTH_LABEL[d.health]}</div>
            <ul className="dc-ops">
              {d.operations.slice(0, 4).map(op => (
                <li key={op} className={
                  impact?.domainScores[d.id]?.matchedOps?.includes(op) ? 'op-hit' : ''
                }>{op}</li>
              ))}
              {d.operations.length > 4 && <li className="op-more">+{d.operations.length - 4} more</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
