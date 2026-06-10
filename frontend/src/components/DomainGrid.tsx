import { Domain, ImpactResult, Workflow } from '../types';
import './DomainGrid.css';

interface Props {
  domains: Domain[];
  impact: ImpactResult | null;
  selectedWorkflow: string | null;
  workflows: Workflow[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (domain: Domain) => void;
  onAdd: () => void;
}

const HEALTH_LABEL = { good: '✅ Rich model', partial: '🟡 Partial', anemic: '🔴 Anemic' };

export default function DomainGrid({ domains, impact, selectedWorkflow, workflows, selected, onSelect, onEdit, onAdd }: Props) {
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
          inWorkflow ? 'in-workflow' : '',
          selected === d.id ? 'selected' : '',
        ].filter(Boolean).join(' ');

        return (
          <div key={d.id} className={cls} onClick={() => onSelect(d.id === selected ? null : d.id)}>
            <div className="dc-header">
              <span className="dc-icon">{d.icon}</span>
              <span className="dc-name">{d.name}</span>
              {impact && impactLevel !== 'none' && (
                <span className={`dc-badge ${impactLevel}`}>
                  {impactLevel === 'direct' ? '🔴 IMPACTED' : '🟡 AFFECTED'}
                </span>
              )}
              <button className="dc-edit-btn" title="Edit domain" onClick={e => { e.stopPropagation(); onEdit(d); }}>✏️</button>
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

      {/* Add domain card */}
      <div className="domain-card domain-card-add" onClick={onAdd} title="Add a new domain">
        <span className="dc-add-icon">+</span>
        <span className="dc-add-label">Add Domain</span>
      </div>
    </div>
  );
}
