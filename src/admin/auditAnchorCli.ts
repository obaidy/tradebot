#!/usr/bin/env ts-node

import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { AuditAnchorRepository } from '../db/auditAnchorRepo';
import crypto from 'crypto';

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eqIdx = token.indexOf('=');
    if (eqIdx > 0) {
      const key = token.slice(2, eqIdx);
      flags[key] = token.slice(eqIdx + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags[token.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      flags[token.slice(2)] = 'true';
    }
  }
  return flags;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeMerkleRoot(hashes: string[]): string {
  if (!hashes.length) {
    throw new Error('No hashes provided for merkle root');
  }
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      const combined = crypto.createHash('sha256').update(left + right).digest('hex');
      next.push(combined);
    }
    level = next;
  }
  return level[0];
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const targetDate = flags.date ? new Date(flags.date) : new Date();
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error('Invalid --date flag; expected YYYY-MM-DD');
  }
  const anchorDate = formatDate(targetDate);

  const pool = getPool();
  try {
    await runMigrations(pool);
    const auditRepo = new ClientAuditLogRepository(pool);
    const anchorRepo = new AuditAnchorRepository(pool);

    const hashes = await auditRepo.listHashesForDate(anchorDate);
    if (!hashes.length) {
      // eslint-disable-next-line no-console
      console.log(`No audit entries found for ${anchorDate}; nothing to anchor.`);
      return;
    }
    const root = computeMerkleRoot(hashes);
    const record = await anchorRepo.insert(anchorDate, root);
    // eslint-disable-next-line no-console
    console.log(`Anchored ${hashes.length} entries for ${anchorDate} with Merkle root ${record.merkleRoot}`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
