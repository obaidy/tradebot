import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const bucket = process.env.EXPORT_BUCKET;
const region = process.env.EXPORT_REGION || process.env.AWS_REGION;
const exportsPrefix = process.env.EXPORT_PREFIX || 'exports';

let s3Client: S3Client | null = null;

function ensureClient() {
  if (!bucket) return null;
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

export async function uploadCsvExport(key: string, content: string): Promise<{ url?: string; location: string }> {
  const client = ensureClient();
  if (!client || !bucket) {
    return { location: 'inline' };
  }
  const objectKey = `${exportsPrefix}/${key}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: content,
      ContentType: 'text/csv',
      CacheControl: 'no-store',
    })
  );
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 60 * 10 });
  return { url, location: 's3://' + bucket + '/' + objectKey };
}
