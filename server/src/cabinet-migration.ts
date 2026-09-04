import type { DatabaseSync } from 'node:sqlite';

const chemicalsTargetColumns = 'id,name,specification,cas_number,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,discard_reason,version,created_at,updated_at';
const inboundTargetColumns = 'id,requester_id,target_user_id,name,specification,cas_number,inbound_at,cabinet,shelf,status,decision_comment,chemical_id,version,created_at,updated_at,decided_at,withdrawn_at';

function v19LocationConstraintPresent(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, '').toUpperCase();
  return normalized.includes("CHECK(CABINETIN('A','B','C1','C2','G1','G2'))")
    && normalized.includes("(CABINETIN('C1','C2','G1','G2')ANDSHELF=1)");
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql: string } | undefined;
  if (!row?.sql) throw new Error(`storage/CAS migration: missing ${table} table`);
  return row.sql;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(({ name }) => name === column);
}

function foreignKeyViolations(db: DatabaseSync): Array<Record<string, unknown>> {
  return db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
}

function integrityResult(db: DatabaseSync): string {
  return String((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
}

export function migrateStorageLocationsAndCas(db: DatabaseSync): boolean {
  const chemicalsSql = tableSql(db, 'chemicals');
  const inboundSql = tableSql(db, 'inbound_requests');
  const chemicalsHaveCas = hasColumn(db, 'chemicals', 'cas_number');
  const inboundHaveCas = hasColumn(db, 'inbound_requests', 'cas_number');
  if (chemicalsHaveCas && inboundHaveCas && v19LocationConstraintPresent(chemicalsSql) && v19LocationConstraintPresent(inboundSql)) return false;

  const indexRows = db.prepare(`SELECT name,sql FROM sqlite_master
    WHERE type='index' AND tbl_name IN ('chemicals','inbound_requests') AND sql IS NOT NULL ORDER BY name`).all() as Array<{ name: string; sql: string }>;
  const chemicalsCasSelect = chemicalsHaveCas ? 'cas_number' : 'NULL';
  const inboundCasSelect = inboundHaveCas ? 'cas_number' : 'NULL';
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    if (foreignKeys.foreign_keys !== 0) throw new Error('storage/CAS migration: could not disable foreign keys');
    db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
    db.exec(`
      DROP TABLE IF EXISTS chemicals_v19_new;
      DROP TABLE IF EXISTS inbound_requests_v19_new;
      CREATE TABLE chemicals_v19_new (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, specification TEXT NOT NULL, cas_number TEXT,
        owner_id INTEGER NOT NULL REFERENCES users(id), inbound_operator_id INTEGER NOT NULL REFERENCES users(id),
        inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C1','C2','G1','G2')),
        shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet IN ('C1','C2','G1','G2') AND shelf=1)),
        status TEXT NOT NULL CHECK(status IN ('active','discarded')), discard_reason TEXT,
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE inbound_requests_v19_new (
        id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, specification TEXT NOT NULL, cas_number TEXT, inbound_at TEXT NOT NULL,
        cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C1','C2','G1','G2')),
        shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet IN ('C1','C2','G1','G2') AND shelf=1)),
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')) DEFAULT 'pending',
        decision_comment TEXT, chemical_id INTEGER REFERENCES chemicals(id), version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT
      );
      INSERT INTO chemicals_v19_new (${chemicalsTargetColumns})
        SELECT id,name,specification,${chemicalsCasSelect},owner_id,inbound_operator_id,inbound_at,
          CASE cabinet WHEN 'C' THEN 'C1' ELSE cabinet END,shelf,status,discard_reason,version,created_at,updated_at
        FROM chemicals;
      INSERT INTO inbound_requests_v19_new (${inboundTargetColumns})
        SELECT id,requester_id,target_user_id,name,specification,${inboundCasSelect},inbound_at,
          CASE cabinet WHEN 'C' THEN 'C1' ELSE cabinet END,shelf,status,decision_comment,chemical_id,version,created_at,updated_at,decided_at,withdrawn_at
        FROM inbound_requests;
      UPDATE inventory_movements SET
        from_cabinet=CASE from_cabinet WHEN 'C' THEN 'C1' ELSE from_cabinet END,
        to_cabinet=CASE to_cabinet WHEN 'C' THEN 'C1' ELSE to_cabinet END
      WHERE from_cabinet='C' OR to_cabinet='C';
      DROP TABLE inbound_requests;
      DROP TABLE chemicals;
      ALTER TABLE chemicals_v19_new RENAME TO chemicals;
      ALTER TABLE inbound_requests_v19_new RENAME TO inbound_requests;
    `);
    for (const index of indexRows) db.exec(index.sql);
    const pendingViolations = foreignKeyViolations(db);
    if (pendingViolations.length) throw new Error(`storage/CAS migration: foreign key check failed (${pendingViolations.length})`);
    const integrity = integrityResult(db);
    if (integrity !== 'ok') throw new Error(`storage/CAS migration: integrity check failed (${integrity})`);
    db.exec('COMMIT'); transactionOpen = false;
    db.exec('PRAGMA foreign_keys=ON');
    return true;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch { /* retain the original migration error */ }
    }
    try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* retain the original migration error */ }
    throw error;
  }
}

// Kept for compatibility with existing migration verification imports.
export const migrateAcidCabinetTables = migrateStorageLocationsAndCas;
