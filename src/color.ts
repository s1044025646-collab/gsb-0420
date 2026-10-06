import { AppError } from './errors.js';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * 解析 RRGGBB 或 RRGGBBAA 十六进制 sRGB 颜色（大小写不敏感）。
 * 通道归一化到 0..1，保留浮点，不做四舍五入。
 */
export function parseColor(input: string, role: 'foreground' | 'background' | 'canvas'): RGBA {
  if (typeof input !== 'string') {
    throw new AppError('VALIDATION_ERROR', `${role} 必须是十六进制字符串`, { field: role });
  }
  const hex = input.trim();
  if (hex.length !== 6 && hex.length !== 8) {
    throw new AppError(
      'COLOR_LENGTH_UNSUPPORTED',
      `${role} 颜色长度不支持：仅接受 6 位 RRGGBB 或 8 位 RRGGBBAA，收到长度 ${hex.length}`,
      { field: role, value: input, length: hex.length },
    );
  }
  if (!HEX_RE.test(hex)) {
    throw new AppError('COLOR_INVALID_CHAR', `${role} 颜色含非法字符：${input}`, {
      field: role,
      value: input,
    });
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/** 画布必须不透明：仅接受 6 位 RRGGBB。 */
export function parseCanvas(input: string): RGBA {
  if (typeof input !== 'string' || input.trim().length !== 6) {
    throw new AppError('CANVAS_NOT_OPAQUE', '画布色必须是不透明的 6 位 RRGGBB', { value: input });
  }
  const c = parseColor(input, 'canvas');
  if (c.a !== 1) {
    throw new AppError('CANVAS_NOT_OPAQUE', '画布色必须不透明（alpha=255）', { value: input });
  }
  return c;
}

/** 在归一化 sRGB 编码通道上做普通 source-over 合成：src 覆盖到 dst。 */
export function sourceOver(src: RGBA, dst: RGBA): RGBA {
  const a = src.a + dst.a * (1 - src.a);
  if (a === 0) return { r: dst.r, g: dst.g, b: dst.b, a: 0 };
  const mix = (cs: number, cd: number) => (src.a * cs + dst.a * cd * (1 - src.a)) / a;
  return { r: mix(src.r, dst.r), g: mix(src.g, dst.g), b: mix(src.b, dst.b), a };
}

/** 背景先叠到不透明画布，结果仍不透明；供前景继续叠加。 */
export function compositeBackgroundOverCanvas(bg: RGBA, canvas: RGBA): RGBA {
  return sourceOver(bg, canvas);
}

export function hasAlpha(c: RGBA): boolean {
  return c.a !== 1;
}

/** 用于展示：0..1 -> 00..FF（仅显示用，不参与计算）。 */
export function toHex8(c: RGBA): string {
  const h = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}`;
}
