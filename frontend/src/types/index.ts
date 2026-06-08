export interface DomainStep {
  label: string;
  type: 'api' | 'domain' | 'kafka' | 'background' | 'external' | 'violation';
}

export interface Workflow {
  id: string;
  name: string;
  domains: string[];
  steps: DomainStep[];
}

export interface Domain {
  id: string;
  name: string;
  icon: string;
  health: 'good' | 'partial' | 'anemic';
  operations: string[];
  keywords: string[];
}

export interface ServiceData {
  service: string;
  analyzedAt: string;
  domains: Domain[];
  workflows: Workflow[];
  integrations: {
    kafkaIn: string[];
    kafkaOut: string[];
    http: string[];
    background: string[];
  };
}

export interface ImpactScore {
  score: number;
  level: 'direct' | 'indirect' | 'none';
  matchedKeywords: string[];
  matchedOps: string[];
}

export interface ImpactResult {
  requirement: string;
  domainScores: Record<string, ImpactScore>;
  workflowScores: Record<string, 'direct' | 'indirect' | 'none'>;
}
