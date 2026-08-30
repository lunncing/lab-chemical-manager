import type { DatabaseSync } from 'node:sqlite';

const chemicalsColumns = 'id,name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,discard_reason,version,created_at,updated_at';
const inboundRequestColumns = 'id,requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,decision_comment,chemical_id,version,created_at,updated_at,decided_at,withdrawn_at';

function acidCabinetConstraintPresent(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, '').toUpperCase();
  return normalized.includes("CHECK(CABINETIN('A','B','C'))")
    && normalized.includes("(CABINET='C'ANDSHELF=1)");
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql: string } | undefined;
  if (!row?.sql) throw new Error(`acid cabinet migration: missing ${table} table`);
  return row.sql;
}

function foreignKeyViolations(db: DatabaseSync): Array<Record<string, unknown>> {
  return db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
}

export function migrateAcidCabinetTables(db: DatabaseSync): boolean {
  const chemicalsSql = tableSql(db, 'chemicals');
  const inboundSql = tableSql(db, 'inbound_requests');
  if (acidCabinetConstraintPresent(chemicalsSql) && acidCabinetConstraintPresent(inboundSql)) return false;

  const indexRows = db.prepare(`SELECT name,sql FROM sqlite_master
    WHERE type='index' AND tbl_name IN ('chemicals','inbound_requests') AND sql IS NOT NULL ORDER BY name`).all() as Array<{ name: string; sql: string }>;
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    if (foreignKeys.foreign_keys !== 0) throw new Error('acid cabinet migration: could not disable foreign keys');
    db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
    db.exec(`
      DROP TABLE IF EXISTS chemicals_v15_new;
      DROP TABLE IF EXISTS inbound_requests_v15_new;
      CREATE TABLE chemicals_v15_new (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, specification TEXT NOT NULL,
        owner_id INTEGER NOT NULL REFERENCES users(id), inbound_operator_id INTEGER NOT NULL REFERENCES users(id),
        inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')),
        shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)),
        status TEXT NOT NULL CHECK(status IN ('active','discarded')), discard_reason TEXT,
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE inbound_requests_v15_new (
        id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, specification TEXT NOT NULL, inbound_at TEXT NOT NULL,
        cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')),
        shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)),
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')) DEFAULT 'pending',
        decision_comment TEXT, chemical_id INTEGER REFERENCES chemicals(id), version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT
      );
      INSERT INTO chemicals_v15_new (${chemicalsColumns}) SELECT ${chemicalsColumns} FROM chemicals;
      INSERT INTO inbound_requests_v15_new (${inboundRequestColumns}) SELECT ${inboundRequestColumns} FROM inbound_requests;
      DROP TABLE inbound_requests;
      DROP TABLE chemicals;
      ALTER TABLE chemicals_v15_new RENAME TO chemicals;
      ALTER TABLE inbound_requests_v15_new RENAME TO inbound_requests;
    `);
    for (const index of indexRows) db.exec(index.sql);
    const pendingViolations = foreignKeyViolations(db);
    if (pendingViolations.length) throw new Error(`acid cabinet migration: foreign key check failed (${pendingViolations.length})`);
    db.exec('COMMIT'); transactionOpen = false;
    db.exec('PRAGMA foreign_keys=ON');
    const committedViolations = foreignKeyViolations(db);
    if (committedViolations.length) throw new Error(`acid cabinet migration: foreign key check failed after commit (${committedViolations.length})`);
    return true;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch { /* retain the original migration error */ }
    }
    try { db.exec('PRAGMA foreign_keys=ON'); } catch { /* retain the original migration error */ }
    throw error;
  }
}
