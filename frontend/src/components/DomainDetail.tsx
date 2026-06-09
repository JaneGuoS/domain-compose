import { useState } from 'react';
import { Domain, ImpactResult } from '../types';
import './DomainDetail.css';

interface Props {
  domain: Domain;
  impact: ImpactResult | null;
  onClose: () => void;
}

export default function DomainDetail({ domain, impact, onClose }: Props) {
  const [tab, setTab] = useState<'current' | 'ddd'>('current');
  const score = impact?.domainScores[domain.id];
  const t = domain.dddTarget;

  return (
    <div className="detail-panel">
      <div className="dp-header">
        <span className="dp-icon">{domain.icon}</span>
        <span className="dp-title">{domain.name}</span>
        <button className="dp-close" onClick={onClose}>✕</button>
      </div>

      <div className="dp-tabs">
        <button className={`dp-tab${tab === 'current' ? ' active' : ''}`} onClick={() => setTab('current')}>
          Current State
        </button>
        <button className={`dp-tab refactor${tab === 'ddd' ? ' active' : ''}`} onClick={() => setTab('ddd')}>
          🔧 DDD Target
        </button>
      </div>

      {tab === 'current' ? (
        <div className="dp-body">
          <div className="dp-label">Operations</div>
          <div className="ops-grid">
            {domain.operations.map(op => (
              <span key={op} className={`op-chip${score?.matchedOps?.includes(op) ? ' hit' : ''}`}>{op}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="dp-body">
          {!t?.aggregate ? (
            <div className="dp-empty">No DDD target defined for this domain.</div>
          ) : (
            <div className="ddd-target-detail">
              <div className="ddt-card-hdr">
                <span>{t.aggregate}</span>
                <span className="ddt-identity">id: {t.identity}</span>
              </div>
              <div className="ddt-body">
                {t.lifecycle && t.lifecycle.length > 0 && (
                  <div className="ddt-section">
                    <div className="ddt-label">Lifecycle</div>
                    <div className="ddt-lifecycle">
                      {t.lifecycle.map((s, i) => [
                        <span key={s} className="ls">{s}</span>,
                        i < t.lifecycle.length - 1 && <span key={`${s}-arr`} className="ls-arr">→</span>
                      ])}
                    </div>
                  </div>
                )}
                {t.valueObjects && t.valueObjects.length > 0 && (
                  <div className="ddt-section">
                    <div className="ddt-label">Value Objects</div>
                    <div className="ddt-pills">
                      {t.valueObjects.map(v => <span key={v} className="vo-pill">{v}</span>)}
                    </div>
                  </div>
                )}
                {t.childEntities && t.childEntities.length > 0 && (
                  <div className="ddt-section">
                    <div className="ddt-label">Child Entities</div>
                    <div className="ddt-pills">
                      {t.childEntities.map(v => <span key={v} className="ce-pill">{v}</span>)}
                    </div>
                  </div>
                )}
                {t.invariants && t.invariants.length > 0 && (
                  <div className="ddt-section">
                    <div className="ddt-label">Invariants</div>
                    <ul className="inv-list">
                      {t.invariants.map((inv, i) => <li key={i}>{inv}</li>)}
                    </ul>
                  </div>
                )}
                {t.commands && t.commands.length > 0 && (
                  <div className="ddt-section">
                    <div className="ddt-label">Commands → Events</div>
                    <table className="cmd-table">
                      <tbody>
                        {t.commands.map((c, i) => (
                          <tr key={i}>
                            <td className="cmd-cmd">{c.cmd}</td>
                            <td className="cmd-arr">→</td>
                            <td className="cmd-evt">{c.event}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
