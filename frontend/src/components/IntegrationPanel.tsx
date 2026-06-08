import './IntegrationPanel.css';

interface Props {
  integrations: {
    kafkaIn: string[];
    kafkaOut: string[];
    http: string[];
    background: string[];
  };
}

export default function IntegrationPanel({ integrations }: Props) {
  const groups = [
    { title: 'Kafka — Consumed (IN)', items: integrations.kafkaIn, cls: 'kafka-in' },
    { title: 'Kafka — Published (OUT)', items: integrations.kafkaOut, cls: 'kafka-out' },
    { title: 'HTTP Services', items: integrations.http, cls: 'http' },
    { title: 'Background Services', items: integrations.background, cls: 'bg' },
  ];
  return (
    <div className="int-grid">
      {groups.map(g => (
        <div key={g.title} className={`int-card ${g.cls}`}>
          <h4>{g.title}</h4>
          <ul>{g.items.map(i => <li key={i}>{i}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
