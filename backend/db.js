'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH  = path.join(__dirname, 'data', 'domains.db');
const DATA_DIR = path.join(__dirname, 'data');

const db = new Database(DB_PATH);

// Enable WAL for better read/write concurrency
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id         TEXT NOT NULL,
    service    TEXT NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '📦',
    health     TEXT NOT NULL DEFAULT 'partial',
    operations TEXT NOT NULL DEFAULT '[]',
    keywords   TEXT NOT NULL DEFAULT '[]',
    ddd_target TEXT NOT NULL DEFAULT '{}',
    deleted    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id, service)
  )
`);

const stmts = {
  countByService: db.prepare('SELECT COUNT(*) as n FROM domains WHERE service = ? AND deleted = 0'),
  insertDomain:   db.prepare(`
    INSERT OR REPLACE INTO domains (id, service, name, icon, health, operations, keywords, ddd_target)
    VALUES (@id, @service, @name, @icon, @health, @operations, @keywords, @ddd_target)
  `),
  allByService:   db.prepare('SELECT * FROM domains WHERE service = ? AND deleted = 0'),
  upsertDomain:   db.prepare(`
    INSERT INTO domains (id, service, name, icon, health, operations, keywords, ddd_target)
    VALUES (@id, @service, @name, @icon, @health, @operations, @keywords, @ddd_target)
    ON CONFLICT(id, service) DO UPDATE SET
      name       = excluded.name,
      icon       = excluded.icon,
      health     = excluded.health,
      operations = excluded.operations,
      keywords   = excluded.keywords,
      ddd_target = excluded.ddd_target,
      deleted    = 0
  `),
  softDelete:     db.prepare('UPDATE domains SET deleted = 1 WHERE id = ? AND service = ?'),
  undelete:       db.prepare('UPDATE domains SET deleted = 0 WHERE id = ? AND service = ?'),
};

function domainToRow(service, d) {
  return {
    id:         d.id,
    service,
    name:       d.name,
    icon:       d.icon ?? '📦',
    health:     d.health ?? 'partial',
    operations: JSON.stringify(d.operations ?? []),
    keywords:   JSON.stringify(d.keywords ?? []),
    ddd_target: JSON.stringify(d.dddTarget ?? {}),
  };
}

function rowToDomain(row) {
  return {
    id:         row.id,
    name:       row.name,
    icon:       row.icon,
    health:     row.health,
    operations: JSON.parse(row.operations),
    keywords:   JSON.parse(row.keywords),
    dddTarget:  JSON.parse(row.ddd_target),
  };
}

/** Seed from JSON the first time a service is accessed */
function seedIfEmpty(service) {
  const { n } = stmts.countByService.get(service);
  if (n > 0) return;

  const file = path.join(DATA_DIR, `${service}.json`);
  if (!fs.existsSync(file)) return;

  const { domains } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const insertMany = db.transaction(list => {
    for (const d of list) stmts.insertDomain.run(domainToRow(service, d));
  });
  insertMany(domains);
}

function getDomains(service) {
  seedIfEmpty(service);
  return stmts.allByService.all(service).map(rowToDomain);
}

function upsertDomain(service, domain) {
  stmts.upsertDomain.run(domainToRow(service, domain));
}

function deleteDomain(service, id) {
  stmts.softDelete.run(id, service);
}

module.exports = { getDomains, upsertDomain, deleteDomain };
