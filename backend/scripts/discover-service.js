#!/usr/bin/env node
'use strict';
/**
 * discover-service.js
 *
 * Generates a domain-compose JSON by querying the real Seismic service catalog
 * and live Swagger spec — not regex-guessing from source files.
 *
 * Uses two Python scripts from the seismic-engineering plugin:
 *   find_service_info.py      — catalog metadata (tier, team, area, description)
 *   find_service_api_details.py — Swagger endpoints grouped by tag
 *
 * Usage:
 *   node discover-service.js --alias <service-alias>
 *   node discover-service.js --alias <service-alias> --out <name>
 *   node discover-service.js --alias <service-alias> --print
 *
 * Options:
 *   --alias <alias>  Seismic service alias from the catalog (required)
 *   --out   <name>   Output filename stem written to backend/data/<name>.json
 *   --print          Print JSON to stdout instead of writing a file
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const PRINT = args.includes('--print');
function flag(name) { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }

const ALIAS = flag('--alias');
const OUT   = flag('--out');

if (!ALIAS) {
  console.error('Usage: node discover-service.js --alias <service-alias> [--out <name>] [--print]');
  process.exit(1);
}

// ── Locate the service-discovery Python scripts ───────────────────────────────
function findScriptsDir() {
  // 1. Explicit env var
  if (process.env.SEISMIC_DISCOVERY_SCRIPTS) return process.env.SEISMIC_DISCOVERY_SCRIPTS;

  // 2. Search known plugin temp paths (macOS /var/folders/...)
  try {
    const result = execSync(
      'find /var/folders -name "find_service_info.py" -maxdepth 12 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    if (result) return path.dirname(result);
  } catch { /* ignore */ }

  // 3. Search home dir plugin installs
  try {
    const result = execSync(
      `find "${os.homedir()}" -name "find_service_info.py" -maxdepth 12 2>/dev/null | head -1`,
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    if (result) return path.dirname(result);
  } catch { /* ignore */ }

  return null;
}

const SCRIPTS_DIR = findScriptsDir();
if (!SCRIPTS_DIR) {
  console.error([
    '❌  Could not find the service-discovery scripts.',
    '    Make sure the seismic-engineering plugin is installed in Claude.',
    '    Or set: export SEISMIC_DISCOVERY_SCRIPTS=/path/to/skills/service-discovery/scripts',
  ].join('\n'));
  process.exit(1);
}

const INFO_SCRIPT   = path.join(SCRIPTS_DIR, 'find_service_info.py');
const DETAIL_SCRIPT = path.join(SCRIPTS_DIR, 'find_service_api_details.py');
console.error(`  Scripts: ${SCRIPTS_DIR}`);

// ── Run a Python script and return its stdout ─────────────────────────────────
function runPy(scriptPath, ...pyArgs) {
  const result = spawnSync('python3', [scriptPath, ...pyArgs], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env },
  });
  if (result.error) throw new Error(`Failed to run ${path.basename(scriptPath)}: ${result.error.message}`);
  if (result.status !== 0) {
    const msg = (result.stderr || '').trim() || `exit code ${result.status}`;
    throw new Error(`${path.basename(scriptPath)} failed: ${msg}`);
  }
  return result.stdout || '';
}

// ── Parse key:value lines from find_service_info.py output ────────────────────
function parseInfoOutput(raw) {
  const info = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_\-]+)\s*:\s*(.+)$/);
    if (m) info[m[1].toLowerCase().replace(/-/g, '_')] = m[2].trim();
  }
  return info;
}

// ── Parse endpoint list from find_service_api_details.py search output ────────
// Output format (per line):  [TAG]  METHOD  /path/to/endpoint  — summary
function parseEndpointOutput(raw) {
  const endpoints = [];
  const tagRe = /^\[([^\]]+)\]\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)(?:\s+[–—-]\s+(.+))?$/;
  for (const line of raw.split('\n')) {
    const m = line.trim().match(tagRe);
    if (m) endpoints.push({ tag: m[1], method: m[2], path: m[3], summary: (m[4] || '').trim() });
  }
  return endpoints;
}

// ── Derive health heuristic from endpoint richness per domain ─────────────────
function domainHealth(ops) {
  if (ops.length >= 6) return 'good';
  if (ops.length >= 3) return 'partial';
  return 'anemic';
}

// ── Domain icon map (tag keyword → icon) ──────────────────────────────────────
const ICON_MAP = [
  [/content|item|file|doc/i, '📄'],
  [/version|versio/i,        '🔖'],
  [/activ|publish|release/i, '🚀'],
  [/sync|import|export/i,    '🔄'],
  [/expir|archiv/i,          '⏱'],
  [/property|metadata|tag/i, '🏷'],
  [/permission|access|auth/i,'🔐'],
  [/collaborat|comment|review/i,'🤝'],
  [/rendition|media|video/i, '🎬'],
  [/search|index|query/i,    '🔍'],
  [/notif|alert|email/i,     '🔔'],
  [/user|member|profile/i,   '👤'],
  [/report|analytic/i,       '📊'],
  [/workflow|approval/i,     '⚙️'],
  [/integrat|connect/i,      '🔌'],
];
function iconFor(name) {
  for (const [re, icon] of ICON_MAP) if (re.test(name)) return icon;
  return '📦';
}

