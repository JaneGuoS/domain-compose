'use strict';
const express       = require('express');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { exec, spawn } = require('child_process');
const natural       = require('natural');
const sqliteDb      = require('./db');

const DATA_DIR     = path.join(__dirname, 'data');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const FRONTEND_DIST = path.join(FRONTEND_DIR, 'dist');
const PORT         = 3001;

// ── NLP setup ────────────────────────────────────────────────────────────────
const stemmer   = natural.PorterStemmer;
const tokenizer = new natural.WordTokenizer();

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','not','can','what','how',
  'when','where','which','who','all','any','each','per',
]);

/** Tokenise → lowercase → remove stop words → stem */
function normalise(text) {
  return tokenizer.tokenize(text.toLowerCase())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .map(w => stemmer.stem(w));
}

/** Build a rich text blob for a domain (used as TF-IDF document) */
function domainText(d) {
  return [
    d.name,
    ...(d.keywords   || []),
    ...(d.operations || []),
    ...(d.dddTarget?.valueObjects  || []),
    ...(d.dddTarget?.lifecycle     || []),
    ...(d.dddTarget?.invariants    || []),
    ...(d.dddTarget?.commands?.map(c => c.cmd) || []),
  ].join(' ');
}

// ── Corpus cache (built once per service file, reused on every request) ──────
const cache = new Map(); // serviceName → { data, tfidf, domainIndex }

function loadService(name) {
  if (cache.has(name)) return cache.get(name);

  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Merge any manual SQLite edits on top of the base JSON
  data.domains = sqliteDb.applyEdits(name, data.domains);

  // Build TF-IDF model: one document per domain
  const tfidf = new natural.TfIdf();
  data.domains.forEach(d => tfidf.addDocument(normalise(domainText(d))));

  // Quick lookup: domain id → array index
  const domainIndex = Object.fromEntries(data.domains.map((d, i) => [d.id, i]));

  cache.set(name, { data, tfidf, domainIndex });
  return cache.get(name);
}

// ── Impact scoring ────────────────────────────────────────────────────────────
/**
 * Score each domain against `requirement` using TF-IDF.
 *
 * Algorithm:
 *  1. Tokenise + stem the requirement (same pipeline as corpus).
 *  2. For each domain document, sum the TF-IDF weight of every requirement token.
 *     TF-IDF rewards tokens that appear in *this* domain but not in every domain
 *     (i.e. discriminating, domain-specific terms score higher).
 *  3. Normalise scores to a 0–10 scale relative to the top-scoring domain.
 *  4. Apply a minimum absolute score gate before assigning levels, so a query
 *     with zero overlap never gets forced into 'direct'.
 */
