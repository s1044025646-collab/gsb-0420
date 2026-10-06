import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNet } from 'node:net';
import { join } from 'node:path';
import { Store } from './db.js';
import { checkContrast, type CheckInput } from './contrast.js';
import { checkBatch, filterFailures } from './batch.js';
import { AppError, errorBody, type ErrorCode } from './errors.js';

const HTTP_STATUS: Record<ErrorCode, number> = {
  COLOR_LENGTH_UNSUPPORTED: 400,
  COLOR_INVALID_CHAR: 400,
  CANVAS_NOT_OPAQUE: 400,
  CATEGORY_INVALID: 400,
  BATCH_LIMIT_EXCEEDED: 400,
  BATCH_EMPTY: 400,
  PALETTE_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  RECORD_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
};

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNet();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new AppError('VALIDATION_ERROR', '请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AppError('VALIDATION_ERROR', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

export interface AppContext {
  store: Store;
}

function toCheckInput(body: any): CheckInput {
  if (!body || typeof body !== 'object') {
    throw new AppError('VALIDATION_ERROR', '请求体必须是 JSON 对象');
  }
  const { foreground, background, canvas, category } = body;
  if (!foreground || !background || !canvas) {
    throw new AppError(
      'VALIDATION_ERROR',
      '缺少必填字段：foreground、background、canvas',
      { received: Object.keys(body) },
    );
  }
  return { foreground, background, canvas, category };
}

export function createApp(store: Store): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true });
      }

      if (method === 'POST' && path === '/api/check') {
        const body = await readJson(req);
        return send(res, 200, checkContrast(toCheckInput(body)));
      }

      if (method === 'POST' && path === '/api/batch') {
        const body = await readJson(req);
        if (!Array.isArray(body.items)) {
          throw new AppError('VALIDATION_ERROR', '字段 items 必须是数组');
        }
        return send(res, 200, checkBatch(body.items as CheckInput[]));
      }

      if (method === 'POST' && path === '/api/batch/failures') {
        const body = await readJson(req);
        if (!Array.isArray(body.items)) {
          throw new AppError('VALIDATION_ERROR', '字段 items 必须是数组');
        }
        const level = body.level === 'AAA' ? 'AAA' : 'AA';
        const textType = body.textType === 'large' ? 'large' : 'normal';
        const outcome = checkBatch(body.items as CheckInput[]);
        return send(res, 200, { level, textType, failures: filterFailures(outcome, level, textType) });
      }

      // 命名配色集合
      const paletteMatch = path.match(/^\/api\/palettes\/([^/]+)$/);
      if (method === 'POST' && paletteMatch) {
        const name = decodeURIComponent(paletteMatch[1]!);
        const body = await readJson(req);
        const saved = store.saveVersion(name, toCheckInput(body));
        return send(res, 200, {
          palette: name,
          isNewVersion: saved.isNewVersion,
          changedFrom: saved.changedFrom,
          record: JSON.parse(saved.record.result_json),
          version: saved.record.version,
        });
      }
      if (method === 'GET' && path === '/api/palettes') {
        return send(res, 200, { palettes: store.listPalettes() });
      }
      const versionsMatch = path.match(/^\/api\/palettes\/([^/]+)\/versions$/);
      if (method === 'GET' && versionsMatch) {
        const name = decodeURIComponent(versionsMatch[1]!);
        const versions = store.listVersions(name);
        if (versions.length === 0) {
          throw new AppError('PALETTE_NOT_FOUND', `配色集合不存在：${name}`, { name });
        }
        return send(res, 200, { palette: name, versions });
      }
      const versionMatch = path.match(/^\/api\/palettes\/([^/]+)\/versions\/(\d+)$/);
      if (method === 'GET' && versionMatch) {
        const name = decodeURIComponent(versionMatch[1]!);
        const v = Number(versionMatch[2]);
        const rec = store.getVersion(name, v);
        if (!rec) throw new AppError('VERSION_NOT_FOUND', `版本不存在：${name} v${v}`);
        return send(res, 200, { ...rec, result: JSON.parse(rec.result_json) });
      }
      const compareMatch = path.match(/^\/api\/palettes\/([^/]+)\/compare$/);
      if (method === 'GET' && compareMatch) {
        const name = decodeURIComponent(compareMatch[1]!);
        const a = Number(url.searchParams.get('a'));
        const b = Number(url.searchParams.get('b'));
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          throw new AppError('VALIDATION_ERROR', '比较参数 a、b 必须为整数版本号');
        }
        const cmp = store.compareVersions(name, a, b);
        if (!cmp) throw new AppError('VERSION_NOT_FOUND', `版本不存在：${name} v${a} 或 v${b}`);
        return send(res, 200, {
          palette: name,
          a: { version: cmp.a.version, ratio: cmp.a.ratio, colors: pickColors(cmp.a) },
          b: { version: cmp.b.version, ratio: cmp.b.ratio, colors: pickColors(cmp.b) },
          ratioDelta: cmp.ratioDelta,
        });
      }

      send(res, 404, errorBody('RECORD_NOT_FOUND', `无此路由：${method} ${path}`));
    } catch (err) {
      if (err instanceof AppError) {
        return send(res, HTTP_STATUS[err.code], errorBody(err.code, err.message, err.details));
      }
      send(res, 500, errorBody('VALIDATION_ERROR', err instanceof Error ? err.message : String(err)));
    }
  });
}

function pickColors(r: { foreground: string; background: string; canvas: string; category: string }) {
  return { foreground: r.foreground, background: r.background, canvas: r.canvas, category: r.category };
}

async function main(): Promise<void> {
  const requested = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = requested ?? (await pickFreePort());
  const dbPath = process.env.WCAG_DB ?? join(process.cwd(), 'data', 'wcag.db');
  const store = new Store(dbPath);
  const server = createApp(store);
  server.listen(port, '127.0.0.1', () => {
    console.log(`WCAG 对比度核验服务已启动: http://127.0.0.1:${port}`);
    console.log(`数据文件: ${dbPath}`);
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
