import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContrast, srgbChannelToLinear, relativeLuminance, contrastRatio } from '../src/contrast.js';
import { parseColor } from '../src/color.js';
import { AppError } from '../src/errors.js';

test('纯黑 / 纯白：最终通道、亮度 0/1、对比度 21:1', () => {
  const r = checkContrast({ foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' });
  assert.equal(r.finalForeground.r, 0);
  assert.equal(r.finalBackground.r, 1);
  assert.equal(r.relativeLuminance.finalForeground.luminance, 0);
  assert.equal(r.relativeLuminance.finalBackground.luminance, 1);
  assert.ok(Math.abs(r.contrastRatio - 21) < 1e-12);
});

test('相同颜色：对比度 1:1，四个等级全部失败', () => {
  const r = checkContrast({ foreground: '336699', background: '336699', canvas: 'FFFFFF' });
  assert.ok(Math.abs(r.contrastRatio - 1) < 1e-12);
  assert.ok(r.levels.every((l) => !l.pass));
});

test('大小写十六进制等价', () => {
  const a = checkContrast({ foreground: 'aAbBcC', background: '000000', canvas: '000000' });
  const b = checkContrast({ foreground: 'AAbbCC', background: '000000', canvas: '000000' });
  assert.equal(a.contrastRatio, b.contrastRatio);
});

test('80% 黑字叠白底：手算通道 0.2、线性≈0.0331、对比度≈12.64，低于不透明黑的 21', () => {
  // 手算（source-over 在归一化 sRGB 编码通道）：
  //   CC = 204/255 = 0.8（精确表示）
  //   最终前景通道 = 0.8*0 + 0.2*1 = 0.2（计算保留浮点，结果为 0.19999999999999996）
  //   线性 = ((0.2+0.055)/1.055)^2.4 ≈ 0.033105（灰通道，亮度同值）
  //   对比度 = 1.05 / (0.033105+0.05) ≈ 12.63
  const r = checkContrast({ foreground: '000000CC', background: 'FFFFFF', canvas: 'FFFFFF' });
  assert.ok(Math.abs(r.finalForeground.r - 0.2) < 1e-12);
  assert.ok(Math.abs(r.finalForeground.g - 0.2) < 1e-12);
  assert.equal(r.finalForeground.a, 1);
  assert.ok(Math.abs(r.relativeLuminance.finalForeground.luminance - 0.033105) < 2e-5);
  assert.ok(Math.abs(r.contrastRatio - 12.63) < 2e-2);
  assert.ok(r.contrastRatio < 21);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0]!.step, 'foreground-over-background');
});

test('完全透明前景（alpha=00）与背景一致，对比度 1:1', () => {
  const r = checkContrast({ foreground: '00000000', background: '7F7F7F', canvas: 'FFFFFF' });
  assert.equal(r.finalForeground.r, r.finalBackground.r);
  assert.ok(Math.abs(r.contrastRatio - 1) < 1e-12);
});

test('半透明背景先叠画布：80 白叠黑画布，通道=128/255≈0.50196、线性≈0.215、对比度≈5.31', () => {
  // 80 = 128/255 = 0.5019608（精确）；最终背景通道即为该值
  // 线性 = ((0.50196+0.055)/1.055)^2.4 ≈ 0.2154
  // 黑字对比度 = (0.2154+0.05)/0.05 ≈ 5.31
  const dark = checkContrast({ foreground: '000000', background: 'FFFFFF80', canvas: '000000' });
  assert.ok(Math.abs(dark.finalBackground.r - 128 / 255) < 1e-15);
  assert.ok(Math.abs(dark.relativeLuminance.finalBackground.luminance - 0.2154) < 2e-3);
  assert.ok(Math.abs(dark.contrastRatio - 5.31) < 3e-2);

  const light = checkContrast({ foreground: '000000', background: 'FFFFFF80', canvas: 'FFFFFF' });
  assert.ok(Math.abs(light.contrastRatio - 21) < 1e-9);
  assert.ok(Math.abs(dark.contrastRatio - light.contrastRatio) > 1);
});

test('阈值附近：#747474 用未取整比值判定失败（4.49<4.5），#757575 通过；不能先四舍五入到 4.5', () => {
  const fail = checkContrast({ foreground: '000000', background: '747474', canvas: '747474' });
  const pass = checkContrast({ foreground: '000000', background: '757575', canvas: '757575' });
  const aaNormalFail = fail.levels.find((l) => l.level === 'AA' && l.textType === 'normal')!;
  const aaNormalPass = pass.levels.find((l) => l.level === 'AA' && l.textType === 'normal')!;
  assert.ok(fail.contrastRatio < 4.5);
  assert.ok(fail.contrastRatio > 4.4);
  assert.equal(aaNormalFail.pass, false);
  assert.ok(pass.contrastRatio > 4.5);
  assert.equal(aaNormalPass.pass, true);
  assert.equal(fail.primaryVerdict.pass, false);
});

test('大文本类别必须由调用者明确给出，服务不猜测', () => {
  const r = checkContrast({ foreground: '000000', background: '747474', canvas: '747474', category: 'large' });
  assert.equal(r.category, 'large');
  assert.equal(r.primaryVerdict.threshold, 3);
  assert.equal(r.primaryVerdict.pass, true);
  assert.throws(
    () => checkContrast({ foreground: '000000', background: '747474', canvas: '747474', category: 'bold-24px' as never }),
    (e: unknown) => e instanceof AppError && e.code === 'CATEGORY_INVALID',
  );
});

test('非法画布：8 位带透明、非法字符、长度不支持分别给出错误码', () => {
  assert.throws(
    () => checkContrast({ foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFFFF' }),
    (e: unknown) => e instanceof AppError && e.code === 'CANVAS_NOT_OPAQUE',
  );
  assert.throws(
    () => checkContrast({ foreground: '000000', background: 'FFFFFF', canvas: 'GGHHII' }),
    (e: unknown) => e instanceof AppError && e.code === 'COLOR_INVALID_CHAR',
  );
  assert.throws(
    () => checkContrast({ foreground: '#000', background: 'FFFFFF', canvas: 'FFFFFF' }),
    (e: unknown) => e instanceof AppError && e.code === 'COLOR_LENGTH_UNSUPPORTED',
  );
});

test('不透明颜色交换前景/背景不改变比值；透明色交换不满足该性质', () => {
  const a = checkContrast({ foreground: '112233', background: 'AABBCC', canvas: 'FFFFFF' });
  const b = checkContrast({ foreground: 'AABBCC', background: '112233', canvas: '000000' });
  assert.ok(Math.abs(a.contrastRatio - b.contrastRatio) < 1e-12);

  const ta = checkContrast({ foreground: '00000080', background: 'FFFFFF', canvas: 'FFFFFF' });
  const tb = checkContrast({ foreground: 'FFFFFF80', background: '000000', canvas: 'FFFFFF' });
  assert.ok(Math.abs(ta.contrastRatio - tb.contrastRatio) > 0.1);
});

test('公式独立核对：sRGB 线性化拐点与亮度加权', () => {
  assert.ok(Math.abs(srgbChannelToLinear(0.04045) - 0.04045 / 12.92) < 1e-15);
  assert.ok(Math.abs(srgbChannelToLinear(0.04046) - Math.pow((0.04046 + 0.055) / 1.055, 2.4)) < 1e-15);
  const red = parseColor('FF0000', 'foreground');
  assert.ok(Math.abs(relativeLuminance(red) - 0.2126) < 1e-12);
  assert.equal(contrastRatio(1, 0), 21);
  assert.equal(contrastRatio(0.3, 0.3), 1);
});
