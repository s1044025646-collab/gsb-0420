#!/usr/bin/env node
import { join } from 'node:path';
import { checkColors } from '../core/check';
import { checkBatch, filterFailures, MAX_BATCH } from '../core/batch';
import { Store } from '../db/store';
import { compareVersions, rowToReport } from '../core/versions';
import { readFileSync } from 'node:fs';

function db(): Store {
  const dbPath = process.env.WCAG_DB ?? join(process.cwd(), 'data', 'wcag.sqlite');
  return new Store(dbPath);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`错误: ${message}\n`);
  process.exit(code);
}

function getArg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

function printReport(r: ReturnType<typeof checkColors>): void {
  if (!r.ok) fail(`[${r.code}] ${r.message}${r.field ? `（字段: ${r.field}）` : ''}`, 2);
  process.stdout.write(`名称: ${r.name ?? '(未命名)'}\n`);
  process.stdout.write(`文本类别: ${r.category}（主判定: ${r.primary.label}）\n`);
  process.stdout.write(`公式版本: ${r.formulaVersion}\n`);
  process.stdout.write(`输入: 前景=${r.input.foreground} 背景=${r.input.background} 画布=${r.input.canvas}\n`);
  process.stdout.write(`最终背景: #${r.finalBackground.hex} 亮度=${r.luminance.background.toFixed(6)}\n`);
  process.stdout.write(`最终文字: #${r.finalForeground.hex} 亮度=${r.luminance.foreground.toFixed(6)}\n`);
  process.stdout.write(`对比度(原始): ${r.contrastRatio.toString()}\n`);
  process.stdout.write(`合成步骤:\n`);
  for (const s of r.steps) {
    const c = s.result.channels;
    process.stdout.write(
      `  - ${s.name}: #${s.result.hex} rgb(${c.r.toFixed(6)},${c.g.toFixed(6)},${c.b.toFixed(6)})\n    ${s.description}\n`,
    );
  }
  process.stdout.write(`判定（阈值用 >=，展示的差值基于原始比值）:\n`);
  for (const c of r.criteria) {
    process.stdout.write(
      `  [${c.pass ? '通过' : '失败'}] ${c.label} 比值=${c.ratio.toString()} 门槛=${c.threshold} 差值=${c.difference.toString()}${c.primary ? '  <== 主判定' : ''}\n`,
    );
  }
}

function cmdCheck(): void {
  const foreground = getArg('fg');
  const background = getArg('bg');
  const canvas = getArg('canvas');
  const category = (getArg('category') as 'normal' | 'large' | undefined) ?? 'normal';
  const name = getArg('name');
  if (!foreground || !background || !canvas) {
    fail('用法: wcag check --fg=RRGGBB[AA] --bg=RRGGBB[AA] --canvas=RRGGBB[AA] [--category=normal|large] [--name=X]');
  }
  printReport(checkColors({ foreground, background, canvas, category, name }));
}

function cmdBatch(): void {
  const file = getArg('file');
  const level = getArg('level') as 'AA' | 'AAA' | undefined;
  const onlyFailures = process.argv.includes('--failures');
  if (!file) fail('用法: wcag batch --file=entries.json [--failures] [--level=AA|AAA]');
  let entries: unknown;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    entries = Array.isArray(parsed) ? parsed : parsed.entries;
  } catch (e) {
    fail(`无法读取批量文件: ${(e as Error).message}`);
  }
  const result = checkBatch(entries as never);
  if (result.error) fail(`[${result.error.code}] ${result.error.message}`);
  process.stdout.write(`共 ${result.total} 条，通过计算 ${result.accepted}，拒绝 ${result.rejected}（上限 ${MAX_BATCH}）\n`);
  for (const item of result.results) {
    if (!item.ok) {
      process.stdout.write(`  #${item.recordId} [非法] ${item.code}: ${item.message}\n`);
      continue;
    }
    const failed = item.criteria.filter((c) => !c.pass && (!level || c.level === level));
    if (onlyFailures && failed.length === 0) continue;
    process.stdout.write(
      `  #${item.recordId} 比值=${item.contrastRatio.toString()} 主判定=${item.primary.pass ? '通过' : '失败'}${failed.length ? ` 失败项=${failed.map((f) => f.label).join(',')}` : ''}\n`,
    );
  }
}

