import { useState } from 'react';
import { Domain, DddTarget } from '../types';
import './DomainEditModal.css';

interface Props {
  domain: Domain | null; // null = add mode
  onSave: (domain: Domain) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const HEALTH_OPTIONS: { value: Domain['health']; label: string }[] = [
  { value: 'good',    label: '✅ Rich model' },
  { value: 'partial', label: '🟡 Partial' },
  { value: 'anemic',  label: '🔴 Anemic' },
];

function listToText(arr: string[] | undefined): string {
  return (arr ?? []).join('\n');
}

function textToList(text: string): string[] {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function formatCommands(commands: DddTarget['commands'] | undefined): string {
  return (commands ?? []).map(c => `${c.cmd} → ${c.event}`).join('\n');
}

function parseCommands(text: string): DddTarget['commands'] {
  return text.split('\n').map(line => {
    const [cmd, event] = line.split('→').map(s => s.trim());
    return { cmd: cmd ?? '', event: event ?? '' };
  }).filter(c => c.cmd);
}

export default function DomainEditModal({ domain, onSave, onDelete, onClose }: Props) {
  const isNew = !domain;

  const [name, setName]             = useState(domain?.name ?? '');
  const [icon, setIcon]             = useState(domain?.icon ?? '🏠');
  const [health, setHealth]         = useState<Domain['health']>(domain?.health ?? 'partial');
  const [operations, setOperations] = useState(listToText(domain?.operations));
  const [keywords, setKeywords]     = useState(listToText(domain?.keywords));

  const [aggregate, setAggregate]         = useState(domain?.dddTarget?.aggregate ?? '');
  const [identity, setIdentity]           = useState(domain?.dddTarget?.identity ?? '');
  const [lifecycle, setLifecycle]         = useState(listToText(domain?.dddTarget?.lifecycle));
  const [valueObjects, setValueObjects]   = useState(listToText(domain?.dddTarget?.valueObjects));
  const [childEntities, setChildEntities] = useState(listToText(domain?.dddTarget?.childEntities));
  const [invariants, setInvariants]       = useState(listToText(domain?.dddTarget?.invariants));
  const [commands, setCommands]           = useState(formatCommands(domain?.dddTarget?.commands));

  const handleSave = () => {
    if (!name.trim()) return;
    const id = domain?.id ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    onSave({
      id,
      name: name.trim(),
      icon,
      health,
      operations: textToList(operations),
      keywords: textToList(keywords),
      dddTarget: {
        aggregate,
        identity,
        lifecycle:     textToList(lifecycle),
        valueObjects:  textToList(valueObjects),
        childEntities: textToList(childEntities),
        invariants:    textToList(invariants),
        commands:      parseCommands(commands),
      },
    });
  };

  const handleDelete = () => {
    if (domain && onDelete && confirm(`Delete domain "${domain.name}"? This cannot be undone.`)) {
      onDelete(domain.id);
    }
  };

  return (
    <div className="dem-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dem-modal">
        <div className="dem-header">
          <span className="dem-title">{isNew ? 'Add Domain' : 'Edit Domain'}</span>
          <button className="dem-close" onClick={onClose}>✕</button>
        </div>

        <div className="dem-body">
          {/* Basic info row */}
          <div className="dem-row">
            <div className="dem-field dem-field-sm">
              <label>Icon</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2} className="dem-icon-input" />
            </div>
            <div className="dem-field dem-field-grow">
              <label>Name <span className="dem-required">*</span></label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Content Item" />
            </div>
            <div className="dem-field">
              <label>Health</label>
              <select value={health} onChange={e => setHealth(e.target.value as Domain['health'])}>
                {HEALTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Operations + Keywords */}
          <div className="dem-grid-2">
            <div className="dem-field">
              <label>Operations <span className="dem-hint">one per line</span></label>
              <textarea rows={5} value={operations} onChange={e => setOperations(e.target.value)}
                placeholder={'Upload\nRename\nDelete'} />
            </div>
            <div className="dem-field">
              <label>Keywords <span className="dem-hint">one per line</span></label>
              <textarea rows={5} value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder={'file\nupload\ncontent'} />
            </div>
          </div>

          <div className="dem-section-title">DDD Target</div>

          {/* Aggregate + Identity */}
          <div className="dem-grid-2">
            <div className="dem-field">
              <label>Aggregate</label>
              <input value={aggregate} onChange={e => setAggregate(e.target.value)} placeholder="e.g. ContentItemEntity" />
            </div>
            <div className="dem-field">
              <label>Identity</label>
              <input value={identity} onChange={e => setIdentity(e.target.value)} placeholder="e.g. ContentObjectId + TeamSiteId" />
            </div>
          </div>

          {/* Lifecycle + Value Objects + Child Entities */}
          <div className="dem-grid-3">
            <div className="dem-field">
              <label>Lifecycle states <span className="dem-hint">one per line</span></label>
              <textarea rows={4} value={lifecycle} onChange={e => setLifecycle(e.target.value)}
                placeholder={'uploading\nactive\ndeleted'} />
            </div>
            <div className="dem-field">
              <label>Value Objects <span className="dem-hint">one per line</span></label>
              <textarea rows={4} value={valueObjects} onChange={e => setValueObjects(e.target.value)}
                placeholder={'ContentStatus\nTeamSiteId'} />
            </div>
            <div className="dem-field">
              <label>Child Entities <span className="dem-hint">one per line</span></label>
              <textarea rows={4} value={childEntities} onChange={e => setChildEntities(e.target.value)}
                placeholder={'FolderEntity'} />
            </div>
          </div>

          {/* Invariants */}
          <div className="dem-field">
            <label>Invariants <span className="dem-hint">one per line</span></label>
            <textarea rows={3} value={invariants} onChange={e => setInvariants(e.target.value)}
              placeholder={'Cannot delete while a workflow approval is pending'} />
          </div>

          {/* Commands */}
          <div className="dem-field">
            <label>Commands <span className="dem-hint">cmd → event, one per line</span></label>
            <textarea rows={4} value={commands} onChange={e => setCommands(e.target.value)}
              placeholder={'Upload(userId, request) → ContentUploaded\nDelete(userId) → ContentDeleted'} />
          </div>
        </div>

        <div className="dem-footer">
          {!isNew && onDelete && (
            <button className="dem-btn dem-btn-danger" onClick={handleDelete}>Delete domain</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="dem-btn dem-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="dem-btn dem-btn-primary" onClick={handleSave} disabled={!name.trim()}>
            {isNew ? 'Add Domain' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
