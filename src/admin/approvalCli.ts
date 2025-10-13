#!/usr/bin/env ts-node

import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { TradeApprovalRepository } from '../db/tradeApprovalRepo';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import type { TradeApprovalRecord, TradeApprovalStatus } from '../db/tradeApprovalRepo';

function parseArgs(argv: string[]) {
  const tokens = [...argv];
  const command = tokens.shift() || 'list';
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) continue;
    const eqIndex = token.indexOf('=');
    if (eqIndex > 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      flags[key] = value;
    } else {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function requireFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value === 'string') return value;
  throw new Error(`Missing required flag --${key}`);
}

function optionalFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(`Trade Approval CLI\n\nUsage: npm run admin:approvals -- <command> [options]\n\nCommands:\n  list [--status <pending|approved|rejected>] [--client <client_id>] [--json]\n  approve --id <approval_id> [--actor <email>] [--note '<json>']\n  reject --id <approval_id> [--actor <email>] [--reason <text>]\n`);
}

function printTable(rows: TradeApprovalRecord[]) {
  const formatted = rows.map((row) => ({
    id: row.id,
    client: row.clientId,
    strategy: row.strategyId ?? '-',
    amountUsd: row.amountUsd ?? 0,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    approvals: row.approvedBy?.join(', ') ?? '-',
  }));
  // eslint-disable-next-line no-console
  console.table(formatted);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help' || args.flags.help) {
    printUsage();
    return;
  }

  const pool = getPool();
  try {
    await runMigrations(pool);
    const approvalsRepo = new TradeApprovalRepository(pool);
    const auditRepo = new ClientAuditLogRepository(pool);
    const actorDefault = process.env.APPROVAL_ACTOR_DEFAULT || 'cli-operator';

    if (args.command === 'list') {
      const status = (optionalFlag(args.flags, 'status') as TradeApprovalStatus | undefined) ?? 'pending';
      const clientId = optionalFlag(args.flags, 'client');
      const rows = await approvalsRepo.listByStatus(status, clientId);
      if (args.flags.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(rows, null, 2));
      } else if (rows.length) {
        printTable(rows);
      } else {
        // eslint-disable-next-line no-console
        console.log('No approvals found.');
      }
      return;
    }

    if (args.command === 'approve') {
      const id = Number(requireFlag(args.flags, 'id'));
      if (Number.isNaN(id)) {
        throw new Error('Approval id must be numeric');
      }
      const actor = optionalFlag(args.flags, 'actor') ?? actorDefault;
      const note = optionalFlag(args.flags, 'note');
      const metadataPatch = note ? { approval_note: note } : undefined;
      const record = await approvalsRepo.markApproved(id, actor, metadataPatch);
      await auditRepo.addEntry({
        clientId: record.clientId,
        actor,
        action: 'trade_approval_approved',
        metadata: {
          approvalId: record.id,
          amountUsd: record.amountUsd,
          correlationId: record.correlationId,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`Approval ${id} marked as approved.`);
      return;
    }

    if (args.command === 'reject') {
      const id = Number(requireFlag(args.flags, 'id'));
      if (Number.isNaN(id)) {
        throw new Error('Approval id must be numeric');
      }
      const actor = optionalFlag(args.flags, 'actor') ?? actorDefault;
      const reason = optionalFlag(args.flags, 'reason');
      const metadataPatch = reason ? { rejection_reason: reason } : undefined;
      const record = await approvalsRepo.markRejected(id, actor, metadataPatch);
      await auditRepo.addEntry({
        clientId: record.clientId,
        actor,
        action: 'trade_approval_rejected',
        metadata: {
          approvalId: record.id,
          reason,
          amountUsd: record.amountUsd,
          correlationId: record.correlationId,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`Approval ${id} rejected.`);
      return;
    }

    printUsage();
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
