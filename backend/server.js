'use strict';
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { exec } = require('child_process');
const natural  = require('natural');
const db       = require('./db');

const DATA_DIR     = path.join(__dirname, 'data');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
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

function normalise(text) {
  return tokenizer.tokenize(text.toLowerCase())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .map(w => stemmer.stem(w));
}

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

// ── Corpus cache ──────────────────────────────────────────────────────────────
const cache = new Map(); // serviceName → { data, tfidf, domainIndex }

function buildCache(name, baseData, domains) {
  const data = { ...baseData, domains };
  const tfidf = new natural.TfIdf();
  domains.forEach(d => tfidf.addDocument(normalise(domainText(d))));
  const domainIndex = Object.fromEntries(domains.map((d, i) => [d.id, i]));
  cache.set(name, { data, tfidf, domainIndex });
  return cache.get(name);
}

function loadService(name) {
  if (cache.has(name)) return cache.get(name);

  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;

  const baseData = JSON.parse(fs.readFileSync(file, 'utf8'));
  const domains  = db.getDomains(name); // seeded from JSON on first call
  return buildCache(name, baseData, domains);
}

// ── Impact scoring ────────────────────────────────────────────────────────────
function scoreImpact(data, tfidf, requirement) {
  const reqTokens    = normalise(requirement);
  const domainScores = {};
  const workflowScores = {};

  if (reqTokens.length === 0) {
    data.domains.forEach(d => {
      domainScores[d.id] = { score: 0, rawScore: 0, level: 'none', matchedKeywords: [], matchedOps: [] };
    });
    data.workflows.forEach(wf => { workflowScores[wf.id] = 'none'; });
    return { requirement, domainScores, workflowScores };
  }

  const rawScores = data.domains.map((d, idx) => {
    let raw = 0;
    reqTokens.forEach(token => { raw += tfidf.tfidf(token, idx); });
    const words = requirement.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matchedKeywords = (d.keywords   || []).filter(k => words.some(w => k.includes(w) || w.includes(k)));
    const matchedOps      = (d.operations || []).filter(op => words.some(w => op.toLowerCase().includes(w)));
    return { id: d.id, raw, matchedKeywords, matchedOps };
  });

  const maxRaw   = Math.max(...rawScores.map(r => r.raw));
  const MIN_SIGNAL = maxRaw * 0.05;

  rawScores.forEach(({ id, raw, matchedKeywords, matchedOps }) => {
    const normalised = maxRaw > 0 ? (raw / maxRaw) * 10 : 0;
    const level = (raw < MIN_SIGNAL || normalised < 0.5) ? 'none'
                : normalised >= 5 ? 'direct' : 'indirect';
    domainScores[id] = {
      score: Math.round(normalised * 100) / 100,
      rawScore: Math.round(raw * 1000) / 1000,
      level, matchedKeywords, matchedOps,
    };
  });

  const RANK  = { none: 0, indirect: 1, direct: 2 };
  const LABEL = ['none', 'indirect', 'direct'];
  data.workflows.forEach(wf => {
    const maxRank = Math.max(...wf.domains.map(d => RANK[domainScores[d]?.level || 'none']));
    workflowScores[wf.id] = LABEL[maxRank];
  });

  return { requirement, domainScores, workflowScores };
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// In dev, redirect to Vite dev server. In prod, serve the compiled build.
app.get('/', (req, res) => {
  const built = path.join(FRONTEND_DIR, 'dist', 'index.html');
  if (fs.existsSync(built)) return res.sendFile(built);
  res.redirect('http://localhost:3000');
});

// GET /api/services
app.get('/api/services', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  res.json(files.map(f => f.replace('.json', '')));
});

// GET /api/analyze/:service
app.get('/api/analyze/:service', (req, res) => {
  const entry = loadService(req.params.service);
  if (!entry) return res.status(404).json({ error: 'Service not found' });
  res.json(entry.data);
});

// PATCH /api/services/:service/domains/:domainId — update existing domain
app.patch('/api/services/:service/domains/:domainId', (req, res) => {
  const { service, domainId } = req.params;
  const domain = req.body;
  if (!domain || domain.id !== domainId) return res.status(400).json({ error: 'Invalid domain payload' });

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  db.upsertDomain(service, domain);
  cache.delete(service);
  res.json(domain);
});

// POST /api/services/:service/domains — add new domain
app.post('/api/services/:service/domains', (req, res) => {
  const { service } = req.params;
  const domain = req.body;
  if (!domain?.id || !domain?.name) return res.status(400).json({ error: 'id and name are required' });

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  // Ensure service is seeded before adding so getDomains returns full list
  loadService(service);
  db.upsertDomain(service, domain);
  cache.delete(service);
  res.status(201).json(domain);
});

// DELETE /api/services/:service/domains/:domainId — soft-delete domain
app.delete('/api/services/:service/domains/:domainId', (req, res) => {
  const { service, domainId } = req.params;
  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Service not found' });

  db.deleteDomain(service, domainId);
  cache.delete(service);
  res.sendStatus(204);
});

// POST /api/impact
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

app.listen(PORT, () => {
  console.log(`\n✅  DomainCompose Studio`);
  console.log(`   App  →  http://localhost:${PORT}`);
  console.log(`   API  →  http://localhost:${PORT}/api\n`);
  setTimeout(() => openBrowser(`http://localhost:${PORT}`), 500);
});
