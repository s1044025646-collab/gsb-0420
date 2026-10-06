import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FORMULA_VERSION, checkContrast, type CheckInput, type TextCategory } from './contrast.js';

export interface PaletteRecord {
  id: number;
  palette_name: string;
  version: number;
  foreground: string;
  background: string;
  canvas: string;
  category: TextCategory;
  formula_version: string;
  ratio: number;
  result_json: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS palette_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        palette_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        foreground TEXT NOT NULL,
        background TEXT NOT NULL,
        canvas TEXT NOT NULL,
        category TEXT NOT NULL,
        formula_version TEXT NOT NULL,
        ratio REAL NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (palette_name, version)
      );
      CREATE INDEX IF NOT EXISTS idx_palette_name ON palette_versions(palette_name);
    `);
  }

  /** 保存一次核验为命名配色的新版本；颜色变化自动产生新版本，历史不被覆盖。 */
  saveVersion(
    name: string,
    input: CheckInput,
  ): { record: PaletteRecord; isNewVersion: boolean; changedFrom: number | null } {
    const result = checkContrast(input);
    const latest = this.getLatest(name);
    if (
      latest &&
      latest.foreground === input.foreground &&
      latest.background === input.background &&
      latest.canvas === input.canvas &&
      latest.category === result.category
    ) {
      return { record: latest, isNewVersion: false, changedFrom: null };
    }
    const version = latest ? latest.version + 1 : 1;
    this.db
      .prepare(
        `INSERT INTO palette_versions
          (palette_name, version, foreground, background, canvas, category, formula_version, ratio, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        version,
        input.foreground,
        input.background,
        input.canvas,
        result.category,
        FORMULA_VERSION,
        result.contrastRatio,
        JSON.stringify(result),
      );
    return {
      record: this.getVersion(name, version) as PaletteRecord,
      isNewVersion: true,
      changedFrom: latest ? latest.version : null,
    };
  }

  getLatest(name: string): PaletteRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM palette_versions WHERE palette_name = ? ORDER BY version DESC LIMIT 1')
        .get(name) as PaletteRecord | undefined) ?? null
    );
  }

  getVersion(name: string, version: number): PaletteRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM palette_versions WHERE palette_name = ? AND version = ?')
        .get(name, version) as PaletteRecord | undefined) ?? null
    );
  }

  listVersions(name: string): PaletteRecord[] {
    return this.db
      .prepare('SELECT * FROM palette_versions WHERE palette_name = ? ORDER BY version ASC')
      .all(name) as unknown as PaletteRecord[];
  }

  listPalettes(): Array<{ palette_name: string; latest_version: number; versions: number }> {
    return this.db
      .prepare(
        `SELECT palette_name, MAX(version) AS latest_version, COUNT(*) AS versions
         FROM palette_versions GROUP BY palette_name ORDER BY palette_name ASC`,
      )
      .all() as unknown as Array<{ palette_name: string; latest_version: number; versions: number }>;
  }

  /** 比较同一配色的两个版本，返回原始比值与差异（用历史保存值，不重算覆盖判定）。 */
  compareVersions(
    name: string,
    vA: number,
    vB: number,
  ): { a: PaletteRecord; b: PaletteRecord; ratioDelta: number } | null {
    const a = this.getVersion(name, vA);
    const b = this.getVersion(name, vB);
    if (!a || !b) return null;
    return { a, b, ratioDelta: b.ratio - a.ratio };
  }

  close(): void {
    this.db.close();
  }
}
