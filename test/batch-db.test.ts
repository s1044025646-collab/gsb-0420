import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBatch, MAX_BATCH } from '../src/batch.js';
import { Store } from '../src/db.js';
import { AppError } from '../src/errors.js';
import type { CheckInput } from '../src/contrast.js';

test('批量：保留输入顺序、逐条独立诊断、非法项不写成通过', () => {
  const items: CheckInput[] = [
    { id: 'a', foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' },
    { id: 'b', foreground: 'ZZZZZZ', background: 'FFFFFF', canvas: 'FFFFFF' },
    { id: 'c', foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFFFF' },
    { id: 'd', foreground: '00000000', background: '7F7F7F', canvas: 'FFFFFF' },
  ];
  const out = checkBatch(items);
  assert.equal(out.total, 4);
  assert.equal(out.invalid, 2);
  assert.deepEqual(
    out.results.map((r) => r.id),
    ['a', 'd'],
  );
  assert.deepEqual(
    out.diagnostics.map((d) => d.id),
    ['b', 'c'],
  );
  assert.equal(out.diagnostics[0]!.code, 'COLOR_INVALID_CHAR');
  assert.equal(out.diagnostics[1]!.code, 'CANVAS_NOT_OPAQUE');
  const d = out.results.find((r) => r.id === 'd')!;
  assert.equal(d.status, 'fail');
  assert.ok(Math.abs(d.contrastRatio - 1) < 1e-12);
});

test('批量：缺省时使用稳定编号（从 1 起），空数组与超限被拒绝', () => {
  const out = checkBatch([
    { foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' },
    { foreground: 'FFFFFF', background: '000000', canvas: '000000' },
  ]);
  assert.deepEqual(
    out.results.map((r) => r.id),
    [1, 2],
  );
  assert.throws(() => checkBatch([]), (e: unknown) => e instanceof AppError && e.code === 'BATCH_EMPTY');
  assert.throws(
    () => checkBatch(Array.from({ length: MAX_BATCH + 1 }, () => ({ foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' }))),
    (e: unknown) => e instanceof AppError && e.code === 'BATCH_LIMIT_EXCEEDED',
  );
});

const dbFile = join(tmpdir(), `wcag-test-${process.pid}-${Date.now()}.db`);
let store: Store;

before(() => {
  store = new Store(dbFile);
});

after(() => {
  store.close();
  rmSync(dbFile, { force: true });
});

test('SQLite：改色产生新版本、同色复用、历史判定不被替换，且持久化原始值与公式版本', () => {
  const base = { foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF', category: 'normal' as const };
  const s1 = store.saveVersion('theme-x', base);
  assert.equal(s1.isNewVersion, true);
  assert.equal(s1.record.version, 1);
  const s1again = store.saveVersion('theme-x', base);
  assert.equal(s1again.isNewVersion, false);
  const s2 = store.saveVersion('theme-x', { ...base, foreground: '747474' });
  assert.equal(s2.record.version, 2);
  assert.equal(s2.changedFrom, 1);

  const v1 = store.getVersion('theme-x', 1)!;
  assert.equal(v1.foreground, '000000');
  assert.ok(v1.ratio >= 20);
  assert.match(v1.formula_version, /WCAG21/);

  const cmp = store.compareVersions('theme-x', 1, 2)!;
  assert.ok(cmp.ratioDelta < 0);
  assert.equal(store.listVersions('theme-x').length, 2);
});

test('SQLite：重新打开数据库后数据仍可读', () => {
  store.close();
  const reopened = new Store(dbFile);
  const palettes = reopened.listPalettes();
  assert.ok(palettes.some((p) => p.palette_name === 'theme-x' && p.versions === 2));
  assert.equal(reopened.getVersion('theme-x', 1)!.foreground, '000000');
  reopened.close();
  store = new Store(dbFile);
});
