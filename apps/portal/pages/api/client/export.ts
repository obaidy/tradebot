import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { uploadCsvExport } from '../../../lib/exporter';

function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (value: string | number | null) => {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    return /[",\n]/.test(str) ? `"${str}"` : str;
  };
  const csvRows = [headers.map(escape).join(',')];
  for (const row of rows) {
    csvRows.push(row.map(escape).join(','));
  }
  return csvRows.join('\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const payload = req.body as {
      dataset: string;
      headers: string[];
      rows: Array<Array<string | number | null>>;
    };
    if (!payload || !payload.headers || !Array.isArray(payload.rows)) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const csv = toCsv(payload.headers, payload.rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${session.user.id}/${payload.dataset}-${timestamp}.csv`;
    const upload = await uploadCsvExport(key, csv);
    if (upload.url) {
      res.status(200).json({ url: upload.url, location: upload.location });
      return;
    }
    res.status(200).json({ inline: Buffer.from(csv).toString('base64'), location: 'inline' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'export_failed' });
  }
}
