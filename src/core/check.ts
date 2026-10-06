import {
  CompositeInput,
  FORMULA_VERSION,
  RGBA,
  TextCategory,
  toHex,
  ColorParseError,
  evaluateComposite,
} from './color';
import { CriterionResult, evaluateCriteria, normalizeCategory } from './wcag';

export interface CheckRequest extends CompositeInput {
  /** 可选名称 */
  name?: string;
  /** 文本类别：normal | large，必须由调用者明确提供；默认 normal */
  category?: TextCategory;
}

export interface ColorView {
  hex: string;
  /** 未取整的归一化通道 */
  channels: { r: number; g: number; b: number; a: number };
  /** 8 位整数，仅展示用 */
  bytes: { r: number; g: number; b: number; a: number };
}

export interface StepView {
  name: string;
  description: string;
  result: ColorView;
}

export interface CheckReport {
  ok: true;
  formulaVersion: string;
  name: string | null;
  category: TextCategory;
  input: {
    foreground: string;
    background: string;
    canvas: string;
  };
  finalBackground: ColorView;
  finalForeground: ColorView;
  luminance: {
    background: number;
    foreground: number;
  };
  /** 原始（未取整）对比度 */
  contrastRatio: number;
  primary: {
    category: TextCategory;
    level: 'AA' | 'AAA';
    threshold: number;
    pass: boolean;
    label: string;
  };
  criteria: CriterionResult[];
  steps: StepView[];
}

export interface CheckFailure {
  ok: false;
  code: string;
  message: string;
  field?: string;
}

function viewColor(c: RGBA): ColorView {
  return {
    hex: toHex(c),
    channels: { r: c.r, g: c.g, b: c.b, a: c.a },
    bytes: {
      r: Math.round(c.r * 255),
      g: Math.round(c.g * 255),
      b: Math.round(c.b * 255),
      a: Math.round(c.a * 255),
    },
  };
}

/** 核验单条配色。错误以返回值（不抛出）形式给出，便于批量逐条诊断。 */
export function checkColors(req: CheckRequest): CheckReport | CheckFailure {
  let category: TextCategory;
  try {
    category = normalizeCategory(req.category);
  } catch (e) {
    return { ok: false, code: 'CATEGORY_INVALID', message: (e as Error).message, field: 'category' };
  }

  if (!req.foreground || !req.background || !req.canvas) {
    const missing = ['foreground', 'background', 'canvas'].filter(
      (k) => !(req as unknown as Record<string, unknown>)[k],
    );
    return {
      ok: false,
      code: 'MISSING_COLOR',
      message: `缺少必要颜色字段：${missing.join('、')}`,
      field: missing.join(','),
    };
  }

  let composite;
  try {
    composite = evaluateComposite({
      foreground: req.foreground,
      background: req.background,
      canvas: req.canvas,
    });
  } catch (e) {
    if (e instanceof ColorParseError) {
      return { ok: false, code: e.code, message: e.message, field: e.field };
    }
    throw e;
  }

  const { results, primaryPass, primary } = evaluateCriteria(composite.ratio, category);

  return {
    ok: true,
    formulaVersion: FORMULA_VERSION,
    name: req.name ?? null,
    category,
    input: {
      foreground: req.foreground,
      background: req.background,
      canvas: req.canvas,
    },
    finalBackground: viewColor(composite.finalBackground),
    finalForeground: viewColor(composite.finalForeground),
    luminance: {
      background: composite.backgroundLuminance,
      foreground: composite.foregroundLuminance,
    },
    contrastRatio: composite.ratio,
    primary: {
      category,
      level: primary.level,
      threshold: primary.threshold,
      pass: primaryPass,
      label: primary.label,
    },
    criteria: results,
    steps: composite.steps.map((s) => ({
      name: s.name,
      description: s.description,
      result: viewColor(s.result),
    })),
  };
}

/** 从报告中按等级筛选失败的判定项。 */
export function failingCriteria(report: CheckReport, level?: 'AA' | 'AAA'): CriterionResult[] {
  return report.criteria.filter((c) => !c.pass && (!level || c.level === level));
}
