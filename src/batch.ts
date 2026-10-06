import { checkContrast, type CheckInput, type CheckResult } from './contrast.js';
import { AppError } from './errors.js';

export const MAX_BATCH = 100;

export interface BatchItemDiagnostic {
  id: string | number;
  index: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface BatchOutcome {
  total: number;
  passed: number;
  failed: number;
  invalid: number;
  results: Array<CheckResult & { status: 'pass' | 'fail' }>;
  diagnostics: BatchItemDiagnostic[];
}

/**
 * 批量核验：保留输入顺序，逐条独立诊断。
 * 一条非法不影响其它条；未计算项绝不会被写成通过。
 */
export function checkBatch(items: CheckInput[]): BatchOutcome {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('BATCH_EMPTY', '批量核验至少需要一条记录');
  }
  if (items.length > MAX_BATCH) {
    throw new AppError(
      'BATCH_LIMIT_EXCEEDED',
      `批量核验最多 ${MAX_BATCH} 条，收到 ${items.length} 条`,
      { max: MAX_BATCH, received: items.length },
    );
  }

  const results: BatchOutcome['results'] = [];
  const diagnostics: BatchItemDiagnostic[] = [];

  items.forEach((raw, index) => {
    const id = raw?.id ?? index + 1;
    try {
      const r = checkContrast({ ...raw, id });
      results.push({ ...r, status: r.primaryVerdict.pass ? 'pass' : 'fail' });
    } catch (err) {
      if (err instanceof AppError) {
        diagnostics.push({ id, index, code: err.code, message: err.message, details: err.details });
      } else {
        diagnostics.push({
          id,
          index,
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  const failed = results.filter((r) => !r.primaryVerdict.pass).length;
  return {
    total: items.length,
    passed: results.length - failed,
    failed,
    invalid: diagnostics.length,
    results,
    diagnostics,
  };
}

/** 按等级筛选失败项（返回稳定记录编号与失败等级）。 */
export function filterFailures(
  outcome: BatchOutcome,
  level: 'AA' | 'AAA',
  textType: 'normal' | 'large',
): Array<{ id: string | number; ratio: number; threshold: number; gap: number }> {
  return outcome.results
    .flatMap((r) =>
      r.levels
        .filter((l) => l.level === level && l.textType === textType && !l.pass)
        .map((l) => ({ id: r.id as string | number, ratio: l.ratio, threshold: l.threshold, gap: l.gap })),
    );
}