// ── Build domain keywords from tag name ───────────────────────────────────────
function keywordsFor(tagName) {
  return tagName.toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

// ── Detect simple HTTP method → lifecycle direction ───────────────────────────
function methodToOp(method, summary) {
  const s = (summary || '').toLowerCase();
  if (method === 'DELETE') return 'Delete';
  if (method === 'POST' && /creat|add|new|upload|start/i.test(s)) return 'Create';
  if (method === 'POST') return 'Execute';
  if (method === 'PUT' || method === 'PATCH') return 'Update';
  if (method === 'GET' && /list|search|all/i.test(s)) return 'List';
  if (method === 'GET') return 'Get';
  return method;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.error(`\n  Fetching catalog metadata for "${ALIAS}"…`);
let info;
try {
  const raw = runPy(INFO_SCRIPT, 'service', ALIAS);
  info = parseInfoOutput(raw);
  console.error(`  ✅  Catalog: ${info.name || ALIAS} — team: ${info.owner || '?'} — tier: ${info.tier || '?'}`);
} catch (err) {
  console.error(`  ⚠️  Catalog lookup failed: ${err.message}`);
  info = {};
}

console.error(`  Fetching Swagger endpoints…`);
let endpoints = [];
try {
  const raw = runPy(DETAIL_SCRIPT, 'search', ALIAS, '');
  endpoints = parseEndpointOutput(raw);
  console.error(`  ✅  Found ${endpoints.length} endpoints`);
} catch (err) {
  console.error(`  ⚠️  Swagger fetch failed: ${err.message}`);
}

// ── Group endpoints by Swagger tag → one domain per tag ───────────────────────
const tagMap = new Map(); // tag → endpoint[]
for (const ep of endpoints) {
  const tag = ep.tag || 'General';
  if (!tagMap.has(tag)) tagMap.set(tag, []);
  tagMap.get(tag).push(ep);
}

// If no tags (no Swagger), fall back to a single domain from catalog
if (tagMap.size === 0) {
  tagMap.set(info.name || ALIAS, []);
}

const domains = [...tagMap.entries()].map(([tag, eps]) => {
  const id   = tag.replace(/\s+/g, '-').toLowerCase();
  const ops  = [...new Set(eps.map(ep => {
    const base = ep.summary || [ep.method, ep.path.split('/').pop()].join(' ');
    return base.trim();
  }))].slice(0, 10);

  // Derive commands from POST/PUT/DELETE endpoints
  const commands = eps
    .filter(ep => ['POST','PUT','PATCH','DELETE'].includes(ep.method))
    .slice(0, 6)
    .map(ep => ({
      cmd:   `${ep.method} ${ep.path}`,
      event: (ep.summary || ep.path.split('/').pop())
               .replace(/\b\w/g, c => c.toUpperCase())
               .replace(/\s+/g, '') + 'Event',
    }));

  return {
    id,
    name:    tag,
    icon:    iconFor(tag),
    health:  domainHealth(ops),
    operations: ops.length > 0 ? ops : [`${tag} operations`],
    keywords:   keywordsFor(tag),
    dddTarget: {
      aggregate:    `${tag.replace(/\s+/g, '')}Entity`,
      identity:     'unknown — inspect source',
      lifecycle:    [],
      valueObjects: [],
      childEntities: [],
      invariants:   [],
      commands,
    },
  };
});

// ── Infer a rough workflow from the endpoint list ─────────────────────────────
const workflows = [];
if (tagMap.size > 1) {
  // Build one workflow per POST endpoint that touches the primary domain
  const primaryTag = [...tagMap.keys()][0];
  const primaryEps = tagMap.get(primaryTag).filter(e => e.method === 'POST').slice(0, 2);
  for (const ep of primaryEps) {
    workflows.push({
      id:      ep.path.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g,''),
      name:    ep.summary || ep.path,
      domains: [primaryTag.replace(/\s+/g,'-').toLowerCase()],
      steps:   [
        { label: `${ep.method} ${ep.path}`, type: 'api' },
        { label: `${primaryTag} handler`, type: 'domain' },
      ],
    });
  }
}
if (workflows.length === 0) {
  workflows.push({
    id: 'main-flow', name: 'Main Flow',
    domains: domains.slice(0, 2).map(d => d.id),
    steps: [],
  });
}

// ── Build output ──────────────────────────────────────────────────────────────
const serviceName = OUT || info.alias || ALIAS;
const output = {
  service:    serviceName,
  analyzedAt: new Date().toISOString().slice(0, 10),
  meta: {
    name:        info.name        || ALIAS,
    team:        info.owner       || 'unknown',
    tier:        info.tier        || 'unknown',
    area:        info.strategic_area || info.functional_area || 'unknown',
    description: info.description || '',
    source:      'seismic-service-catalog + swagger',
  },
  domains,
  workflows,
  integrations: {
    kafkaIn:    [],
    kafkaOut:   [],
    http:       [],
    background: [],
    note:       'Run with --dir for Kafka/HTTP integration details from source code',
  },
};

// ── Write or print ────────────────────────────────────────────────────────────
const jsonStr = JSON.stringify(output, null, 2);
if (PRINT) {
  process.stdout.write(jsonStr + '\n');
} else {
  const outDir  = path.join(__dirname, '..', 'data');
  const outFile = path.join(outDir, `${serviceName}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, jsonStr);
  console.error(`\n✅  Wrote: ${outFile}`);
  console.error(`   Domains found:   ${output.domains.length} (from ${tagMap.size} Swagger tags)`);
  console.error(`   Endpoints total: ${endpoints.length}`);
  console.error(`   Team:            ${output.meta.team}`);
  console.error(`   Tier:            ${output.meta.tier}`);
  console.error(`\n   Now run: node server.js`);
  console.error(`   Then hit: POST /api/impact { "service": "${serviceName}", "requirement": "..." }\n`);
}
