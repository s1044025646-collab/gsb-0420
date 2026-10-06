import { checkColors } from './core/check';

function line(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function brief(label: string, fg: string, bg: string, canvas: string, category: 'normal' | 'large' = 'normal'): void {
  const r = checkColors({ foreground: fg, background: bg, canvas, category });
  if (!r.ok) {
    process.stdout.write(`${label}: [${r.code}] ${r.message}\n`);
    return;
  }
  process.stdout.write(
    `${label}: fg=${fg} bg=${bg} canvas=${canvas} -> 比值=${r.contrastRatio.toString()} ` +
      `最终文字=#${r.finalForeground.hex} 最终背景=#${r.finalBackground.hex} ` +
      `主判定(${r.primary.label})=${r.primary.pass ? '通过' : '失败'}\n`,
  );
}

line('演示 1：纯黑文字 / 纯白背景（不透明）应为 21:1');
brief('黑/白', '000000', 'FFFFFF', 'FFFFFF');

line('演示 2：相同颜色应为 1:1');
brief('同色', '336699', '336699', 'FFFFFF');

line('演示 3：白底上半透明黑字 vs 不透明黑字');
brief('半透明黑 80%', '000000CC', 'FFFFFF', 'FFFFFF');
brief('不透明黑', '000000', 'FFFFFF', 'FFFFFF');

line('演示 4：透明前景 alpha=0，应与背景一致，比值 1:1');
brief('全透明文字', '00000000', 'FFFFFF', 'FFFFFF');

line('演示 5：半透明背景叠到彩色画布');
brief('透明白背景', '000000', 'FFFFFF80', '006600');

line('演示 6：非法画布（含透明度）应被拒绝');
brief('透明画布', '000000', 'FFFFFF', 'FFFFFF80');

line('演示 7：不透明颜色交换前景/背景，比值不变');
{
  const a = checkColors({ foreground: '112233', background: 'AABBCC', canvas: 'FFFFFF' });
  const b = checkColors({ foreground: 'AABBCC', background: '112233', canvas: 'FFFFFF' });
  if (a.ok && b.ok) {
    process.stdout.write(`不透明交换: ${a.contrastRatio.toString()} == ${b.contrastRatio.toString()} -> ${a.contrastRatio === b.contrastRatio ? '相等 ✓' : '不相等 ✗'}\n`);
  }
}

line('演示 8：透明色交换前景/背景，一般不再相等（不能套用该性质）');
{
  const a = checkColors({ foreground: '11223380', background: 'AABBCC', canvas: '006600' });
  const b = checkColors({ foreground: 'AABBCC', background: '11223380', canvas: '006600' });
  if (a.ok && b.ok) {
    process.stdout.write(`透明交换: ${a.contrastRatio.toFixed(6)} vs ${b.contrastRatio.toFixed(6)} -> ${a.contrastRatio === b.contrastRatio ? '相等' : '不相等（符合预期）'}\n`);
  }
}

line('演示 9：大文本类别由调用者明确提供');
brief('大文本 AA 门槛 3', '777777', 'FFFFFF', 'FFFFFF', 'large');
brief('普通文本 AA 门槛 4.5', '777777', 'FFFFFF', 'FFFFFF', 'normal');