// ── Semantic impact via Claude ────────────────────────────────────────────────
// Builds a compact domain summary and asks Claude to classify each domain.
// Returns the same shape as scoreImpact so the UI needs no changes.
function semanticImpact(data, requirement) {
  const { spawnSync } = require('child_process');

  // Compact domain summaries to keep the prompt small
  const domainSummaries = data.domains.map(d => ({
    id: d.id,
    name: d.name,
    operations: (d.operations || []).slice(0, 8),
    keywords: (d.keywords || []).slice(0, 6),
    invariants: (d.dddTarget?.invariants || []).slice(0, 3),
    commands: (d.dddTarget?.commands || []).slice(0, 4).map(c => c.cmd),
  }));

  // Include workflows for critical-path analysis
  const workflowSummaries = (data.workflows || []).map(wf => ({
    id: wf.id,
    name: wf.name,
    domains: wf.domains,
    steps: (wf.steps || []).map((s, i) => ({ index: i, label: s.label, type: s.type })),
  }));

  const prompt = `You are a domain impact analyser for DDD (Domain-Driven Design).

Service: ${data.service}
Requirement: "${requirement}"

Domains:
${JSON.stringify(domainSummaries, null, 2)}

Workflows:
${JSON.stringify(workflowSummaries, null, 2)}

Tasks:
1. For each domain classify impact: "direct" (requirement changes behaviour IN this domain), "indirect" (downstream effect), or "none".
2. For each workflow, identify which step INDICES are on the critical path for this requirement and give a short critical-path summary.

Return ONLY valid JSON:
{
  "domainScores": {
    "<domain-id>": {
      "level": "direct" | "indirect" | "none",
      "reason": "one sentence explaining why",
      "matchedOps": ["op name"],
      "matchedKeywords": ["keyword"]
    }
  },
  "workflowImpacts": {
    "<workflow-id>": {
      "level": "direct" | "indirect" | "none",
      "affectedSteps": [0, 2, 5],
      "criticalPath": "short description of the path e.g. POST /files → FileWriter → content-event"
    }
  }
}`;

  const result = spawnSync('claude', [
    '--print',
    '--output-format', 'text',
    '--dangerously-skip-permissions',
    prompt,
  ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.error || !result.stdout) return null;

  // Extract JSON from output
  const text = result.stdout;
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch { return null; }
}

function scoreImpact(data, tfidf, requirement) {
  const reqTokens = normalise(requirement);

  // Build empty result scaffold
  const domainScores   = {};
  const workflowScores = {};

  if (reqTokens.length === 0) {
    data.domains.forEach(d => {
      domainScores[d.id] = { score: 0, rawScore: 0, level: 'none', matchedKeywords: [], matchedOps: [] };
    });
    data.workflows.forEach(wf => { workflowScores[wf.id] = 'none'; });
    return { requirement, domainScores, workflowScores };
  }

  // ── Try semantic scoring first (Claude) ──────────────────────────────────
  const semantic = semanticImpact(data, requirement);
  if (semantic?.domainScores) {
    data.domains.forEach(d => {
      const s = semantic.domainScores[d.id] || { level: 'none', reason: '', matchedOps: [], matchedKeywords: [] };
      const scoreMap = { direct: 10, indirect: 5, none: 0 };
      domainScores[d.id] = {
        score: scoreMap[s.level] ?? 0,
        level: s.level || 'none',
        reason: s.reason || '',
        matchedKeywords: s.matchedKeywords || [],
        matchedOps: s.matchedOps || [],
      };
    });

    // Workflow scores — prefer Claude's explicit workflowImpacts if present,
    // otherwise fall back to deriving from constituent domain levels
    const RANK  = { none: 0, indirect: 1, direct: 2 };
    const LABEL = ['none', 'indirect', 'direct'];
    const workflowImpacts = {};
    data.workflows.forEach(wf => {
      const wi = semantic.workflowImpacts?.[wf.id];
      if (wi) {
        workflowScores[wf.id] = wi.level || 'none';
        workflowImpacts[wf.id] = wi;
      } else {
        const maxRank = Math.max(...(wf.domains || []).map(d => RANK[domainScores[d]?.level || 'none']));
        workflowScores[wf.id] = LABEL[maxRank];
      }
    });
    return { requirement, domainScores, workflowScores, workflowImpacts, engine: 'semantic' };
  }

  // ── Fallback: TF-IDF ──────────────────────────────────────────────────────
  const rawScores = data.domains.map((d, idx) => {
    let raw = 0;
    reqTokens.forEach(token => { raw += tfidf.tfidf(token, idx); });
    const words = requirement.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matchedKeywords = (d.keywords   || []).filter(k => words.some(w => k.includes(w) || w.includes(k)));
    const matchedOps      = (d.operations || []).filter(op => words.some(w => op.toLowerCase().includes(w)));
    return { id: d.id, raw, matchedKeywords, matchedOps };
  });

  const maxRaw = Math.max(...rawScores.map(r => r.raw));
  const MIN_SIGNAL = maxRaw * 0.05;

  rawScores.forEach(({ id, raw, matchedKeywords, matchedOps }) => {
    const normalised = maxRaw > 0 ? (raw / maxRaw) * 10 : 0;
    domainScores[id] = {
      score:    Math.round(normalised * 100) / 100,
      rawScore: Math.round(raw * 1000) / 1000,
      level:    (raw < MIN_SIGNAL || normalised < 0.5) ? 'none' : normalised >= 5 ? 'direct' : 'indirect',
      matchedKeywords,
      matchedOps,
    };
  });

  const RANK  = { none: 0, indirect: 1, direct: 2 };
  const LABEL = ['none', 'indirect', 'direct'];
  data.workflows.forEach(wf => {
    const maxRank = Math.max(...(wf.domains || []).map(d => RANK[domainScores[d]?.level || 'none']));
    workflowScores[wf.id] = LABEL[maxRank];
  });

  return { requirement, domainScores, workflowScores };
}

// ── Async job store ───────────────────────────────────────────────────────────
// jobs: Map<jobId, { status, logs[], service, error }>
const jobs = new Map();

function runAnalysisJob(jobId, dir, out, onFinish) {
  const job = { status: 'running', logs: [], service: out || path.basename(dir), error: null };
  jobs.set(jobId, job);

  const scriptPath = path.join(__dirname, 'scripts', 'analyze-service.js');
  const args = ['--dir', dir, ...(out ? ['--out', out] : [])];
  const child = spawn(process.execPath, [scriptPath, ...args], { cwd: __dirname });

  child.stderr.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => job.logs.push(line));
  });
  child.stdout.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => job.logs.push(line));
  });
  child.on('close', code => {
    if (code === 0) {
      job.status = 'done';
      cache.delete(job.service);
    } else {
      job.status = 'error';
      job.error  = `Process exited with code ${code}`;
    }
    if (onFinish) onFinish();
  });
  child.on('error', err => {
    job.status = 'error';
    job.error  = err.message;
    if (onFinish) onFinish();
  });
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve frontend
app.get('/', (req, res) => {
  const file = path.join(FRONTEND_DIR, 'index.html');
  fs.existsSync(file) ? res.sendFile(file) : res.status(404).send('Frontend not found');
});

