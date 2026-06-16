'use strict';
/**
 * SQLite layer for persisting manual domain edits.
 *
 * Schema:
 *   domain_edits(service, domain_id, deleted, data)
 *     - deleted=0, data=JSON  → edit/override for an existing domain (patch merged on top)
 *     - deleted=0, data=JSON  → new domain (id not present in base JSON)
 *     - deleted=1, data=NULL  → domain is hidden (removed by user)
 *
 * When the base JSON is overwritten by re-analysis, SQLite edits survive
 * and are re-applied on top of the fresh data.
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, 'data', 'edits.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS domain_edits (
        service   TEXT    NOT NULL,
        domain_id TEXT    NOT NULL,
        deleted   INTEGER NOT NULL DEFAULT 0,
        data      TEXT,
        PRIMARY KEY (service, domain_id)
      )
    `);
  }
  return _db;
}

/** Return a Map<domainId, {deleted, data}> for the given service. */
function getEdits(service) {
  const rows = getDb()
    .prepare('SELECT domain_id, deleted, data FROM domain_edits WHERE service = ?')
    .all(service);
  const map = new Map();
  for (const row of rows) {
    map.set(row.domain_id, {
      deleted: row.deleted === 1,
      data: row.data ? JSON.parse(row.data) : null,
    });
  }
  return map;
}

/**
 * Upsert an edit for a domain.
 * For existing domains `data` is a patch object (merged on top of base JSON).
 * For new domains `data` is the full domain object.
 */
function upsertEdit(service, domainId, data) {
  getDb()
    .prepare(`
      INSERT INTO domain_edits (service, domain_id, deleted, data)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(service, domain_id) DO UPDATE SET deleted = 0, data = excluded.data
    `)
    .run(service, domainId, JSON.stringify(data));
}

/** Mark a domain as deleted (hidden from the UI). */
function deleteEdit(service, domainId) {
  getDb()
    .prepare(`
      INSERT INTO domain_edits (service, domain_id, deleted, data)
      VALUES (?, ?, 1, NULL)
      ON CONFLICT(service, domain_id) DO UPDATE SET deleted = 1, data = NULL
    `)
    .run(service, domainId);
}

/**
 * Deep-merge `overlay` onto `base`.
 * - Nested plain objects are merged recursively (base fields not in overlay survive).
 * - Arrays and primitives: overlay wins outright.
 */
function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return overlay !== undefined ? overlay : base;
  }
  const result = { ...(base || {}) };
  for (const [k, v] of Object.entries(overlay)) {
    if (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Merge SQLite edits into the given domains array:
 *  - Domains in JSON:      deep-merge stored patch on top of fresh analysis data
 *  - Domains deleted:      omit from result
 *  - Domains only in DB:   append to result (user-added domains)
 *
 * Fallback matching: if a domain's ID changed after re-analysis but the name
 * is the same, the stored edit is applied by name so user edits survive
 * regeneration even when the analyser picks a different slug.
 */
function applyEdits(service, domains) {
  const edits = getEdits(service);
  if (edits.size === 0) return domains;

  const jsonIds = new Set(domains.map(d => d.id));

  // Name → edit lookup for fallback matching when IDs drift between re-analyses
  const editsByName = new Map();
  for (const [domainId, edit] of edits) {
    if (!edit.deleted && edit.data?.name) {
      editsByName.set(edit.data.name.toLowerCase(), { domainId, edit });
    }
  }

  const mergedEditIds = new Set();
  const result = [];

  for (const domain of domains) {
    let edit = edits.get(domain.id);

    // Fallback: match by name when the stored edit's original ID is no longer
    // in the new JSON (the analyser assigned a different slug).
    if (!edit && domain.name) {
      const nameMatch = editsByName.get(domain.name.toLowerCase());
      if (nameMatch && !jsonIds.has(nameMatch.domainId)) {
        edit = nameMatch.edit;
        mergedEditIds.add(nameMatch.domainId);
      }
    }

    if (!edit) {
      result.push(domain);
    } else if (!edit.deleted) {
      // Deep merge: fresh analysis base + user overrides on top
      result.push(deepMerge(domain, edit.data));
      mergedEditIds.add(domain.id);
    }
    // deleted → skip
  }

  // Append user-added domains (exist in SQLite but not in the JSON file)
  for (const [domainId, edit] of edits) {
    if (!edit.deleted && !jsonIds.has(domainId) && !mergedEditIds.has(domainId)) {
      result.push(edit.data);
    }
  }

  return result;
}

module.exports = { getEdits, upsertEdit, deleteEdit, applyEdits };
