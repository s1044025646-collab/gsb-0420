import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCriteria } from './wcag';

test('四个门槛与 >= 判定', () => {
  const r = evaluateCriteria(4.5, 'normal');
  const aa = r.results.find((c) => c.key === 'aa_normal')!;
  assert.equal(aa.pass, true);
  assert.equal(aa.difference, 0);
  assert.equal(aa.primary, true);
});

test('恰好 4.5 普通 AA 通过、AAA 失败；大文本两项均通过', () => {
  const r = evaluateCriteria(4.5, 'normal').results;
  assert.equal(r.find((c) => c.key === 'aa_normal')!.pass, true);
  assert.equal(r.find((c) => c.key === 'aaa_normal')!.pass, false);
  assert.equal(r.find((c) => c.key === 'aa_large')!.pass, true);
  assert.equal(r.find((c) => c.key === 'aaa_large')!.pass, true);
});

test('3.0 仅大文本 AA 通过', () => {
  const r = evaluateCriteria(3, 'large').results;
  assert.equal(r.find((c) => c.key === 'aa_large')!.pass, true);
  assert.equal(r.find((c) => c.key === 'aaa_large')!.pass, false);
});

test('接近但低于阈值不得因四舍五入而通过', () => {
  const ratio = 4.499999999;
  const r = evaluateCriteria(ratio, 'normal');
  assert.equal(r.primaryPass, false);
});

test('黑/白 21 全通过，同色 1 全失败', () => {
  assert.ok(evaluateCriteria(21, 'normal').results.every((c) => c.pass));
  assert.ok(evaluateCriteria(1, 'normal').results.every((c) => !c.pass));
});
