#!/usr/bin/env node
'use strict';
/**
 * claude-analyze.js  —  Two-phase analysis pipeline
 *
 * Phase 1: Claude runs the full domain-compose --refactor analysis and outputs
 *          free-form raw findings as JSON. Claude has full analytical freedom here.
 *
 * Phase 2: A second constrained Claude call takes the Phase 1 JSON and normalises
 *          it into the exact Studio schema. The schema is a fixed template — Claude
 *          only fills in values, never invents new keys.
 *
 * Phase 3: Validate the normalised JSON against required fields. Retry Phase 2
 *          once if validation fails.
 *
 * Usage:
 *   node claude-analyze.js --alias <service-alias> [--out <name>]
 *   node claude-analyze.js --dir /path/to/repo [--out <name>]
 */

const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }

const ALIAS       = flag('--alias');
const DIR         = flag('--dir');
const OUT         = flag('--out');
const MAX_DOMAINS = parseInt(flag('--max-domains') || '0', 10) || null; // null = no limit

if (!ALIAS && !DIR) {
  console.error('Usage: node claude-analyze.js --alias <alias>|--dir <path> [--out <name>] [--max-domains N] [--fresh]');
  console.error('  --max-domains N  Cap the number of domains (e.g. 5 for high-level, 12 for granular)');
  process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const serviceName = OUT || (ALIAS ? ALIAS : path.basename(DIR));
const projectRoot = path.resolve(path.join(__dirname, '..', '..'));
const dataOutPath = path.join(projectRoot, 'backend', 'data', `${serviceName}.json`);
fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'backend', 'data'), { recursive: true });

