import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp();
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`FlashCart API listening on :${cfg.port} (${cfg.nodeEnv})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