// GET /api/services — list available service JSON files
app.get('/api/services', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  res.json(files.map(f => f.replace('.json', '')));
});

// PATCH /api/services/:service/domains/:domainId — persist manual domain edits to SQLite
app.patch('/api/services/:service/domains/:domainId', (req, res) => {
  const { service, domainId } = req.params;
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    return res.status(400).json({ error: 'Patch body must be a plain JSON object' });

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  sqliteDb.upsertEdit(service, domainId, patch);
  cache.delete(service);

  const fresh = loadService(service);
  res.json(fresh.data);
});

// POST /api/services/:service/domains — add a new domain (persisted in SQLite)
app.post('/api/services/:service/domains', (req, res) => {
  const { service } = req.params;
  const domain = req.body;
  if (!domain?.id || !domain?.name)
    return res.status(400).json({ error: '`id` and `name` are required' });

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  sqliteDb.upsertEdit(service, domain.id, domain);
  cache.delete(service);

  const fresh = loadService(service);
  res.json(fresh.data);
});

// DELETE /api/services/:service/domains/:domainId — hide a domain (persisted in SQLite)
app.delete('/api/services/:service/domains/:domainId', (req, res) => {
  const { service, domainId } = req.params;

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  sqliteDb.deleteEdit(service, domainId);
  cache.delete(service);

  const fresh = loadService(service);
  res.json(fresh.data);
});

// GET /api/analyze/:service — return full domain map
app.get('/api/analyze/:service', (req, res) => {
  const entry = loadService(req.params.service);
  if (!entry) return res.status(404).json({ error: 'Service not found' });
  res.json(entry.data);
});