// ── Locate SKILL.md ───────────────────────────────────────────────────────────
function findSkillMd() {
  const candidates = [
    path.join(__dirname, '..', '..', 'skill', 'SKILL.md'),
    path.join(os.homedir(), 'Repo', 'claude-tools', 'plugins', 'seismic-engineering', 'skills', 'domain-compose', 'SKILL.md'),
    path.join(os.homedir(), 'repo',  'claude-tools', 'plugins', 'seismic-engineering', 'skills', 'domain-compose', 'SKILL.md'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const { execSync } = require('child_process');
    const hit = execSync(
      'find /var/folders -name "SKILL.md" -maxdepth 14 2>/dev/null | xargs grep -l "domain-compose" 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    if (hit) return hit;
  } catch {}
  return null;
}

const skillMdPath = process.env.DOMAIN_COMPOSE_SKILL_MD || findSkillMd();
if (!skillMdPath) {
  console.error('❌  Cannot find domain-compose SKILL.md. Set DOMAIN_COMPOSE_SKILL_MD env var.');
  process.exit(1);
}
const skillContent = fs.readFileSync(skillMdPath, 'utf8');
console.error(`  Skill      : ${skillMdPath}`);
console.error(`  Target     : ${serviceName}`);
console.error(`  Max domains: ${MAX_DOMAINS || 'no limit'}`);
console.error(`  Output     : ${dataOutPath}\n`);

// ── Helper: run claude --print and capture stdout ─────────────────────────────
function runClaude(systemExtra, userPrompt, label) {
  console.error(`  [${label}] Spawning claude…`);
  const result = spawnSync('claude', [
    '--print',
    '--dangerously-skip-permissions',
    '--append-system-prompt', skillContent + '\n\n' + systemExtra,
    '--output-format', 'text',
    userPrompt,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024, // 20 MB
    timeout: 25 * 60 * 1000,     // 25 min max
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  if (result.error) throw new Error(`Spawn error: ${result.error.message}`);

  // Echo stderr so it appears in the job log
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0 && !result.stdout?.trim()) {
    throw new Error(`claude exited with code ${result.status}`);
  }

  return result.stdout || '';
}

// ── Helper: extract JSON from Claude output (strips markdown fences) ──────────
function extractJSON(text) {
  // Try to find a JSON block (```json … ``` or bare { … })
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // Try to find the outermost { … }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('No valid JSON found in Claude output');
}

// ── Merge new findings into an existing canonical JSON ────────────────────────
// Keeps domain IDs and structure stable across runs.
// New violations are additive; existing ones are updated if more detail is found.
function mergeIntoCanonical(existing, fresh) {
  const merged = { ...fresh };

  // Keep existing domain IDs — remap fresh domains by matching on aggregate name or domain name
  const existingById = Object.fromEntries((existing.domains||[]).map(d=>[d.id,d]));
  const existingByAgg = Object.fromEntries((existing.domains||[])
    .filter(d=>d.dddTarget?.aggregate)
    .map(d=>[d.dddTarget.aggregate.toLowerCase().replace(/\s/g,''),d.id]));

  merged.domains = (fresh.domains||[]).map(fd=>{
    // Try to match to existing domain
    let existId = fd.id; // default: use fresh id
    // Match by same ID
    if (existingById[fd.id]) {
      existId = fd.id;
    } else {
      // Match by aggregate name
      const aggKey = (fd.dddTarget?.aggregate||'').toLowerCase().replace(/\s/g,'');
      if (existingByAgg[aggKey]) existId = existingByAgg[aggKey];
      else {
        // Match by similar name (first word of domain name)
        const nameKey = fd.name.toLowerCase().split(/[\s&\/]/)[0];
        const existMatch = (existing.domains||[]).find(ed=>
          ed.name.toLowerCase().startsWith(nameKey) || nameKey.startsWith(ed.name.toLowerCase().split(/[\s&\/]/)[0])
        );
        if (existMatch) existId = existMatch.id;
      }
    }

    const ex = existingById[existId];
    if (!ex) return { ...fd, id: existId }; // new domain

    // Merge: keep existing id, prefer fresh data but fill gaps from existing
    return {
      ...ex,
      ...fd,
      id: existId, // lock the ID
      dddTarget: {
        ...(ex.dddTarget||{}),
        ...(fd.dddTarget||{}),
        // Keep whichever has more invariants / commands
        invariants: mergeArrayBest(ex.dddTarget?.invariants, fd.dddTarget?.invariants),
        commands:   mergeArrayBest(ex.dddTarget?.commands,   fd.dddTarget?.commands),
        valueObjects: mergeArrayBest(ex.dddTarget?.valueObjects, fd.dddTarget?.valueObjects),
        lifecycle:    mergeArrayBest(ex.dddTarget?.lifecycle, fd.dddTarget?.lifecycle),
      },
    };
  });

  // Add any existing domains not found in fresh (Claude may have missed them)
  (existing.domains||[]).forEach(ed=>{
    const stillPresent = merged.domains.some(d=>d.id===ed.id);
    if (!stillPresent) merged.domains.push({ ...ed, _retainedFromPrevious: true });
  });

  // Gap analysis: merge by title — prefer fresher, more detailed description
  const gapByTitle = {};
  [...(existing.gapAnalysis||[]), ...(fresh.gapAnalysis||[])].forEach(g=>{
    const key = g.title.toLowerCase().replace(/\W+/g,' ').trim().slice(0,40);
    if (!gapByTitle[key] || (g.detail||'').length > (gapByTitle[key].detail||'').length)
      gapByTitle[key] = g;
  });
  merged.gapAnalysis = Object.values(gapByTitle)
    .sort((a,b)=>{ const sev={P0:0,P1:1,P2:2}; return (sev[a.severity]??3)-(sev[b.severity]??3); })
    .map((g,i)=>({ ...g, id: i+1 }));

  return merged;
}

function mergeArrayBest(a, b) {
  if (!a?.length) return b || [];
  if (!b?.length) return a || [];
  return b.length >= a.length ? b : a;
}

// ── Validate Studio schema ────────────────────────────────────────────────────
function validateStudioJSON(obj) {
  const errors = [];
  if (typeof obj.service !== 'string') errors.push('missing service');
  if (!Array.isArray(obj.domains) || obj.domains.length === 0) errors.push('missing domains[]');
  if (!Array.isArray(obj.workflows))  errors.push('missing workflows[]');
  if (!Array.isArray(obj.gapAnalysis)) errors.push('missing gapAnalysis[]');
  if (!obj.boundedContext)             errors.push('missing boundedContext');
  if (!obj.integrations)               errors.push('missing integrations');
  (obj.domains || []).forEach((d, i) => {
    if (!d.id)    errors.push(`domains[${i}] missing id`);
    if (!d.name)  errors.push(`domains[${i}] missing name`);
    if (!d.dddTarget) errors.push(`domains[${i}] missing dddTarget`);
  });
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Deep analysis: Claude runs the full skill, outputs raw findings JSON
// ─────────────────────────────────────────────────────────────────────────────
const domainConstraint = MAX_DOMAINS
  ? `DOMAIN COUNT CONSTRAINT: Identify exactly ${MAX_DOMAINS} domains or fewer. If the codebase has more natural domains, merge related ones into broader bounded contexts (e.g. merge "File" and "FileVersion" into "Content & Versioning") until you reach the limit. Aim for the most meaningful grouping at this granularity level.`
  : `Identify as many domains as the codebase naturally contains (typically 5–12 for a Seismic service).`;

const P1_SYSTEM = `
CRITICAL — NON-INTERACTIVE MODE. Do NOT ask questions. Do NOT pause. Do NOT emit prose explanations.
Run --refactor --yes and complete the full analysis end-to-end.

${domainConstraint}

Output ONLY a single valid JSON object (no markdown, no prose) with this structure:
{
  "service_name": "string",
  "analyzed_at": "YYYY-MM-DD",
  "tech_stack": "string (language, framework, DB)",
  "bounded_context": {
    "owns": ["string"],
    "depends_on": ["string"],
    "publishes_kafka": ["topic string"],
    "consumes_kafka": ["topic string"],
    "http_deps": ["ServiceName — description"],
    "background_services": ["ClassName — description"]
  },
  "domains": [
    {
      "name": "string",
      "responsibility": "one-sentence description",
      "health": "good|partial|anemic",
      "health_reason": "why",
      "key_operations": ["string"],
      "keywords": ["string"],
      "aggregate": {
        "class_name": "string (e.g. FileEntity)",
        "identity": "string",
        "lifecycle": ["state1","state2"],
        "value_objects": ["ClassName"],
        "child_entities": ["ClassName"],
        "invariants": ["plain English business rule"],
        "commands": [{"method": "MethodName(params)", "raises": "EventName"}]
      }
    }
  ],
  "workflows": [
    {
      "name": "string",
      "domain_sequence": ["domain-name"],
      "steps": [{"label": "string", "type": "api|domain|kafka|background|external|violation"}],
      "has_violations": true
    }
  ],
  "gap_analysis": [
    {
      "title": "short title",
      "detail": "detailed explanation",
      "file": "ClassName.cs",
      "severity": "P0|P1|P2",
      "category": "Anemic model|Layer violation|Missing concept|Infra coupling"
    }
  ]
}
`;

const inputArg = ALIAS
  ? `seismic/${ALIAS} --refactor --yes`
  : `${path.resolve(DIR)} --refactor --yes`;

const P1_USER = `${inputArg}

Analyze the service. Output ONLY the JSON described in your system prompt. No prose. No markdown fences.`;

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Normalise raw findings into exact Studio schema
// ─────────────────────────────────────────────────────────────────────────────
const STUDIO_SCHEMA_EXAMPLE = JSON.stringify({
  service: serviceName,
  analyzedAt: new Date().toISOString().slice(0, 10),
  boundedContext: {
    owns: ['example: File lifecycle & versioning'],
    dependsOn: ['UMS — user identity'],
    publishes: ['eventbus.public.service.event-topic'],
    consumes: ['eventbus.public.other.topic'],
  },
  gapAnalysis: [{
    id: 1, title: 'Title', detail: 'Explanation',
    file: 'ClassName.cs', severity: 'P0',
    category: 'Anemic model',
  }],
  domains: [{
    id: 'kebab-case-id',
    name: 'Human Name',
    icon: '📄',
    health: 'anemic',
    operations: ['Operation name'],
    keywords: ['keyword'],
    dddTarget: {
      aggregate: 'EntityName',
      identity: 'fieldId (Type)',
      lifecycle: ['state1', 'state2'],
      valueObjects: ['ValueObjectName'],
      childEntities: ['ChildEntityName'],
      invariants: ['Plain English business rule'],
      commands: [{ cmd: 'MethodName(params)', event: 'EventName' }],
    },
  }],
  workflows: [{
    id: 'workflow-id',
    name: 'Workflow Name',
    domains: ['domain-id'],
    steps: [{ label: 'Step description', type: 'api' }],
  }],
  integrations: {
    kafkaIn: ['topic.name'],
    kafkaOut: ['topic.name'],
    http: ['ServiceName'],
    background: ['WorkerClassName'],
  },
}, null, 2);

function buildPhase2Prompt(phase1JSON) {
  return `
You are a data normaliser. Convert the raw DDD analysis findings (Phase 1 JSON) into the exact Studio schema below.

Rules:
- domain id = kebab-case of domain name (e.g. "File & Content" → "file-content")
- workflow id = kebab-case of workflow name
- health must be exactly "good", "partial", or "anemic"
- severity must be exactly "P0", "P1", or "P2"
- category must be one of: "Anemic model", "Layer violation", "Missing concept", "Infra coupling"
- gap analysis items must be numbered from 1
- step type must be one of: "api", "domain", "kafka", "background", "external", "violation"
- icons: 📄 files · 📁 folders · 🚀 publishing · 🔐 permissions · 🔄 sync · ⏱ expiration · 🏷 properties · 🤝 collaboration · 🎬 media · 🔍 search · 👤 users · ⚙️ workflow · 📦 other
- Output ONLY the JSON object. No markdown, no prose, no fences.

TARGET SCHEMA (fill every field, do not omit any):
${STUDIO_SCHEMA_EXAMPLE}

PHASE 1 FINDINGS TO NORMALISE:
${JSON.stringify(phase1JSON, null, 2)}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // ── Phase 1 ───────────────────────────────────────────────────────────────
  console.error('══════════════════════════════════════════');
  console.error('  Phase 1 — Deep analysis (free-form)');
  console.error('  Expect 10–20 min…');
  console.error('══════════════════════════════════════════');

  let phase1Raw;
  try {
    phase1Raw = runClaude(P1_SYSTEM, P1_USER, 'Phase 1');
  } catch (err) {
    console.error(`\n❌  Phase 1 failed: ${err.message}`);
    process.exit(1);
  }

  let phase1JSON;
  try {
    phase1JSON = extractJSON(phase1Raw);
    console.error(`\n  ✅  Phase 1 complete — ${(phase1JSON.domains||[]).length} domains found`);
  } catch (err) {
    console.error(`\n❌  Phase 1 JSON parse error: ${err.message}`);
    // Save raw for debugging
    const debugPath = path.join(projectRoot, 'docs', `${serviceName}-phase1-debug.txt`);
    fs.writeFileSync(debugPath, phase1Raw);
    console.error(`   Raw output saved to: ${debugPath}`);
    process.exit(1);
  }

  // Save Phase 1 for reference (useful for debugging / re-running Phase 2 only)
  const p1Path = path.join(projectRoot, 'docs', `${serviceName}-phase1.json`);
  fs.writeFileSync(p1Path, JSON.stringify(phase1JSON, null, 2));
  console.error(`  Phase 1 saved: ${p1Path}`);

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  console.error('\n══════════════════════════════════════════');
  console.error('  Phase 2 — Normalise to Studio schema');
  console.error('  Should be fast (1–2 min)…');
  console.error('══════════════════════════════════════════');

  const P2_SYSTEM = `You are a precise JSON data normaliser. Output ONLY valid JSON conforming exactly to the schema provided. No explanations, no markdown.`;

  let studioJSON;
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    let phase2Raw;
    try {
      phase2Raw = runClaude(P2_SYSTEM, buildPhase2Prompt(phase1JSON), `Phase 2 attempt ${attempt}`);
    } catch (err) {
      console.error(`\n❌  Phase 2 attempt ${attempt} failed: ${err.message}`);
      if (attempt >= 2) process.exit(1);
      continue;
    }

    try {
      studioJSON = extractJSON(phase2Raw);
    } catch (err) {
      console.error(`  ❌  JSON parse error on attempt ${attempt}: ${err.message}`);
      if (attempt >= 2) process.exit(1);
      continue;
    }

    const errors = validateStudioJSON(studioJSON);
    if (errors.length === 0) {
      console.error(`\n  ✅  Phase 2 validated — ${studioJSON.domains.length} domains, ${studioJSON.workflows.length} workflows`);
      break;
    } else {
      console.error(`  ⚠  Validation errors (attempt ${attempt}): ${errors.join(', ')}`);
      if (attempt >= 2) {
        console.error('  Saving partial output anyway…');
        break;
      }
    }
  }

  // ── Merge into existing canonical (if one exists) ────────────────────────
  studioJSON.service    = studioJSON.service    || serviceName;
  studioJSON.analyzedAt = studioJSON.analyzedAt || new Date().toISOString().slice(0, 10);
  studioJSON.integrations = studioJSON.integrations || { kafkaIn: [], kafkaOut: [], http: [], background: [] };

  const FRESH = args.includes('--fresh');
  if (!FRESH && fs.existsSync(dataOutPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dataOutPath, 'utf8'));
      console.error('\n  Merging with existing canonical…');
      const domainsBefore = (existing.domains||[]).length;
      studioJSON = mergeIntoCanonical(existing, studioJSON);
      const domainsAfter = (studioJSON.domains||[]).length;
      console.error(`  Domains: ${domainsBefore} existing → ${domainsAfter} after merge`);
      console.error(`  Gap items: ${(studioJSON.gapAnalysis||[]).length} (merged + deduplicated)`);
    } catch (err) {
      console.error(`  ⚠  Could not merge with existing (${err.message}) — using fresh output`);
    }
  } else if (FRESH) {
    console.error('\n  --fresh flag: replacing canonical with new output');
  }

  fs.writeFileSync(dataOutPath, JSON.stringify(studioJSON, null, 2));
  console.error(`\n✅  Studio JSON written: ${dataOutPath}`);
  console.error(`   Domains    : ${(studioJSON.domains||[]).length}`);
  console.error(`   Workflows  : ${(studioJSON.workflows||[]).length}`);
  console.error(`   Gap items  : ${(studioJSON.gapAnalysis||[]).length}`);
  const p0 = (studioJSON.gapAnalysis||[]).filter(g=>g.severity==='P0').length;
  const p1 = (studioJSON.gapAnalysis||[]).filter(g=>g.severity==='P1').length;
  console.error(`   Violations : ${p0} P0, ${p1} P1`);
}

main().catch(err => { console.error(`\n❌  ${err.message}`); process.exit(1); });
