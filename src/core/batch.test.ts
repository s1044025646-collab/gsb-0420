import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBatch, filterFailures, MAX_BATCH, BatchEntry } from './batch';

test('批量保留输入顺序、独立诊断，非法项不写成通过', () => {
  const entries: BatchEntry[] = [
    { recordId: 'a', foreground: '000000', background: 'ffffff', canvas: 'ffffff' },
    { recordId: 'b', foreground: 'GGGGGG', background: 'ffffff', canvas: 'ffffff' },
    { foreground: 'ffffff', background: 'ffffff', canvas: 'ffffff' },
  ];
  const r = checkBatch(entries);
  assert.equal(r.total, 3);
  assert.equal(r.accepted, 2);
  assert.equal(r.rejected, 1);
  assert.equal(r.results[0].recordId, 'a');
  assert.equal(r.results[1].ok, false);
  assert.equal((r.results[1] as { code: string }).code, 'COLOR_INVALID_CHAR');
  assert.equal(r.results[2].recordId, 2);
});

test('超过条数上限整体拒绝', () => {
  const entries = Array.from({ length: MAX_BATCH + 1 }, () => ({
    foreground: '000000',
    background: 'ffffff',
    canvas: 'ffffff',
  }));
  const r = checkBatch(entries);
  assert.equal(r.error?.code, 'BATCH_TOO_MANY');
});

test('失败筛选：同色(1:1)被筛出，黑/白不被筛出，非法项保留', () => {
  const entries: BatchEntry[] = [
    { foreground: '000000', background: 'ffffff', canvas: 'ffffff' },
    { foreground: 'ffffff', background: 'ffffff', canvas: 'ffffff' },
    { foreground: 'zzz', background: 'ffffff', canvas: 'ffffff' },
  ];
  const r = checkBatch(entries);
  const fails = filterFailures(r, 'AA');
  assert.equal(fails.length, 2);
});
