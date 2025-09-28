import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'src', 'strategies', 'mev-bot');
const destDir = join(process.cwd(), 'dist', 'strategies', 'mev-bot');

if (!existsSync(srcDir)) {
  process.exit(0);
}

cpSync(srcDir, destDir, { recursive: true });
const destNodeModules = join(destDir, 'node_modules');
rmSync(destNodeModules, { recursive: true, force: true });
console.log('[build] copied mev-bot assets to dist/strategies/mev-bot');
