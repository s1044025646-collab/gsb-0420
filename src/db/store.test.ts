import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store';
import { checkColors } from '../core/check';
import { compareVersions } from '../core/versions';

function tempStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'wcag-'));
  return new Store(join(dir, 'test.sqlite'));
}

test('保存产生新版本，历史版本不被替换', () => {
  const store = tempStore();
  const r1 = checkColors({ foreground: '000000', background: 'ffffff', canvas: 'ffffff' });
  assert.ok(r1.ok);
  store.saveVersion('theme', 'n', { foreground: '000000', background: 'ffffff', canvas: 'ffffff', category: 'normal' }, r1);

  const r2 = checkColors({ foreground: '777777', background: 'ffffff', canvas: 'ffffff' });
  assert.ok(r2.ok);
  store.saveVersion('theme', 'n', { foreground: '777777', background: 'ffffff', canvas: 'ffffff', category: 'normal' }, r2);

  const rows = store.listVersions('theme');
  assert.equal(rows.length, 2);
  // v1 历史判定仍保留原始颜色与 21
  const v1 = store.getVersion('theme', 1)!;
  assert.equal(v1.foreground, '000000');
  assert.equal((JSON.parse(v1.report_json) as { contrastRatio: number }).contrastRatio, 21);

  const cmp = compareVersions(rows[0], rows[1]);
  assert.equal(cmp.colorsChanged.foreground, true);
  assert.notEqual(cmp.ratioDelta, 0);
  store.close();
});

test('重启后数据可读（重新打开同一文件）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcag-'));
  const path = join(dir, 'persist.sqlite');
  const s1 = new Store(path);
  const r = checkColors({ foreground: '000000', background: 'ffffff', canvas: 'ffffff' });
  assert.ok(r.ok);
  s1.saveVersion('p', 'n', { foreground: '000000', background: 'ffffff', canvas: 'ffffff', category: 'normal' }, r);
  s1.close();

  const s2 = new Store(path);
  assert.equal(s2.listVersions('p').length, 1);
  assert.equal(s2.latestVersion('p')!.foreground, '000000');
  s2.close();
});
