'use strict';
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { exec } = require('child_process');
const natural  = require('natural');

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

  // Compute raw TF-IDF scores
  const rawScores = data.domains.map((d, idx) => {
    let raw = 0;
    reqTokens.forEach(token => { raw += tfidf.tfidf(token, idx); });

    // Preserve original keyword/op highlights for the UI
    const words = requirement.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matchedKeywords = (d.keywords   || []).filter(k => words.some(w => k.includes(w) || w.includes(k)));
    const matchedOps      = (d.operations || []).filter(op => words.some(w => op.toLowerCase().includes(w)));

    return { id: d.id, raw, matchedKeywords, matchedOps };
  });

  const maxRaw = Math.max(...rawScores.map(r => r.raw));
  // Minimum absolute score to be considered at all (prevents noise from generic queries)
  const MIN_SIGNAL = maxRaw * 0.05;

  rawScores.forEach(({ id, raw, matchedKeywords, matchedOps }) => {
    const normalised = maxRaw > 0 ? (raw / maxRaw) * 10 : 0;
    let level;
    if (raw < MIN_SIGNAL || normalised < 0.5) {
      level = 'none';
    } else if (normalised >= 5) {
      level = 'direct';
    } else {
      level = 'indirect';
    }

    domainScores[id] = {
      score:           Math.round(normalised * 100) / 100,
      rawScore:        Math.round(raw * 1000) / 1000,
      level,
      matchedKeywords,
      matchedOps,
    };
  });

  // Workflow level = highest level of its constituent domains
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

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve compiled frontend (if present)
app.get('/', (req, res) => {
  const file = path.join(FRONTEND_DIR, 'index.html');
  fs.existsSync(file) ? res.sendFile(file) : res.status(404).send('Frontend not found');
});

// GET /api/services — list available service JSON files
app.get('/api/services', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  res.json(files.map(f => f.replace('.json', '')));
});

// GET /api/analyze/:service — return full domain map
app.get('/api/analyze/:service', (req, res) => {
  const entry = loadService(req.params.service);
  if (!entry) return res.status(404).json({ error: 'Service not found' });
  res.json(entry.data);
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