function cmdSave(): void {
  const palette = getArg('palette');
  const foreground = getArg('fg');
  const background = getArg('bg');
  const canvas = getArg('canvas');
  if (!palette || !foreground || !background || !canvas) {
    fail('用法: wcag save --palette=P --fg=.. --bg=.. --canvas=.. [--category=normal|large] [--name=X]');
  }
  const category = (getArg('category') as 'normal' | 'large' | undefined) ?? 'normal';
  const name = getArg('name') ?? 'default';
  const store = db();
  const report = checkColors({ foreground, background, canvas, category, name });
  if (!report.ok) {
    store.close();
    fail(`[${report.code}] ${report.message}`, 2);
  }
  const saved = store.saveVersion(palette, name, { foreground, background, canvas, category }, report);
  store.close();
  process.stdout.write(`已保存到集合 "${palette}"，版本=${saved.version}，记录ID=${saved.id}，主判定=${report.primary.pass ? '通过' : '失败'}\n`);
}

function cmdList(): void {
  const palette = getArg('palette');
  const store = db();
  if (palette) {
    const rows = store.listVersions(palette);
    for (const r of rows) {
      const m = rowToReport(r).meta;
      process.stdout.write(`v${m.version} ${m.name} fg=${m.foreground} bg=${m.background} canvas=${m.canvas} 比值=${m.contrastRatio.toString()} 主判定=${m.primaryPass ? '通过' : '失败'}\n`);
    }
  } else {
    for (const p of store.listPalettes()) {
      process.stdout.write(`${p.palette}\t版本数=${p.versions}\t最新=v${p.latest}\n`);
    }
  }
  store.close();
}

function cmdShow(): void {
  const palette = getArg('palette');
  const version = getArg('version');
  if (!palette) fail('用法: wcag show --palette=P [--version=N]');
  const store = db();
  const row = version ? store.getVersion(palette, Number(version)) : store.latestVersion(palette);
  store.close();
  if (!row) fail('版本不存在');
  printReport(rowToReport(row).report);
}

function cmdCompare(): void {
  const palette = getArg('palette');
  const range = getArg('versions');
  if (!palette || !range || !range.includes('...')) fail('用法: wcag compare --palette=P --versions=1...2');
  const [from, to] = range.split('...').map(Number);
  const store = db();
  const a = store.getVersion(palette, from);
  const bRow = store.getVersion(palette, to);
  store.close();
  if (!a || !bRow) fail('版本不存在');
  const cmp = compareVersions(a, bRow);
  process.stdout.write(`v${cmp.from.version} 比值=${cmp.from.contrastRatio.toString()} -> v${cmp.to.version} 比值=${cmp.to.contrastRatio.toString()}\n`);
  process.stdout.write(`比值变化=${cmp.ratioDelta.toString()}，主判定变化=${cmp.primaryPassChanged ? '是' : '否'}\n`);
  process.stdout.write(`颜色变化: 前景=${cmp.colorsChanged.foreground} 背景=${cmp.colorsChanged.background} 画布=${cmp.colorsChanged.canvas} 类别=${cmp.colorsChanged.category}\n`);
}

function cmdExport(): void {
  const store = db();
  const rows = store.listVersions();
  store.close();
  process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, versions: rows.map((r) => rowToReport(r).meta) }, null, 2) + '\n');
}

function usage(): void {
  process.stdout.write(
    [
      'wcag - WCAG 文本对比度与透明叠色核验 CLI',
      '',
      '命令:',
      '  check     核验单条配色并显示合成步骤与判定',
      '  batch     批量核验（--file=entries.json [--failures] [--level=AA|AAA]）',
      '  save      保存为命名集合的新版本（--palette=P）',
      '  list      列出集合，或 --palette=P 列出其版本',
      '  show      查看某集合某版本（默认最新）的亮度与合成步骤',
      '  compare   比较版本 --versions=1...2',
      '  export    导出全部版本元数据为 JSON',
      '',
      '颜色均为 RRGGBB 或 RRGGBBAA；画布必须不透明。类别仅 normal|large，由调用者提供。',
    ].join('\n') + '\n',
  );
}

const command = process.argv[2];
switch (command) {
  case 'check': cmdCheck(); break;
  case 'batch': cmdBatch(); break;
  case 'save': cmdSave(); break;
  case 'list': cmdList(); break;
  case 'show': cmdShow(); break;
  case 'compare': cmdCompare(); break;
  case 'export': cmdExport(); break;
  default: usage(); break;
}
