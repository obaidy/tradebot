import http from 'http';
import { Telegram } from '../alerts/telegram';

class KillSwitch {
  private active = false;
  private reason: string | null = null;

  isActive() {
    return this.active;
  }

  getReason() {
    return this.reason;
  }

  async activate(reason: string) {
    if (this.active) return;
    this.active = true;
    this.reason = reason;
    await Telegram.sendMessage(`KILL SWITCH ACTIVATED: ${reason}`).catch(() => {});
  }

  async reset(reason = 'manual reset') {
    if (!this.active) return;
    this.active = false;
    this.reason = null;
    await Telegram.sendMessage(`Kill switch reset: ${reason}`).catch(() => {});
  }
}

export const killSwitch = new KillSwitch();

export function startKillSwitchServer(port = Number(process.env.KILL_SWITCH_PORT || 9101)) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/kill') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        const reason = body || 'manual';
        await killSwitch.activate(reason);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'killed', reason }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/reset') {
      await killSwitch.reset('manual reset');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'reset' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          active: killSwitch.isActive(),
          reason: killSwitch.getReason(),
        })
      );
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Kill switch server listening on :${port}`);
  });
}
