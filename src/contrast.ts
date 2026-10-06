import {
  parseColor,
  parseCanvas,
  compositeBackgroundOverCanvas,
  sourceOver,
  hasAlpha,
  toHex8,
  type RGBA,
} from './color.js';
import { AppError } from './errors.js';

export const FORMULA_VERSION = 'WCAG21-sRGB-sourceOver-v1';

export type TextCategory = 'normal' | 'large';

const CATEGORY_LABEL: Record<TextCategory, string> = {
  normal: '普通文本',
  large: '大文本',
};

export interface CheckInput {
  foreground: string;
  background: string;
  canvas: string;
  category?: TextCategory;
  id?: string | number;
}

export interface Step {
  step: string;
  description: string;
  result: { r: number; g: number; b: number; a: number; hex8: string };
}

export interface LevelResult {
  level: 'AA' | 'AAA';
  textType: 'normal' | 'large';
  threshold: number;
  ratio: number;
  gap: number;
  pass: boolean;
}

export interface CheckResult {
  id?: string | number;
  formulaVersion: string;
  category: TextCategory;
  foregroundInput: string;
  backgroundInput: string;
  canvasInput: string;
  finalBackground: RGBA & { hex8: string };
  finalForeground: RGBA & { hex8: string };
  steps: Step[];
  relativeLuminance: {
    finalForeground: { r: number; g: number; b: number; luminance: number };
    finalBackground: { r: number; g: number; b: number; luminance: number };
  };
  contrastRatio: number;
  levels: LevelResult[];
  primaryVerdict: { level: 'AA' | 'AAA'; pass: boolean; threshold: number };
  alphaUsed: { foreground: boolean; background: boolean };
}

export function parseCategory(input: unknown): TextCategory {
  if (input === undefined || input === null || input === '') return 'normal';
  if (input !== 'normal' && input !== 'large') {
    throw new AppError('CATEGORY_INVALID', `文本类别只能是 normal 或 large，收到 ${String(input)}`, {
      value: String(input),
    });
  }
  return input;
}

/** sRGB 编码通道 -> 线性光通道。 */
export function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（线性 R/G/B 按 0.2126/0.7152/0.0722 加权）。 */
export function relativeLuminance(c: RGBA): number {
  const r = srgbChannelToLinear(c.r);
  const g = srgbChannelToLinear(c.g);
  const b = srgbChannelToLinear(c.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function describe(c: RGBA): RGBA & { hex8: string } {
  return { ...c, hex8: toHex8(c) };
}

function buildLevels(ratio: number): LevelResult[] {
  const specs: Array<{ level: 'AA' | 'AAA'; textType: TextCategory; threshold: number }> = [
    { level: 'AA', textType: 'normal', threshold: 4.5 },
    { level: 'AAA', textType: 'normal', threshold: 7 },
    { level: 'AA', textType: 'large', threshold: 3 },
    { level: 'AAA', textType: 'large', threshold: 4.5 },
  ];
  return specs.map((s) => ({
    ...s,
    ratio,
    gap: ratio - s.threshold,
    pass: ratio >= s.threshold,
  }));
}

/** 核验单个纯色组合。顺序：背景 over 画布 → 前景 over 结果背景。 */
export function checkContrast(input: CheckInput): CheckResult {
  const fg = parseColor(input.foreground, 'foreground');
  const bg = parseColor(input.background, 'background');
  const canvas = parseCanvas(input.canvas);
  const category = parseCategory(input.category);

  const steps: Step[] = [];
  const finalBg = compositeBackgroundOverCanvas(bg, canvas);
  if (hasAlpha(bg)) {
    steps.push({
      step: 'background-over-canvas',
      description:
        '在归一化 sRGB 编码通道上做普通 source-over：半透明背景先叠加到不透明画布',
      result: describe(finalBg),
    });
  }
  const finalFg = sourceOver(fg, finalBg);
  if (hasAlpha(fg)) {
    steps.push({
      step: 'foreground-over-background',
      description:
        '在归一化 sRGB 编码通道上做普通 source-over：半透明前景叠加到上一步得到的背景',
      result: describe(finalFg),
    });
  }

  const fgLin = {
    r: srgbChannelToLinear(finalFg.r),
    g: srgbChannelToLinear(finalFg.g),
    b: srgbChannelToLinear(finalFg.b),
  };
  const bgLin = {
    r: srgbChannelToLinear(finalBg.r),
    g: srgbChannelToLinear(finalBg.g),
    b: srgbChannelToLinear(finalBg.b),
  };
  const lumFg = 0.2126 * fgLin.r + 0.7152 * fgLin.g + 0.0722 * fgLin.b;
  const lumBg = 0.2126 * bgLin.r + 0.7152 * bgLin.g + 0.0722 * bgLin.b;
  const ratio = contrastRatio(lumFg, lumBg);
  const levels = buildLevels(ratio);

  const primaryThreshold = category === 'large' ? 3 : 4.5;
  const primary = levels.find(
    (l) => l.level === 'AA' && l.textType === category,
  ) as LevelResult;

  return {
    id: input.id,
    formulaVersion: FORMULA_VERSION,
    category,
    foregroundInput: input.foreground,
    backgroundInput: input.background,
    canvasInput: input.canvas,
    finalBackground: describe(finalBg),
    finalForeground: describe(finalFg),
    steps,
    relativeLuminance: {
      finalForeground: { ...fgLin, luminance: lumFg },
      finalBackground: { ...bgLin, luminance: lumBg },
    },
    contrastRatio: ratio,
    levels,
    primaryVerdict: { level: 'AA', pass: primary.pass, threshold: primaryThreshold },
    alphaUsed: { foreground: hasAlpha(fg), background: hasAlpha(bg) },
  };
}

export function formatResultBrief(r: CheckResult): string {
  const cat = CATEGORY_LABEL[r.category];
  const lines = [
    `#${r.id ?? '-'}  前景=${r.foregroundInput} 背景=${r.backgroundInput} 画布=${r.canvasInput} (${cat})`,
    `  最终前景=${r.finalForeground.hex8}  最终背景=${r.finalBackground.hex8}`,
    `  亮度 前景=${r.relativeLuminance.finalForeground.luminance.toFixed(6)} 背景=${r.relativeLuminance.finalBackground.luminance.toFixed(6)}`,
    `  对比度=${r.contrastRatio.toFixed(6)}  主判定(AA ${cat})=${r.primaryVerdict.pass ? '通过' : '失败'} (门槛 ${r.primaryVerdict.threshold})`,
  ];
  for (const l of r.levels) {
    const name = l.textType === 'normal' ? '普通文本' : '大文本';
    lines.push(
    `    ${l.level} ${name.padEnd(4)} 门槛=${l.threshold} 比值=${l.ratio.toFixed(6)} 差值=${l.gap.toFixed(6)} ${l.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  return lines.join('\n');
}
