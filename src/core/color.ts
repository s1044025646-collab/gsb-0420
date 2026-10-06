/**
 * sRGB 颜色解析、透明叠色（source-over）与 WCAG 相对亮度/对比度计算。
 *
 * 关键顺序：
 *   1) 先将背景（含 alpha）按 source-over 叠到“不透明画布”上，得到最终背景色；
 *   2) 再将前景（含 alpha）叠到所得背景上，得到最终文字色；
 *   3) 分别对最终文字色与最终背景色做 sRGB -> 线性转换，再算相对亮度；
 *   4) 用未取整的线性亮度计算对比度。
 *
 * 本模块在“归一化 sRGB 编码通道”上做普通 source-over 合成（不做伽马校正后的线性合成），
 * 合成结果保留未取整的浮点通道，直到展示时才可选格式化为 8 位整数。
 */

export const FORMULA_VERSION = 'wcag21-srgb-sourceover-v1';

export interface RGBA {
  /** 归一化 sRGB 编码通道，范围 0..1 */
  r: number;
  g: number;
  b: number;
  /** 不透明度，范围 0..1 */
 a: number;
}

export type TextCategory = 'normal' | 'large';

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

/** 颜色解析错误 */
export class ColorParseError extends Error {
  code: string;
  field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'ColorParseError';
    this.code = code;
    this.field = field;
  }
}

/**
 * 解析 RRGGBB 或 RRGGBBAA 十六进制颜色（大小写不敏感）。
 * 仅支持 6 位（不透明）或 8 位（含 alpha）；不支持 3/4 位简写。
 * 画布要求不透明（6 位，或 8 位且 alpha == FF）。
 */
export function parseColor(input: string, field = 'color', requireOpaque = false): RGBA {
  if (typeof input !== 'string') {
    throw new ColorParseError('COLOR_NOT_STRING', `颜色必须是字符串，收到 ${typeof input}`, field);
  }
  let hex = input.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);

  if (hex.length !== 6 && hex.length !== 8) {
    throw new ColorParseError(
      'COLOR_LENGTH_UNSUPPORTED',
      `颜色长度不支持："${input}"，仅支持 RRGGBB（6 位）或 RRGGBBAA（8 位）`,
      field,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new ColorParseError('COLOR_INVALID_CHAR', `颜色字符不合法："${input}"，仅允许十六进制字符 0-9 a-f`, field);
  }

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

  if (requireOpaque && a !== 1) {
    throw new ColorParseError(
      'CANVAS_NOT_OPAQUE',
      `画布色必须不透明："${input}" 的 alpha 为 ${hex.slice(6, 8)}，画布不允许含透明度`,
      field,
    );
  }

  return { r, g, b, a };
}

/**
 * 在归一化 sRGB 编码通道上做普通 source-over：
 *   out = src * src.a + dst * (1 - src.a)
 * 结果始终不透明（a = 1）。
 */
export function sourceOver(src: RGBA, dst: RGBA): RGBA {
  const a = src.a;
  return {
    r: src.r * a + dst.r * (1 - a),
    g: src.g * a + dst.g * (1 - a),
    b: src.b * a + dst.b * (1 - a),
    a: 1,
  };
}

/** sRGB 编码通道 -> 线性光通道 */
export function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（输入应为不透明、归一化 sRGB 编码颜色） */
export function relativeLuminance(c: RGBA): number {
  const r = srgbChannelToLinear(c.r);
  const g = srgbChannelToLinear(c.g);
  const b = srgbChannelToLinear(c.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度：(L_lighter + 0.05) / (L_darker + 0.05) */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 将 0..1 通道转回 8 位整数（仅用于展示，不参与判定） */
export function toByte(c: number): number {
  return Math.round(c * 255);
}

/** 格式化为 RRGGBBAA 风格字符串（仅用于展示） */
export function toHex(c: RGBA): string {
  const h = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}`;
}

export interface CompositeInput {
  /** 前景（文字）原始十六进制，RRGGBB / RRGGBBAA */
  foreground: string;
  /** 背景原始十六进制，RRGGBB / RRGGBBAA */
  background: string;
  /** 不透明画布原始十六进制，RRGGBB / RRGGBBAA（必须不透明） */
  canvas: string;
}

export interface CompositeResult {
  finalBackground: RGBA;
  finalForeground: RGBA;
  backgroundLuminance: number;
  foregroundLuminance: number;
  ratio: number;
  steps: CompositeStep[];
  foregroundHasAlpha: boolean;
  backgroundHasAlpha: boolean;
}

export interface CompositeStep {
  name: string;
  description: string;
  result: RGBA;
}

/**
 * 执行完整叠色与亮度计算。
 * 抛出 ColorParseError 表示输入非法。
 */
export function evaluateComposite(input: CompositeInput): CompositeResult {
  const fg = parseColor(input.foreground, 'foreground');
  const bg = parseColor(input.background, 'background');
  const canvas = parseColor(input.canvas, 'canvas', true);

  const steps: CompositeStep[] = [];

  // 1) 背景叠到不透明画布
  const finalBackground = sourceOver(bg, canvas);
  const bgHasAlpha = bg.a !== 1;
  if (bgHasAlpha) {
    steps.push({
      name: 'background_over_canvas',
      description:
        '背景含透明度：在归一化 sRGB 编码通道上以 source-over 叠到不透明画布，' +
        '通道 = 背景*a + 画布*(1-a)',
      result: finalBackground,
    });
  } else {
    steps.push({
      name: 'background_opaque',
      description: '背景不透明，最终背景即背景本身（画布不可见）。',
      result: finalBackground,
    });
  }

  // 2) 前景叠到所得背景
  const finalForeground = sourceOver(fg, finalBackground);
  const fgHasAlpha = fg.a !== 1;
  if (fgHasAlpha) {
    steps.push({
      name: 'foreground_over_background',
      description:
        '前景（文字）含透明度：在归一化 sRGB 编码通道上以 source-over 叠到第 1 步所得背景，' +
        '通道 = 前景*a + 最终背景*(1-a)',
      result: finalForeground,
    });
  } else {
    steps.push({
      name: 'foreground_opaque',
      description: '前景不透明，最终文字色即前景本身。',
      result: finalForeground,
    });
  }

  // 3) 分别线性化并计算亮度，全程不取整
  const backgroundLuminance = relativeLuminance(finalBackground);
  const foregroundLuminance = relativeLuminance(finalForeground);

  // 4) 对比度
  const ratio = contrastRatio(foregroundLuminance, backgroundLuminance);

  return {
    finalBackground,
    finalForeground,
    backgroundLuminance,
    foregroundLuminance,
    ratio,
    steps,
    foregroundHasAlpha: fgHasAlpha,
    backgroundHasAlpha: bgHasAlpha,
  };
}
