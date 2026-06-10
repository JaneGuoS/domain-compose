import { useState, useEffect } from 'react';
import { Domain, DddTarget, DomainCommand } from '../types';
import './DomainEditModal.css';

interface Props {
  /** Domain to edit. Pass null to create a new domain. */
  domain: Domain | null;
  isNew: boolean;
  onSave: (patch: Partial<Domain> & { id: string }) => void;
  onDelete?: (domainId: string) => void;
  onClose: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toLines(arr?: string[]): string {
  return (arr ?? []).join('\n');
}

function fromLines(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(Boolean);
}

interface FormState {
  id: string;
  name: string;
  icon: string;
  health: 'good' | 'partial' | 'anemic';
  operations: string;      // newline-separated
  aggregate: string;
  identity: string;
  valueObjects: string;    // newline-separated
  lifecycle: string;       // newline-separated
  childEntities: string;   // newline-separated
  invariants: string;      // newline-separated
  commands: DomainCommand[];
}

function domainToForm(d: Domain | null, isNew: boolean): FormState {
  if (!d || isNew) {
    return {
      id: '', name: '', icon: '📦', health: 'partial',
      operations: '', aggregate: '', identity: '',
      valueObjects: '', lifecycle: '', childEntities: '',
      invariants: '', commands: [],
    };
  }
  const t = d.dddTarget ?? {};
  return {
    id: d.id,
    name: d.name,
    icon: d.icon,
    health: d.health,
    operations: toLines(d.operations),
    aggregate: t.aggregate ?? '',
    identity: t.identity ?? '',
    valueObjects: toLines(t.valueObjects),
    lifecycle: toLines(t.lifecycle),
    childEntities: toLines(t.childEntities),
    invariants: toLines(t.invariants),
    commands: t.commands ? [...t.commands] : [],
  };
}

function formToDomain(f: FormState): Partial<Domain> & { id: string } {
  const dddTarget: DddTarget = {
    aggregate: f.aggregate.trim() || undefined,
    identity: f.identity.trim() || undefined,
    lifecycle: fromLines(f.lifecycle),
    valueObjects: fromLines(f.valueObjects),
    childEntities: fromLines(f.childEntities),
    invariants: fromLines(f.invariants),
    commands: f.commands.filter(c => c.cmd.trim()),
  };

  return {
    id: f.id.trim(),
    name: f.name.trim(),
    icon: f.icon.trim() || '📦',
    health: f.health,
    operations: fromLines(f.operations),
    dddTarget,
  };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DomainEditModal({ domain, isNew, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<FormState>(() => domainToForm(domain, isNew));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'ddd'>('basic');

  // Reset form when domain changes
  useEffect(() => {
    setForm(domainToForm(domain, isNew));
    setConfirmDelete(false);
    setActiveTab('basic');
  }, [domain, isNew]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (isNew && !form.id.trim()) return;
    onSave(formToDomain(form));
  };

  // Commands helpers
  const addCommand = () =>
    setForm(prev => ({ ...prev, commands: [...prev.commands, { cmd: '', event: '' }] }));

  const updateCommand = (i: number, field: keyof DomainCommand, value: string) =>
    setForm(prev => {
      const cmds = [...prev.commands];
      cmds[i] = { ...cmds[i], [field]: value };
      return { ...prev, commands: cmds };
    });

  const removeCommand = (i: number) =>
    setForm(prev => ({ ...prev, commands: prev.commands.filter((_, idx) => idx !== i) }));

  return (
    <div className="dem-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dem-panel">
        {/* Header */}
        <div className="dem-header">
          <span className="dem-title">{isNew ? '➕ Add Domain' : '✏️ Edit Domain'}</span>
          <button className="dem-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="dem-tabs">
          <button
            type="button"
            className={`dem-tab${activeTab === 'basic' ? ' dem-tab--active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            Basic Info
          </button>
          <button
            type="button"
            className={`dem-tab${activeTab === 'ddd' ? ' dem-tab--active' : ''}`}
            onClick={() => setActiveTab('ddd')}
          >
            DDD Target
          </button>
        </div>

        <form className="dem-form" onSubmit={handleSubmit}>
          {/* ── Basic tab ── */}
          {activeTab === 'basic' && (
            <div className="dem-section">
              {isNew && (
                <label className="dem-field">
                  <span className="dem-label">Domain ID <span className="dem-required">*</span></span>
                  <input
                    className="dem-input"
                    value={form.id}
                    onChange={e => set('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder="e.g. billing, file-version"
                    required
                  />
                  <span className="dem-hint">Lowercase, hyphens only. Cannot be changed later.</span>
                </label>
              )}

              <div className="dem-row">
                <label className="dem-field dem-field--icon">
                  <span className="dem-label">Icon</span>
                  <input
                    className="dem-input"
                    value={form.icon}
                    onChange={e => set('icon', e.target.value)}
                    placeholder="📦"
                    maxLength={4}
                  />
                </label>
                <label className="dem-field dem-field--grow">
                  <span className="dem-label">Name <span className="dem-required">*</span></span>
                  <input
                    className="dem-input"
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Domain name"
                    required
                  />
                </label>
              </div>

              <label className="dem-field">
                <span className="dem-label">Health</span>
                <select
                  className="dem-select"
                  value={form.health}
                  onChange={e => set('health', e.target.value as FormState['health'])}
                >
                  <option value="good">✅ Rich model</option>
                  <option value="partial">🟡 Partial</option>
                  <option value="anemic">🔴 Anemic</option>
                </select>
              </label>

              <label className="dem-field">
                <span className="dem-label">Operations <span className="dem-hint-inline">(one per line)</span></span>
                <textarea
                  className="dem-textarea"
                  rows={6}
                  value={form.operations}
                  onChange={e => set('operations', e.target.value)}
                  placeholder={"CreateFile\nUpdateFile\nDeleteFile"}
                />
              </label>
            </div>
          )}

          {/* ── DDD Target tab ── */}
          {activeTab === 'ddd' && (
            <div className="dem-section">
              <div className="dem-row">
                <label className="dem-field dem-field--grow">
                  <span className="dem-label">Aggregate Root</span>
                  <input
                    className="dem-input"
                    value={form.aggregate}
                    onChange={e => set('aggregate', e.target.value)}
                    placeholder="e.g. FileEntity"
                  />
                </label>
                <label className="dem-field dem-field--grow">
                  <span className="dem-label">Identity</span>
                  <input
                    className="dem-input"
                    value={form.identity}
                    onChange={e => set('identity', e.target.value)}
                    placeholder="e.g. Id (GUID)"
                  />
                </label>
              </div>

              <div className="dem-row">
                <label className="dem-field dem-field--grow">
                  <span className="dem-label">Value Objects <span className="dem-hint-inline">(one per line)</span></span>
                  <textarea
                    className="dem-textarea"
                    rows={4}
                    value={form.valueObjects}
                    onChange={e => set('valueObjects', e.target.value)}
                    placeholder={"FileStatus\nCheckoutState"}
                  />
                </label>
                <label className="dem-field dem-field--grow">
                  <span className="dem-label">Child Entities <span className="dem-hint-inline">(one per line)</span></span>
                  <textarea
                    className="dem-textarea"
                    rows={4}
                    value={form.childEntities}
                    onChange={e => set('childEntities', e.target.value)}
                    placeholder={"FileVersionEntity"}
                  />
                </label>
              </div>

              <label className="dem-field">
                <span className="dem-label">Lifecycle States <span className="dem-hint-inline">(one per line)</span></span>
                <textarea
                  className="dem-textarea"
                  rows={3}
                  value={form.lifecycle}
                  onChange={e => set('lifecycle', e.target.value)}
                  placeholder={"draft\nprocessing\nready\nexpired"}
                />
              </label>

              <label className="dem-field">
                <span className="dem-label">Invariants <span className="dem-hint-inline">(one per line)</span></span>
                <textarea
                  className="dem-textarea"
                  rows={4}
                  value={form.invariants}
                  onChange={e => set('invariants', e.target.value)}
                  placeholder={"A file cannot be deleted while checked out"}
                />
              </label>

              {/* Commands */}
              <div className="dem-field">
                <span className="dem-label">Commands</span>
                {form.commands.map((cmd, i) => (
                  <div key={i} className="dem-cmd-row">
                    <input
                      className="dem-input dem-input--cmd"
                      value={cmd.cmd}
                      onChange={e => updateCommand(i, 'cmd', e.target.value)}
                      placeholder="Checkout(actorId)"
                    />
                    <span className="dem-cmd-arrow">→</span>
                    <input
                      className="dem-input dem-input--cmd"
                      value={cmd.event}
                      onChange={e => updateCommand(i, 'event', e.target.value)}
                      placeholder="FileCheckedOut"
                    />
                    <button
                      type="button"
                      className="dem-cmd-remove"
                      onClick={() => removeCommand(i)}
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
                <button type="button" className="dem-add-cmd" onClick={addCommand}>
                  + Add command
                </button>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="dem-footer">
            {!isNew && onDelete && !confirmDelete && (
              <button
                type="button"
                className="dem-btn dem-btn--danger-ghost"
                onClick={() => setConfirmDelete(true)}
              >
                Remove domain
              </button>
            )}
            {!isNew && confirmDelete && (
              <div className="dem-confirm-row">
                <span className="dem-confirm-msg">Remove this domain?</span>
                <button
                  type="button"
                  className="dem-btn dem-btn--danger"
                  onClick={() => onDelete!(domain!.id)}
                >
                  Yes, remove
                </button>
                <button
                  type="button"
                  className="dem-btn dem-btn--ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="dem-footer-right">
              <button type="button" className="dem-btn dem-btn--ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="dem-btn dem-btn--primary">
                {isNew ? 'Add domain' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