// POST /api/analyze-upload — { out?, files: [{path, content}] } → write to temp, spawn analyzer
app.post('/api/analyze-upload', (req, res) => {
  const { out, files } = req.body || {};
  if (!Array.isArray(files) || files.length === 0)
    return res.status(400).json({ error: 'No files provided' });

  const jobId  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // Derive service name from the first file's top-level folder segment
  const topFolder = (files[0]?.path || '').split('/')[0];
  const service   = out || topFolder || 'uploaded-service';
  const tempDir   = path.join(os.tmpdir(), `domain-compose-${jobId}`);

  try {
    // Write uploaded files into the temp directory
    for (const { path: filePath, content } of files) {
      const dest = path.join(tempDir, filePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to write temp files: ${err.message}` });
  }

  // Spawn claude-analyze.js on the temp dir, clean up when done
  const uploadJob = { status: 'running', logs: ['🚀 Spawning Claude with domain-compose skill…', `📁 Uploaded ${files.length} files`, '⏱  Expect 10–20 minutes for a full analysis.'], service, error: null };
  jobs.set(jobId, uploadJob);

  const scriptPath = path.join(__dirname, 'scripts', 'claude-analyze.js');
  const child      = spawn(process.execPath, [scriptPath, '--dir', tempDir, '--out', service], { cwd: __dirname });

  child.stderr.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => uploadJob.logs.push(l))
  );
  child.stdout.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => uploadJob.logs.push(l))
  );
  child.on('close', code => {
    fs.rm(tempDir, { recursive: true, force: true }, () => {});
    if (code === 0) { uploadJob.status = 'done'; cache.delete(service); }
    else            { uploadJob.status = 'error'; uploadJob.error = `Process exited with code ${code}`; }
  });
  child.on('error', err => { uploadJob.status = 'error'; uploadJob.error = err.message; });

  res.json({ jobId, service });
});

// POST /api/jobs — { dir, out?, maxDomains? } → spawn claude with domain-compose skill
app.post('/api/jobs', (req, res) => {
  const { dir, out, maxDomains } = req.body || {};
  if (!dir) return res.status(400).json({ error: '`dir` is required' });
  if (!fs.existsSync(dir)) return res.status(400).json({ error: `Directory not found: ${dir}` });

  const jobId   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const service = out || path.basename(dir);
  const domainNote = maxDomains ? ` · max ${maxDomains} domains` : '';
  const job     = { status: 'running', logs: ['🚀 Spawning Claude with domain-compose skill…', `📁 Directory: ${dir}${domainNote}`, '⏱  Expect 10–20 minutes for a full analysis.'], service, error: null };
  jobs.set(jobId, job);

  const scriptPath = path.join(__dirname, 'scripts', 'claude-analyze.js');
  const scriptArgs = [
    '--dir', dir,
    ...(out ? ['--out', out] : []),
    ...(maxDomains ? ['--max-domains', String(maxDomains)] : []),
  ];
  const child      = spawn(process.execPath, [scriptPath, ...scriptArgs], { cwd: __dirname });

  child.stderr.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => job.logs.push(l))
  );
  child.stdout.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => job.logs.push(l))
  );
  child.on('close', code => {
    if (code === 0) { job.status = 'done'; cache.delete(service); }
    else            { job.status = 'error'; job.error = `Process exited with code ${code}`; }
  });
  child.on('error', err => { job.status = 'error'; job.error = err.message; });

  res.json({ jobId, service });
});

// POST /api/discover — { url?, alias?, out?, maxDomains? } → spawn claude with domain-compose skill
// Accepts a GitHub URL or a Seismic service alias (alias is legacy; prefer url).
app.post('/api/discover', (req, res) => {
  const { url, alias, out, maxDomains } = req.body || {};
  if (!url && !alias) return res.status(400).json({ error: '`url` or `alias` is required' });

  const jobId   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // Derive service name: explicit out > last URL path segment > alias
  const service = out || (url
    ? url.replace(/\.git$/, '').split('/').filter(Boolean).pop()
    : alias);
  const domainNote = maxDomains ? ` · max ${maxDomains} domains` : '';
  const inputNote  = url ? `🔗 URL: ${url}` : `📋 Service: ${service}`;
  const job     = { status: 'running', logs: ['🚀 Spawning Claude with domain-compose skill…', inputNote + domainNote, '⏱  Expect 10–20 minutes for a full analysis.'], service, error: null };
  jobs.set(jobId, job);

  const scriptPath = path.join(__dirname, 'scripts', 'claude-analyze.js');
  const inputArgs  = url ? ['--url', url] : ['--alias', alias];
  const scriptArgs = [
    ...inputArgs,
    ...(out ? ['--out', out] : []),
    ...(maxDomains ? ['--max-domains', String(maxDomains)] : []),
  ];
  const child      = spawn(process.execPath, [scriptPath, ...scriptArgs], { cwd: __dirname });

  child.stderr.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => job.logs.push(l))
  );
  child.stdout.on('data', chunk =>
    chunk.toString().split('\n').filter(Boolean).forEach(l => job.logs.push(l))
  );
  child.on('close', code => {
    if (code === 0) { job.status = 'done'; cache.delete(service); }
    else            { job.status = 'error'; job.error = `Process exited with code ${code}`; }
  });
  child.on('error', err => { job.status = 'error'; job.error = err.message; });

  res.json({ jobId, service });
});

// GET /api/jobs/:id — poll for job status + logs
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, logs: job.logs, service: job.service, error: job.error });
});

// POST /api/impact — { service, requirement } → TF-IDF impact scores
app.post('/api/impact', (req, res) => {
  const { service, requirement } = req.body || {};
  if (!service) return res.status(400).json({ error: '`service` is required' });

  const entry = loadService(service);
  if (!entry) return res.status(404).json({ error: 'Service not found' });

  res.json(scoreImpact(entry.data, entry.tfidf, requirement || ''));
});

// ── Start ─────────────────────────────────────────────────────────────────────
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`  Open manually: ${url}`); });
}

const APP_URL = `http://localhost:${PORT}`;
app.listen(PORT, () => {
  console.log(`\n✅  DomainCompose Studio`);
  console.log(`   App  →  ${APP_URL}`);
  console.log(`   API  →  ${APP_URL}/api\n`);
  setTimeout(() => openBrowser(APP_URL), 500);
});
