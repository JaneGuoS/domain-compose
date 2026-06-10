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
 * Merge SQLite edits into the given domains array:
 *  - Domains in JSON:      use patch from SQLite if present (shallow merge patch wins)
 *  - Domains deleted:      omit from result
 *  - Domains only in DB:   append to result (user-added domains)
 */
function applyEdits(service, domains) {
  const edits = getEdits(service);
  if (edits.size === 0) return domains;

  const jsonIds = new Set(domains.map(d => d.id));
  const result  = [];

  for (const domain of domains) {
    const edit = edits.get(domain.id);
    if (!edit) {
      // Not touched — use as-is
      result.push(domain);
    } else if (!edit.deleted) {
      // Patch wins for every key present in the stored patch
      result.push({ ...domain, ...edit.data });
    }
    // deleted → skip
  }

  // Append user-added domains (exist in SQLite but not in the JSON file)
  for (const [domainId, edit] of edits) {
    if (!edit.deleted && !jsonIds.has(domainId)) {
      result.push(edit.data);
    }
  }

  return result;
}

module.exports = { getEdits, upsertEdit, deleteEdit, applyEdits };
