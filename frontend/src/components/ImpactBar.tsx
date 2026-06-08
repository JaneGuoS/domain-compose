import { useState } from 'react';
import './ImpactBar.css';

interface Props {
  onSearch: (req: string) => void;
  counts: { direct: number; indirect: number; none: number } | null;
  requirement?: string;
}

export default function ImpactBar({ onSearch, counts, requirement }: Props) {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(value);
  };

  return (
    <div className="impact-bar">
      <form className="impact-form" onSubmit={submit}>
        <span className="impact-icon">⚡</span>
        <input
          className="impact-input"
          placeholder="Type a new requirement to see its impact… e.g. 'AI metadata tagging'"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <button className="impact-btn" type="submit">Analyse Impact</button>
        {counts && <button className="impact-clear" type="button" onClick={() => { setValue(''); onSearch(''); }}>✕ Clear</button>}
      </form>
      {counts && (
        <div className="impact-summary">
          <span className="badge direct">🔴 {counts.direct} directly impacted</span>
          <span className="badge indirect">🟡 {counts.indirect} indirectly affected</span>
          <span className="badge none">⚪ {counts.none} unchanged</span>
        </div>
      )}
    </div>
  );
}
