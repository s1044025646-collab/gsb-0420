import { createServer } from 'node:net';
import { join } from 'node:path';
import { createApp } from './app';
import { Store } from '../db/store';

/** 请求一个空闲端口（端口 0 让操作系统分配）。 */
export function pickFreePort(preferred = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(preferred, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferred;
      probe.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  const argPort = process.argv.find((a) => a.startsWith('--port='));
  const requestedPort = argPort ? Number(argPort.split('=')[1]) : NaN;
  const envPort = process.env.PORT ? Number(process.env.PORT) : NaN;
  const preferred = Number.isFinite(requestedPort)
    ? requestedPort
    : Number.isFinite(envPort)
      ? envPort
      : 0;

  const port = await pickFreePort(preferred);
  const dbPath = process.env.WCAG_DB ?? join(process.cwd(), 'data', 'wcag.sqlite');
  const store = new Store(dbPath);
  const app = createApp(store);

  app.listen(port, '127.0.0.1', () => {
    process.stdout.write(`WCAG 对比度核验服务已启动\n`);
    process.stdout.write(`地址: http://127.0.0.1:${port}\n`);
    process.stdout.write(`数据库: ${dbPath}\n`);
    process.stdout.write(`健康检查: GET http://127.0.0.1:${port}/health\n`);
  });

  const shutdown = (): void => {
    app.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`启动失败: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
