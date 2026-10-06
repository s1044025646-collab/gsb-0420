import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { checkColors } from '../core/check';
import { checkBatch, filterFailures, MAX_BATCH } from '../core/batch';
import { Store } from '../db/store';
import { compareVersions, rowToReport } from '../core/versions';

interface Route {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown, params: string[]) => void;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp(store: Store): Server {
  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/health$/,
      handler: (_req, res) => send(res, 200, { ok: true, service: 'wcag-contrast-backend' }),
    },
    {
      method: 'POST',
      pattern: /^\/check$/,
      handler: (_req, res, body) => {
        const report = checkColors(body as never);
        send(res, report.ok ? 200 : 400, report);
      },
    },
    {
      method: 'POST',
      pattern: /^\/batch$/,
      handler: (_req, res, body) => {
        const entries = (body as { entries?: unknown[] }).entries;
        if (!entries) {
          return send(res, 400, {
            total: 0,
            accepted: 0,
            rejected: 0,
            results: [],
            error: { code: 'MISSING_ENTRIES', message: '批量请求需包含 entries 数组' },
          });
        }
        const result = checkBatch(entries as never);
        const status = result.error ? 400 : 200;
        send(res, status, { maxBatch: MAX_BATCH, ...result });
      },
    },
    {
      method: 'POST',
      pattern: /^\/batch\/failures$/,
      handler: (_req, res, body) => {
        const b = body as { entries?: unknown[]; level?: 'AA' | 'AAA'; category?: 'normal' | 'large' };
        if (!b.entries) {
          return send(res, 400, { error: { code: 'MISSING_ENTRIES', message: '批量请求需包含 entries 数组' } });
        }
        const result = checkBatch(b.entries as never);
        if (result.error) return send(res, 400, result);
        send(res, 200, {
          maxBatch: MAX_BATCH,
          total: result.total,
          failedCount: filterFailures(result, b.level, b.category).length,
          failures: filterFailures(result, b.level, b.category),
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/palettes$/,
      handler: (_req, res) => send(res, 200, { palettes: store.listPalettes() }),
    },
    {
      method: 'GET',
      pattern: /^\/palettes\/([^/]+)\/versions$/,
      handler: (_req, res, _body, params) => {
        const rows = store.listVersions(decodeURIComponent(params[0]));
        send(res, 200, { palette: decodeURIComponent(params[0]), versions: rows.map((r) => rowToReport(r).meta) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/palettes\/([^/]+)\/versions\/(\d+)$/,
      handler: (_req, res, _body, params) => {
        const row = store.getVersion(decodeURIComponent(params[0]), Number(params[1]));
        if (!row) return send(res, 404, { error: { code: 'VERSION_NOT_FOUND', message: '版本不存在' } });
        send(res, 200, rowToReport(row));
      },
    },
    {
      method: 'POST',
      pattern: /^\/palettes\/([^/]+)\/versions$/,
      handler: (_req, res, body, params) => {
        const palette = decodeURIComponent(params[0]);
        const b = body as {
          name?: string;
          foreground?: string;
          background?: string;
          canvas?: string;
          category?: 'normal' | 'large';
        };
        const report = checkColors(b as never);
        if (!report.ok) return send(res, 400, report);
        const saved = store.saveVersion(
          palette,
          b.name ?? 'default',
          { foreground: b.foreground!, background: b.background!, canvas: b.canvas!, category: report.category },
          report,
        );
        send(res, 201, { palette, ...saved, report });
      },
    },
    {
      method: 'GET',
      pattern: /^\/palettes\/([^/]+)\/compare\/(\d+)\.\.\.(\d+)$/,
      handler: (_req, res, _body, params) => {
        const palette = decodeURIComponent(params[0]);
        const a = store.getVersion(palette, Number(params[1]));
        const bRow = store.getVersion(palette, Number(params[2]));
        if (!a || !bRow) return send(res, 404, { error: { code: 'VERSION_NOT_FOUND', message: '版本不存在' } });
        send(res, 200, compareVersions(a, bRow));
      },
    },
    {
      method: 'GET',
      pattern: /^\/export$/,
      handler: (_req, res) => {
        const rows = store.listVersions();
        send(res, 200, { exportedAt: new Date().toISOString(), count: rows.length, versions: rows.map((r) => rowToReport(r).meta) });
      },
    },
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let body: unknown = {};
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch (e) {
        const code = (e as Error).message;
        return send(res, 400, {
          error: {
            code,
            message: code === 'INVALID_JSON' ? '请求体不是合法 JSON' : '请求体过大（上限 1MB）',
          },
        });
      }
    }
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) {
      return send(res, 404, { error: { code: 'NOT_FOUND', message: `无此路由：${req.method} ${url.pathname}` } });
    }
    const match = url.pathname.match(route.pattern)!;
    try {
      route.handler(req, res, body, match.slice(1));
    } catch (e) {
      send(res, 500, { error: { code: 'INTERNAL', message: (e as Error).message } });
    }
  });

  return server;
}
