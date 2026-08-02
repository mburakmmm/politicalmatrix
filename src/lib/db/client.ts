import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const GLOBAL_KEY = "__politicalmatrix_db__";

type GlobalWithDb = typeof globalThis & {
  [GLOBAL_KEY]?: Database.Database;
};

function resolveDbPath(): string {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  return path.join(process.cwd(), "data", "politicalmatrix.sqlite");
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>
    ).map((r) => r.version)
  );

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = Number(match[1]);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version) VALUES (?)"
      ).run(version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function getDb(): Database.Database {
  const g = globalThis as GlobalWithDb;
  if (g[GLOBAL_KEY]) {
    return g[GLOBAL_KEY]!;
  }

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);

  g[GLOBAL_KEY] = db;
  return db;
}

export function getSetting(key: string, fallback = ""): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}
