#!/usr/bin/env node
'use strict';
/**
 * analyze-service.js
 *
 * Scans a Seismic C# service repo and emits a domain-compose JSON file.
 *
 * Usage:
 *   node analyze-service.js --dir /path/to/service-repo
 *   node analyze-service.js --dir /path/to/service-repo --out my-service
 *   node analyze-service.js --dir /path/to/service-repo --print
 *
 * Options:
 *   --dir  <path>   Path to the service repo root (required)
 *   --out  <name>   Output filename stem written to backend/data/<name>.json
 *                   Defaults to the directory name
 *   --print         Print JSON to stdout instead of writing a file
 */

const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}
const PRINT = args.includes('--print');
const DIR   = flag('--dir');
const OUT   = flag('--out');

if (!DIR) {
  console.error('Usage: node analyze-service.js --dir <repo-path> [--out <name>] [--print]');
  process.exit(1);
}
const repoRoot = path.resolve(DIR);
if (!fs.existsSync(repoRoot)) {
  console.error(`Directory not found: ${repoRoot}`);
  process.exit(1);
}

const serviceName = OUT || path.basename(repoRoot);

// ── File walker ───────────────────────────────────────────────────────────────
function walk(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, results);
    else if (exts.some(e => entry.name.endsWith(e))) results.push(full);
  }
  return results;
}

const csFiles = walk(repoRoot, ['.cs']);
console.error(`  Scanning ${csFiles.length} .cs files in ${repoRoot} …`);

// ── Read helpers ──────────────────────────────────────────────────────────────
function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// ── 1. Identify domains from Writer / Reader / Service class files ────────────
const DOMAIN_FILE_RE = /([A-Z][A-Za-z0-9]+)(Writer|Reader|Service|Controller|Manager)\.cs$/;
const domainMap = new Map(); // domainId → { name, files, operations, keywords }

for (const f of csFiles) {
  const base = path.basename(f);
  const m    = base.match(DOMAIN_FILE_RE);
  if (!m) continue;

  const raw   = m[1]; // e.g. "ContentItem", "Activation"
  const role  = m[2]; // Writer | Reader | Service | Controller | Manager
  const id    = raw.replace(/([A-Z])/g, (c, i) => (i ? '-' : '') + c).toLowerCase();

  if (!domainMap.has(id)) {
    domainMap.set(id, {
      id,
      name:       raw.replace(/([A-Z])/g, (c, i) => (i ? ' ' : '') + c).trim(),
      icon:       '📦',
      health:     'anemic',
      files:      [],
      operations: new Set(),
      keywords:   new Set(),
    });
  }
  const d = domainMap.get(id);
  d.files.push({ file: f, role });

  // Extract public method names as operations
  const src     = readFile(f);
  const methods = [...src.matchAll(/public\s+(?:async\s+)?(?:Task<[^>]+>|[A-Za-z<>\[\]]+)\s+([A-Z][A-Za-z0-9]+)\s*\(/g)];
  methods.forEach(([, name]) => {
    if (!['ToString','Equals','GetHashCode','GetType','Dispose','Configure'].includes(name))
      d.operations.add(name);
  });

  // Keywords from the class name tokens
  raw.replace(/([A-Z][a-z0-9]+)/g, (w) => d.keywords.add(w.toLowerCase()));
}

// ── 2. Extract entities / aggregates / value objects ─────────────────────────
const ENTITY_RE   = /class\s+([A-Za-z0-9]+)(Entity|Aggregate)\b/g;
const VO_RE       = /class\s+([A-Za-z0-9]+)(Value|ValueObject|Id)\b/g;
const LIFECYCLE_RE = /enum\s+([A-Za-z0-9]+)(Status|State|Phase)\s*\{([^}]+)\}/g;

const allEntities   = new Set();
const allVOs        = new Set();
const lifecycleMap  = new Map(); // entity → states[]

