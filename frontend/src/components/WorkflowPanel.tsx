import { Workflow, ImpactResult } from '../types';
import './WorkflowPanel.css';

interface Props {
  workflows: Workflow[];
  impact: ImpactResult | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const STEP_COLORS: Record<string, string> = {
  api: 'step-api', domain: 'step-domain', kafka: 'step-kafka',
  background: 'step-bg', external: 'step-ext', violation: 'step-violation'
};

export default function WorkflowPanel({ workflows, impact, selected, onSelect }: Props) {
  return (
    <div className="workflow-panel">
      {workflows.map(wf => {
        const level = impact?.workflowScores[wf.id] ?? 'none';
        const isOpen = selected === wf.id;
        const cls = ['wf-row', impact ? `wf-${level}` : '', isOpen ? 'wf-open' : ''].filter(Boolean).join(' ');

        return (
          <div key={wf.id} className={cls}>
            <button className="wf-header" onClick={() => onSelect(isOpen ? null : wf.id)}>
              <span className="wf-name">{wf.name}</span>
              {impact && level !== 'none' && (
                <span className={`wf-badge ${level}`}>
                  {level === 'direct' ? '🔴 IMPACTED' : '🟡 AFFECTED'}
                </span>
              )}
              <span className="wf-chevron">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="wf-steps">
                {wf.steps.map((step, i) => (
                  <div key={i} className="step-row">
                    {i > 0 && <div className="step-arrow">→</div>}
                    <div className={`step-chip ${STEP_COLORS[step.type] ?? ''}`}>
                      {step.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
