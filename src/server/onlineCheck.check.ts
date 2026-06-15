/**
 * Smoke test di onlineCheck — script autonomo, nessun framework.
 * Esegui: npx tsx src/server/onlineCheck.check.ts
 * Exit 0 = tutto verde, exit 1 = fallito.
 */
import { createServer } from 'node:http';
import { isOnline, waitUntilOnline } from './onlineCheck.js';

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  // Server di test: /ok → 200, /down → 522, /slow → 200 dopo che "il deploy si attiva"
  let slowReady = false;
  const srv = createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('ok'); return; }
    if (req.url === '/down') { res.writeHead(522); res.end('host error'); return; }
    if (req.url === '/slow') {
      if (slowReady) { res.writeHead(200); res.end('ok'); return; }
      res.writeHead(522); res.end('host error'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  // 1. URL che risponde 200 → online
  check('isOnline: 200 → online:true', (await isOnline(`${base}/ok`)).online === true);

  // 2. URL che risponde 522 (finestra Cloudflare) → non online
  const down = await isOnline(`${base}/down`);
  check('isOnline: 522 → online:false', down.online === false && down.status === 522);

  // 3. URL irraggiungibile / timeout → non online, nessun throw
  check('isOnline: porta chiusa → online:false', (await isOnline('http://127.0.0.1:1/', 1500)).online === false);

  // 4. waitUntilOnline: il sito si attiva durante il poll → true
  setTimeout(() => { slowReady = true; }, 700);
  check('waitUntilOnline: attivazione durante il poll → true',
    (await waitUntilOnline(`${base}/slow`, { maxMs: 5000, stepMs: 300 })) === true);

  // 5. waitUntilOnline: mai online entro il budget → false
  check('waitUntilOnline: budget esaurito → false',
    (await waitUntilOnline(`${base}/down`, { maxMs: 1200, stepMs: 300 })) === false);

  srv.close();
  console.log(failures === 0 ? 'onlineCheck: 5/5 verdi' : `onlineCheck: ${failures} falliti`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