for (const f of csFiles) {
  const src = readFile(f);
  for (const [, name, suffix] of src.matchAll(ENTITY_RE))   allEntities.add(name + suffix);
  for (const [, name]         of src.matchAll(VO_RE))        allVOs.add(name);
  for (const [, name, , body] of src.matchAll(LIFECYCLE_RE)) {
    const states = body.split(',')
      .map(s => s.replace(/\/\/[^\n]*/g, '').trim().toLowerCase())
      .filter(s => /^[a-z]/.test(s));
    lifecycleMap.set(name.toLowerCase(), states);
  }
}

// Assign entities/VOs/lifecycle to the domain they probably belong to
for (const [id, d] of domainMap) {
  const token = d.name.replace(/ /g, '').toLowerCase();
  for (const e of allEntities) {
    if (e.toLowerCase().startsWith(token)) {
      if (!d.aggregate) d.aggregate = e;
    }
  }
  for (const vo of allVOs) {
    if (vo.toLowerCase().includes(token)) {
      if (!d.valueObjects) d.valueObjects = [];
      d.valueObjects.push(vo);
    }
  }
  for (const [lName, states] of lifecycleMap) {
    if (lName.startsWith(token)) {
      d.lifecycle = states;
    }
  }
}

// ── 3. Extract Kafka topics ───────────────────────────────────────────────────
const KAFKA_TOPIC_RE  = /"([a-z][a-z0-9\-._]+-(?:topic|event|notification|result|setting|references)[^"]*)"/gi;
const KAFKA_PRODUCE_RE = /IKafkaProducer\s*<[^,>]+,\s*([A-Za-z0-9]+)\s*>/g;
const KAFKA_CONSUME_RE = /IKafkaConsumer\s*<[^,>]+,\s*([A-Za-z0-9]+)\s*>|KafkaTopic\s*\(\s*"([^"]+)"\s*\)/g;

const kafkaOut = new Set();
const kafkaIn  = new Set();

for (const f of csFiles) {
  const src = readFile(f);
  for (const [, topic] of src.matchAll(KAFKA_TOPIC_RE)) {
    // Heuristic: files with Producer in the class name → kafkaOut
    if (/producer|publisher|writer/i.test(path.basename(f))) kafkaOut.add(topic);
    else if (/consumer|listener|handler/i.test(path.basename(f)))  kafkaIn.add(topic);
    else kafkaOut.add(topic); // default: assume out
  }
  for (const [, name] of src.matchAll(KAFKA_PRODUCE_RE)) kafkaOut.add(name.replace(/([A-Z])/g, (c,i) => (i?'-':'')+c).toLowerCase() + '-topic');
  for (const [, n1, n2] of src.matchAll(KAFKA_CONSUME_RE)) {
    const name = n1 || n2;
    if (name) kafkaIn.add(name.replace(/([A-Z])/g, (c,i) => (i?'-':'')+c).toLowerCase());
  }
}

// ── 4. Extract HTTP client dependencies ──────────────────────────────────────
// Look for injected service clients: I<Name>Client or I<Name>Service (external)
const HTTP_CLIENT_RE = /I([A-Z][A-Za-z0-9]+)(?:Client|HttpClient|ServiceClient)\b/g;
const httpDeps = new Set();
for (const f of csFiles) {
  const src = readFile(f);
  for (const [, name] of src.matchAll(HTTP_CLIENT_RE)) httpDeps.add(name);
}

// ── 5. Detect background services ────────────────────────────────────────────
const BG_RE = /class\s+([A-Za-z0-9]+(?:BGService|BackgroundService|Worker|Listener|HostedService))\b/g;
const bgServices = new Set();
for (const f of csFiles) {
  for (const [, name] of readFile(f).matchAll(BG_RE)) bgServices.add(name);
}

