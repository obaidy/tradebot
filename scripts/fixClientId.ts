import { getPool, closePool } from '../src/db/pool';

const LEGACY_ID = 'google-oauth2|115250734175355998944';
const TARGET_ID = 'ahmed.obaidy12@gmail.com';

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updates: Array<{ table: string; rowCount: number }> = [];

    const tables = ['bot_runs', 'bot_guard_state', 'bot_inventory_snapshots'];
    for (const table of tables) {
      const result = await client.query(
        `UPDATE ${table}
         SET client_id = $1
         WHERE client_id = $2`,
        [TARGET_ID, LEGACY_ID]
      );
      updates.push({ table, rowCount: result.rowCount ?? 0 });
    }

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('[fixClientId] updated rows', updates);
  } catch (error) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('[fixClientId] failed', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[fixClientId] unexpected error', error);
  process.exit(1);
});
