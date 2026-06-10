import { Domain, ImpactResult } from '../types';
import './Sidebar.css';

interface Props {
  domains: Domain[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  impact: ImpactResult | null;
}

const HEALTH_CLS = { good: 'health-good', partial: 'health-partial', anemic: 'health-anemic' };
const HEALTH_ICON = { good: '✅', partial: '🟡', anemic: '🔴' };

export default function Sidebar({ domains, selected, onSelect, impact }: Props) {
  return (
    <aside className="sidebar">
      <div className="sb-title">Domains</div>
      <div
        className={`sb-item ${!selected ? 'selected' : ''}`}
        onClick={() => onSelect(null)}
      >
        <span className="sb-icon">🗂</span>
        <span>All domains</span>
      </div>
      {domains.map(d => {
        const lvl = impact?.domainScores[d.id]?.level ?? 'none';
        const cls = [
          'sb-item',
          selected === d.id ? 'selected' : '',
          impact && lvl !== 'none' ? `impact-${lvl}` : '',
        ].filter(Boolean).join(' ');
        return (
          <div key={d.id} className={cls} onClick={() => onSelect(d.id === selected ? null : d.id)}>
            <span className="sb-icon">{d.icon}</span>
            <span className="sb-name">{d.name}</span>
            <span className={`sb-health ${HEALTH_CLS[d.health]}`}>{HEALTH_ICON[d.health]}</span>
          </div>
        );
      })}
    </aside>
  );
}