// ── 6. Detect workflows from Controller endpoints → orchestrator chains ────────
// Simple: group controller methods that call multiple Writer classes
const WORKFLOW_RE = /\[Http(?:Post|Put|Get|Patch)\([^\)]*\)\]\s*(?:\[[^\]]*\]\s*)*public[^{]+\{([^}]{0,2000})\}/g;
const workflows = [];
for (const f of csFiles) {
  if (!f.endsWith('Controller.cs')) continue;
  const src  = readFile(f);
  const ctrl = path.basename(f, '.cs').replace(/Controller$/, '');
  for (const [, body] of src.matchAll(WORKFLOW_RE)) {
    // Find which domain writers/services are called
    const called = [...body.matchAll(/\b([A-Z][A-Za-z0-9]+(?:Writer|Reader|Service))\b/g)]
      .map(([,n]) => n.replace(/([A-Z])/g, (c,i)=>(i?'-':'')+c).toLowerCase().replace(/-(?:writer|reader|service)$/,''))
      .filter((v, i, a) => a.indexOf(v) === i && domainMap.has(v));
    if (called.length > 1) {
      workflows.push({
        id:      ctrl.replace(/([A-Z])/g, (c,i)=>(i?'-':'')+c).toLowerCase() + '-flow',
        name:    ctrl.replace(/([A-Z])/g, (c,i)=>(i?' ':'')+c).trim() + ' Flow',
        domains: called,
        steps:   called.map(d => ({ label: domainMap.get(d)?.name + ' step', type: 'domain' })),
      });
    }
  }
}

// ── 7. Determine domain health heuristic ─────────────────────────────────────
// 'good'    → has entity + value objects + lifecycle
// 'partial' → has entity or lifecycle but not both
// 'anemic'  → just operations, no entity model found
for (const [, d] of domainMap) {
  const hasEntity    = !!d.aggregate;
  const hasLifecycle = d.lifecycle && d.lifecycle.length > 0;
  const hasVOs       = d.valueObjects && d.valueObjects.length > 0;
  d.health = (hasEntity && hasLifecycle && hasVOs) ? 'good'
           : (hasEntity || hasLifecycle)           ? 'partial'
           :                                         'anemic';
}

// ── 8. Assemble output JSON ───────────────────────────────────────────────────
const output = {
  service:    serviceName,
  analyzedAt: new Date().toISOString().slice(0, 10),
  domains: [...domainMap.values()].map(d => ({
    id:         d.id,
    name:       d.name,
    icon:       d.icon,
    health:     d.health,
    operations: [...d.operations].slice(0, 12),
    keywords:   [...d.keywords].slice(0, 8),
    dddTarget: {
      aggregate:    d.aggregate || `${d.name.replace(/ /g,'')}Entity (not found)`,
      identity:     'unknown — inspect source',
      lifecycle:    d.lifecycle || [],
      valueObjects: d.valueObjects || [],
      childEntities: [],
      invariants:   [],
      commands:     [],
    },
  })),
  workflows: workflows.length > 0 ? workflows : [
    {
      id: 'unknown',
      name: 'No workflows detected — add manually',
      domains: [],
      steps: [],
    },
  ],
  integrations: {
    kafkaIn:    [...kafkaIn],
    kafkaOut:   [...kafkaOut],
    http:       [...httpDeps],
    background: [...bgServices],
  },
};

// ── 9. Write or print ─────────────────────────────────────────────────────────
const jsonStr = JSON.stringify(output, null, 2);

if (PRINT) {
  process.stdout.write(jsonStr + '\n');
} else {
  const outDir  = path.join(__dirname, '..', 'data');
  const outFile = path.join(outDir, `${serviceName}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, jsonStr);
  console.error(`\n✅  Wrote: ${outFile}`);
  console.error(`   Domains found:    ${output.domains.length}`);
  console.error(`   Workflows found:  ${output.workflows.length}`);
  console.error(`   Kafka IN topics:  ${output.integrations.kafkaIn.length}`);
  console.error(`   Kafka OUT topics: ${output.integrations.kafkaOut.length}`);
  console.error(`   HTTP deps:        ${output.integrations.http.length}`);
  console.error(`   Background svc:   ${output.integrations.background.length}`);
  console.error(`\n   Now run: node server.js`);
  console.error(`   Then hit: POST /api/impact { "service": "${serviceName}", "requirement": "..." }\n`);
}
