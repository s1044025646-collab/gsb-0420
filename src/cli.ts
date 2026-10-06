#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './db.js';
import { checkContrast, formatResultBrief, type CheckInput, type TextCategory } from './contrast.js';
import { checkBatch, filterFailures } from './batch.js';
import { AppError } from './errors.js';

function dbPath(): string {
  return process.env.WCAG_DB ?? join(process.cwd(), 'data', 'wcag.db');
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new AppError('VALIDATION_ERROR', `缺少参数 --${name}`);
}

function readInputs(): CheckInput {
  return {
    foreground: arg('fg'),
    background: arg('bg'),
    canvas: arg('canvas'),
    category: arg('category', 'normal') as TextCategory,
  };
}

function printDetails(r: ReturnType<typeof checkContrast>): void {
  console.log(formatResultBrief(r));
  if (r.steps.length > 0) {
    console.log('  合成步骤:');
    for (const s of r.steps) {
      console.log(`    - [${s.step}] ${s.description}`);
      console.log(`      结果通道(未取整): r=${s.result.r} g=${s.result.g} b=${s.result.b} a=${s.result.a}`);
      console.log(`      显示用 HEX8: ${s.result.hex8}`);
    }
  }
}

function demo(store: Store): void {
  console.log('=== 演示 1：纯黑文字 / 纯白底（白底画布）===');
  const blackWhite = checkContrast({ foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' });
  printDetails(blackWhite);
  console.log();

  console.log('=== 演示 2：相同颜色 ===');
  const same = checkContrast({ foreground: '336699', background: '336699', canvas: 'FFFFFF' });
  printDetails(same);
  console.log();

  console.log('=== 演示 3：半透明黑字(CC=80%) vs 不透明黑字，均落在白底 ===');
  const trans = checkContrast({ foreground: '000000CC', background: 'FFFFFF', canvas: 'FFFFFF' });
  const solid = checkContrast({ foreground: '000000', background: 'FFFFFF', canvas: 'FFFFFF' });
  printDetails(trans);
  printDetails(solid);
  console.log(
    `  差值：半透明黑对比度比不透明黑低 ${(solid.contrastRatio - trans.contrastRatio).toFixed(6)}`,
  );
  console.log(`  半透明前景最终颜色（显示）=${trans.finalForeground.hex8}`);
  console.log();

  console.log('=== 演示 4：透明前景（alpha=00）应与背景一致，比值 1 ===');
  const invisible = checkContrast({ foreground: '00000000', background: '7F7F7F', canvas: 'FFFFFF' });
  printDetails(invisible);
  console.log();

  console.log('=== 演示 5：半透明背景叠不同画布 ===');
  const c1 = checkContrast({ foreground: '000000', background: 'FFFFFF80', canvas: '000000' });
  const c2 = checkContrast({ foreground: '000000', background: 'FFFFFF80', canvas: 'FFFFFF' });
  printDetails(c1);
  printDetails(c2);
  console.log();

  console.log('=== 演示 6：版本化保存（同色不新建版本，改色新建版本）===');
  const s1 = store.saveVersion('demo-theme', {
    foreground: '000000',
    background: 'FFFFFF',
    canvas: 'FFFFFF',
    category: 'normal',
  });
  const s2 = store.saveVersion('demo-theme', {
    foreground: '777777',
    background: 'FFFFFF',
    canvas: 'FFFFFF',
    category: 'normal',
  });
  const s3 = store.saveVersion('demo-theme', {
    foreground: '777777',
    background: 'FFFFFF',
    canvas: 'FFFFFF',
    category: 'normal',
  });
  console.log(`  第1次: 新版本=${s1.isNewVersion} v${s1.record.version}`);
  console.log(`  改色后: 新版本=${s2.isNewVersion} v${s2.record.version}`);
  console.log(`  同色再存: 新版本=${s3.isNewVersion} v${s3.record.version}（历史判定不被覆盖）`);
}

function main(): void {
  const cmd = process.argv[2];
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  const store = new Store(dbPath());
  try {
    switch (cmd) {
      case 'check':
        printDetails(checkContrast(readInputs()));
        break;
      case 'batch': {
        const file = arg('file');
        const items: CheckInput[] = JSON.parse(readText(file)) as CheckInput[];
        const outcome = checkBatch(items);
        for (const r of outcome.results) printDetails(r);
        for (const d of outcome.diagnostics) {
          console.log(`#${d.id} [${d.code}] ${d.message}`);
        }
        console.log(
          `\n汇总: 共 ${outcome.total}，通过 ${outcome.passed}，失败 ${outcome.failed}，非法 ${outcome.invalid}`,
        );
        break;
      }
      case 'failures': {
        const file = arg('file');
        const level = (arg('level', 'AA') as 'AA' | 'AAA') === 'AAA' ? 'AAA' : 'AA';
        const textType = arg('text-type', 'normal') === 'large' ? 'large' : 'normal';
        const outcome = checkBatch(JSON.parse(readText(file)) as CheckInput[]);
        const fails = filterFailures(outcome, level, textType);
        console.log(`${level} / ${textType === 'large' ? '大文本' : '普通文本'} 失败项:`);
        for (const f of fails) {
          console.log(
            `  #${f.id} 比值=${f.ratio.toFixed(6)} 门槛=${f.threshold} 差值=${f.gap.toFixed(6)}`,
          );
        }
        console.log(`共 ${fails.length} 项`);
        break;
      }
      case 'save': {
        const name = arg('name');
        const saved = store.saveVersion(name, readInputs());
        console.log(
          saved.isNewVersion
            ? `已保存新版本 v${saved.record.version} -> 配色 ${name}`
            : `颜色未变化，沿用 v${saved.record.version} -> 配色 ${name}`,
        );
        printDetails(JSON.parse(saved.record.result_json));
        break;
      }
      case 'palettes':
        for (const p of store.listPalettes()) {
          console.log(`${p.palette_name}\t版本数=${p.versions}\t最新=v${p.latest_version}`);
        }
        break;
      case 'versions': {
        const name = arg('name');
        const vs = store.listVersions(name);
        if (vs.length === 0) throw new AppError('PALETTE_NOT_FOUND', `配色集合不存在：${name}`);
        for (const v of vs) {
          console.log(
            `v${v.version}\t${v.foreground}/${v.background}/${v.canvas}\t${v.category}\t比值=${v.ratio.toFixed(6)}\t${v.formula_version}`,
          );
        }
        break;
      }
      case 'compare': {
        const name = arg('name');
        const a = Number(arg('a'));
        const b = Number(arg('b'));
        const cmp = store.compareVersions(name, a, b);
        if (!cmp) throw new AppError('VERSION_NOT_FOUND', `版本不存在：${name} v${a} 或 v${b}`);
        console.log(`v${cmp.a.version} 比值=${cmp.a.ratio.toFixed(6)}`);
        console.log(`v${cmp.b.version} 比值=${cmp.b.ratio.toFixed(6)}`);
        console.log(`比值变化(b-a)=${cmp.ratioDelta.toFixed(6)}`);
        break;
      }
      case 'export': {
        const name = arg('name');
        const out = arg('out', join(process.cwd(), 'data', `${name}-export.json`));
        const versions = store.listVersions(name);
        if (versions.length === 0) throw new AppError('PALETTE_NOT_FOUND', `配色集合不存在：${name}`);
        writeFileSync(out, JSON.stringify({ palette: name, versions }, null, 2), 'utf8');
        console.log(`已导出 ${versions.length} 个版本到 ${out}`);
        break;
      }
      case 'demo':
        demo(store);
        break;
      default:
        console.log(usage());
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(`[${err.code}] ${err.message}`);
      if (err.details) console.error(JSON.stringify(err.details));
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    store.close();
  }
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function usage(): string {
  return `wcag-cc - 本地 WCAG 文本对比度核验 CLI

用法:
  node dist/cli.js check --fg RRGGBB[AA] --bg RRGGBB[AA] --canvas RRGGBB [--category normal|large]
  node dist/cli.js batch --file items.json
  node dist/cli.js failures --file items.json [--level AA|AAA] [--text-type normal|large]
  node dist/cli.js save --name 名称 --fg ... --bg ... --canvas ... [--category normal|large]
  node dist/cli.js palettes
  node dist/cli.js versions --name 名称
  node dist/cli.js compare --name 名称 --a 1 --b 2
  node dist/cli.js export --name 名称 [--out 文件.json]
  node dist/cli.js demo

环境变量:
  WCAG_DB   SQLite 文件路径（默认 ./data/wcag.db）
  PORT      HTTP 端口（仅 server 使用；不设置则自动选择空闲端口）
`;
}

main();
