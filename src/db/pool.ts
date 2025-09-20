import { Pool } from 'pg';
import { CONFIG } from '../config';

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: CONFIG.PG_URL });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
