import { Domain } from '../types';
import './DddTargetGrid.css';

interface Props {
  domains: Domain[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const HEALTH_CLS  = { good: 'health-good', partial: 'health-partial', anemic: 'health-anemic' };
const HEALTH_LABEL = { good: '✅ Rich', partial: '🟡 Partial', anemic: '🔴 Anemic' };

export default function DddTargetGrid({ domains, selected, onSelect }: Props) {
  return (
    <div className="ddd-grid">
      {domains.map(d => {
        const t = d.dddTarget;
        const cls = ['ddd-card', selected === d.id ? 'selected' : ''].filter(Boolean).join(' ');
        return (
          <div key={d.id} className={cls} onClick={() => onSelect(d.id === selected ? null : d.id)}>
            <div className="ddd-card-hdr">
              <span className="ddd-icon">{d.icon}</span>
              <span className="ddd-name">{d.name}</span>
              <span className={`ddd-health ${HEALTH_CLS[d.health]}`}>{HEALTH_LABEL[d.health]}</span>
            </div>
            {t?.aggregate && (
              <div className="ddd-aggregate">{t.aggregate}</div>
            )}
            <div className="ddd-body">
              {t?.valueObjects && t.valueObjects.length > 0 && (
                <div className="ddd-pills">
                  {t.valueObjects.map(v => <span key={v} className="vo-pill">{v}</span>)}
                </div>
              )}
              {t?.invariants && t.invariants.slice(0, 2).map((inv, i) => (
                <div key={i} className="ddd-inv">{inv}</div>
              ))}
              {t?.commands && t.commands.length > 0 && (
                <div className="ddd-cmd-count">
                  {t.commands.length} command{t.commands.length !== 1 ? 's' : ''} → {t.commands.length} event{t.commands.length !== 1 ? 's' : ''}
                </div>
              )}
              {!t?.aggregate && <div className="ddd-empty">No DDD target defined</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
