import { CheckReport } from './check';
import { VersionRow } from '../db/store';

export interface VersionSummary {
  palette: string;
  version: number;
  name: string;
  foreground: string;
  background: string;
  canvas: string;
  category: string;
  formulaVersion: string;
  contrastRatio: number;
  primaryPass: boolean;
  createdAt: string;
}

export function rowToReport(row: VersionRow): { meta: VersionSummary; report: CheckReport } {
  const report = JSON.parse(row.report_json) as CheckReport;
  return {
    meta: {
      palette: row.palette,
      version: row.version,
      name: row.name,
      foreground: row.foreground,
      background: row.background,
      canvas: row.canvas,
      category: row.category,
      formulaVersion: row.formula_version,
      contrastRatio: report.contrastRatio,
      primaryPass: report.primary.pass,
      createdAt: row.created_at,
    },
    report,
  };
}

/** 比较同一配色集合的两个版本，输出原始色值与比值差异。 */
export function compareVersions(
  a: VersionRow,
  b: VersionRow,
): {
  from: VersionSummary;
  to: VersionSummary;
  ratioDelta: number;
  primaryPassChanged: boolean;
  colorsChanged: { foreground: boolean; background: boolean; canvas: boolean; category: boolean };
} {
  const va = rowToReport(a).meta;
  const vb = rowToReport(b).meta;
  return {
    from: va,
    to: vb,
    ratioDelta: vb.contrastRatio - va.contrastRatio,
    primaryPassChanged: va.primaryPass !== vb.primaryPass,
    colorsChanged: {
      foreground: va.foreground.toLowerCase() !== vb.foreground.toLowerCase(),
      background: va.background.toLowerCase() !== vb.background.toLowerCase(),
      canvas: va.canvas.toLowerCase() !== vb.canvas.toLowerCase(),
      category: va.category !== vb.category,
    },
  };
}
