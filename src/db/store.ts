import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FORMULA_VERSION, TextCategory } from '../core/color';
import { CheckReport } from '../core/check';

/**
 * SQLite 存储层。
 * 保存原始色值、文本类别、公式版本与结果；采用命名集合 + 版本模型。
 * 修改颜色会新建版本行，历史判定不被当前主题替换。
 */

export interface VersionRow {
  id: number;
  palette: string;
  version: number;
  name: string;
  foreground: string;
  background: string;
  canvas: string;
  category: TextCategory;
  formula_version: string;
  report_json: string;
  created_at: string;
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        palette TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        foreground TEXT NOT NULL,
        background TEXT NOT NULL,
        canvas TEXT NOT NULL,
        category TEXT NOT NULL,
        formula_version TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(palette, version)
      );
      CREATE INDEX IF NOT EXISTS idx_versions_palette ON versions(palette, version);
    `);
  }

  /** 保存一条已核验报告，返回新版本号与稳定记录 id。 */
  saveVersion(
    palette: string,
    name: string,
    colors: { foreground: string; background: string; canvas: string; category: TextCategory },
    report: CheckReport,
  ): { id: number; version: number } {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM versions WHERE palette = ?')
      .get(palette) as { v: number };
    const version = row.v + 1;
    const info = this.db
      .prepare(
        `INSERT INTO versions
          (palette, version, name, foreground, background, canvas, category, formula_version, report_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        palette,
        version,
        name,
        colors.foreground,
        colors.background,
        colors.canvas,
        colors.category,
        FORMULA_VERSION,
        JSON.stringify(report),
      );
    return { id: Number(info.lastInsertRowid), version };
  }

  getVersion(palette: string, version: number): VersionRow | undefined {
    return this.db
      .prepare('SELECT * FROM versions WHERE palette = ? AND version = ?')
      .get(palette, version) as VersionRow | undefined;
  }

  latestVersion(palette: string): VersionRow | undefined {
    return this.db
      .prepare('SELECT * FROM versions WHERE palette = ? ORDER BY version DESC LIMIT 1')
      .get(palette) as VersionRow | undefined;
  }

  listVersions(palette?: string): VersionRow[] {
    if (palette) {
      return this.db
        .prepare('SELECT * FROM versions WHERE palette = ? ORDER BY palette, version')
        .all(palette) as unknown as VersionRow[];
    }
    return this.db
      .prepare('SELECT * FROM versions ORDER BY palette, version')
      .all() as unknown as VersionRow[];
  }

  listPalettes(): { palette: string; versions: number; latest: number }[] {
    return this.db
      .prepare(
        `SELECT palette, COUNT(*) AS versions, MAX(version) AS latest
         FROM versions GROUP BY palette ORDER BY palette`,
      )
      .all() as { palette: string; versions: number; latest: number }[];
  }

  close(): void {
    this.db.close();
  }
}
