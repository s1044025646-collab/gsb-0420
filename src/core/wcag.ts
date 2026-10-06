import { TextCategory } from './color';

export interface Criterion {
  key: 'aa_normal' | 'aaa_normal' | 'aa_large' | 'aaa_large';
  label: string;
  textCategory: TextCategory;
  level: 'AA' | 'AAA';
  threshold: number;
}

/** WCAG 文本对比度门槛 */
export const CRITERIA: Criterion[] = [
  { key: 'aa_normal', label: '普通文本 AA', textCategory: 'normal', level: 'AA', threshold: 4.5 },
  { key: 'aaa_normal', label: '普通文本 AAA', textCategory: 'normal', level: 'AAA', threshold: 7 },
  { key: 'aa_large', label: '大文本 AA', textCategory: 'large', level: 'AA', threshold: 3 },
  { key: 'aaa_large', label: '大文本 AAA', textCategory: 'large', level: 'AAA', threshold: 4.5 },
];

export interface CriterionResult {
  key: Criterion['key'];
  label: string;
  level: 'AA' | 'AAA';
  textCategory: TextCategory;
  /** 原始（未取整）对比度 */
  ratio: number;
  /** 门槛 */
  threshold: number;
  /** 差值 = ratio - threshold，>=0 表示通过 */
  difference: number;
  /** 使用 >= 判定 */
  pass: boolean;
  /** 是否为调用者所选文本类别的主判定 */
  primary: boolean;
}

/**
 * 逐项判定。主判定仅依据调用者明确提供的文本类别选择，
 * 不从粗体/字号字符串推断大文本。
 */
export function evaluateCriteria(ratio: number, category: TextCategory): {
  results: CriterionResult[];
  primaryPass: boolean;
  primary: Criterion;
} {
  const primary =
    category === 'normal'
      ? CRITERIA.find((c) => c.key === 'aa_normal')!
      : CRITERIA.find((c) => c.key === 'aa_large')!;
  const results: CriterionResult[] = CRITERIA.map((c) => {
    const difference = ratio - c.threshold;
    return {
      key: c.key,
      label: c.label,
      level: c.level,
      textCategory: c.textCategory,
      ratio,
      threshold: c.threshold,
      difference,
      pass: ratio >= c.threshold,
      primary: c.key === primary.key,
    };
  });
  const primaryPass = ratio >= primary.threshold;
  return { results, primaryPass, primary };
}

export function normalizeCategory(input: unknown): TextCategory {
  if (input === undefined || input === null || input === '') return 'normal';
  if (input === 'normal' || input === 'large') return input;
  throw new Error(`文本类别不合法："${String(input)}"，仅允许 normal 或 large（由调用者明确提供）`);
}
