import { checkColors, CheckReport, CheckFailure, CheckRequest } from './check';
import { CriterionResult } from './wcag';

export const MAX_BATCH = 100;

export interface BatchEntry {
  recordId?: string | number;
  foreground?: string;
  background?: string;
  canvas?: string;
  name?: string;
  category?: 'normal' | 'large';
}

export type BatchItemResult =
  | ({ index: number; recordId: string | number; ok: true } & CheckReport)
  | { index: number; recordId: string | number; ok: false; code: string; message: string; field?: string };

export interface BatchResponse {
  total: number;
  accepted: number;
  rejected: number;
  /** 保留输入顺序 */
  results: BatchItemResult[];
  error?: { code: string; message: string };
}

/** 批量核验。一条非法记录产生独立诊断，绝不把未计算项写成通过。 */
export function checkBatch(entries: BatchEntry[]): BatchResponse {
  if (!Array.isArray(entries)) {
    return {
      total: 0,
      accepted: 0,
      rejected: 0,
      results: [],
      error: { code: 'BATCH_NOT_ARRAY', message: '批量输入必须是数组' },
    };
  }
  if (entries.length > MAX_BATCH) {
    return {
      total: entries.length,
      accepted: 0,
      rejected: entries.length,
      results: [],
      error: {
        code: 'BATCH_TOO_MANY',
        message: `批量条数超过上限：${entries.length} > ${MAX_BATCH}`,
      },
    };
  }

  const results: BatchItemResult[] = entries.map((entry, index) => {
    const recordId = entry.recordId ?? index;
    const req: CheckRequest = {
      foreground: entry.foreground ?? '',
      background: entry.background ?? '',
      canvas: entry.canvas ?? '',
      name: entry.name,
      category: entry.category,
    };
    const report = checkColors(req);
    if (report.ok) {
      return { ...report, index, recordId };
    }
    const failure = report as CheckFailure;
    return {
      index,
      recordId,
      ok: false,
      code: failure.code,
      message: failure.message,
      field: failure.field,
    };
  });

  const rejected = results.filter((r) => !r.ok).length;
  return {
    total: entries.length,
    accepted: entries.length - rejected,
    rejected,
    results,
  };
}

/** 从批量结果中筛选失败项（可按等级与文本类别）。非法记录始终包含。 */
export function filterFailures(
  resp: BatchResponse,
  level?: 'AA' | 'AAA',
  category?: 'normal' | 'large',
): BatchItemResult[] {
  return resp.results.filter((item) => {
    if (!item.ok) return true;
    if (category && item.category !== category) return false;
    const failed = item.criteria.filter(
      (c: CriterionResult) => !c.pass && (!level || c.level === level),
    );
    return failed.length > 0;
  });
}
