import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor,
  sourceOver,
  srgbChannelToLinear,
  relativeLuminance,
  contrastRatio,
  evaluateComposite,
  ColorParseError,
} from './color';

test('解析大小写十六进制与 alpha', () => {
  assert.deepEqual(parseColor('ffFFff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseColor('000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(parseColor('00000000').a, 0);
  assert.equal(parseColor('000000FF').a, 1);
  assert.equal(parseColor('ffffff80').a, 128 / 255);
});

test('非法字符与不支持的长度被拒绝', () => {
  assert.throws(() => parseColor('GGGGGG'), ColorParseError);
  assert.throws(() => parseColor('fff'), ColorParseError);
  assert.throws(() => parseColor('fffffffff'), ColorParseError);
  assert.throws(() => parseColor('12345'), ColorParseError);
});

test('画布不允许含透明度', () => {
  assert.throws(
    () => parseColor('ffffff80', 'canvas', true),
    (e: unknown) => e instanceof ColorParseError && e.code === 'CANVAS_NOT_OPAQUE',
  );
  assert.doesNotThrow(() => parseColor('ffffff', 'canvas', true));
});

test('source-over 在编码通道上的手算值', () => {
  // 白 alpha=0.5 叠到纯绿(0, 102/255, 0)
  const out = sourceOver({ r: 1, g: 1, b: 1, a: 0.5 }, { r: 0, g: 102 / 255, b: 0, a: 1 });
  assert.ok(Math.abs(out.r - 0.5) < 1e-12);
  assert.ok(Math.abs(out.g - (0.5 + 0.5 * (102 / 255))) < 1e-12);
  assert.ok(Math.abs(out.b - 0.5) < 1e-12);
  assert.equal(out.a, 1);
});

test('sRGB->线性 公开公式的边界手算', () => {
  assert.equal(srgbChannelToLinear(0), 0);
  assert.equal(srgbChannelToLinear(1), 1);
  // c <= 0.04045 走线性段
  assert.ok(Math.abs(srgbChannelToLinear(0.04045) - 0.04045 / 12.92) < 1e-15);
  // 0.5 的独立手算：((0.5+0.055)/1.055)^2.4 ≈ 0.214041140...
  const v = srgbChannelToLinear(0.5);
  assert.ok(Math.abs(v - 0.21404114048223255) < 1e-9, `got ${v}`);
});

test('相对亮度手算：白=1 黑=0', () => {
  assert.equal(relativeLuminance({ r: 1, g: 1, b: 1, a: 1 }), 1);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 }), 0);
});

test('黑/白对比度 21，同色 1', () => {
  assert.equal(contrastRatio(0, 1), 21);
  assert.equal(contrastRatio(0.4, 0.4), 1);
});

test('完整叠色：透明文字与背景相同 -> 1:1', () => {
  const r = evaluateComposite({ foreground: '00000000', background: 'ffffff', canvas: 'ffffff' });
  assert.ok(Math.abs(r.ratio - 1) < 1e-12);
  assert.ok(Math.abs(r.finalForeground.r - 1) < 1e-12);
});

test('半透明黑字(80%)落白底的独立手算 ≈ 12.64，且小于不透明黑的 21', () => {
  const semi = evaluateComposite({ foreground: '000000cc', background: 'ffffff', canvas: 'ffffff' });
  const alpha = 204 / 255;
  const channel = 1 - alpha; // =0.2
  const linear = Math.pow((channel + 0.055) / 1.055, 2.4);
  const expected = (1 + 0.05) / (linear + 0.05);
  assert.ok(Math.abs(semi.ratio - expected) < 1e-12);
  assert.ok(semi.ratio < 21);
  assert.ok(semi.ratio > 12 && semi.ratio < 13);
});

test('透明背景先叠画布再叠前景的顺序（两步）', () => {
  // bg 白 alpha=127/255 over 绿画布 -> (a, a+(1-a)*102/255, a)；前景不透明黑 -> 黑
  const a = 127 / 255;
  const r = evaluateComposite({ foreground: '000000', background: 'ffffff7f', canvas: '006600' });
  assert.ok(Math.abs(r.finalBackground.r - a) < 1e-12);
  assert.ok(Math.abs(r.finalBackground.g - (a + (1 - a) * (102 / 255))) < 1e-12);
  assert.ok(Math.abs(r.finalBackground.b - a) < 1e-12);
  assert.ok(Math.abs(r.finalForeground.r - 0) < 1e-12);
  assert.equal(r.steps.length, 2);
});

test('不同画布改变半透明结果', () => {
  const onWhite = evaluateComposite({ foreground: '00000080', background: 'ffffff80', canvas: 'ffffff' });
  const onBlack = evaluateComposite({ foreground: '00000080', background: 'ffffff80', canvas: '000000' });
  assert.notEqual(onWhite.ratio, onBlack.ratio);
});

test('不透明交换前后景比值不变；透明交换一般改变', () => {
  const a = evaluateComposite({ foreground: '112233', background: 'aabbcc', canvas: 'ffffff' });
  const b = evaluateComposite({ foreground: 'aabbcc', background: '112233', canvas: 'ffffff' });
  assert.ok(Math.abs(a.ratio - b.ratio) < 1e-12);

  // 在非白画布上，半透明层交换一般改变结果
  const c = evaluateComposite({ foreground: '11223380', background: 'aabbcc', canvas: '006600' });
  const d = evaluateComposite({ foreground: 'aabbcc', background: '11223380', canvas: '006600' });
  assert.notEqual(c.ratio, d.ratio);
});
