import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const bucket = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || '';
const isR2 = Boolean(
  process.env.R2_BUCKET_NAME || process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT,
);
const endpoint =
  process.env.R2_ENDPOINT ||
  process.env.S3_ENDPOINT ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : '');
const accessKey = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '';
const secretKey = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
const requestedDriver = process.env.STORAGE_DRIVER || 'auto';
const s3Configured = Boolean(bucket && endpoint && accessKey && secretKey);
const driver =
  requestedDriver === 'local'
    ? 'local'
    : requestedDriver === 's3'
      ? 's3'
      : s3Configured
        ? 's3'
        : 'local';
const client =
  driver === 's3'
    ? new S3Client({
        region: isR2 ? 'auto' : process.env.S3_REGION || 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      })
    : null;

export function getStorageStatus() {
  return { driver, ready: requestedDriver !== 's3' || s3Configured, configured: s3Configured };
}

export async function persistUploadedFile(
  tempPath,
  { ownerId, workspaceId, originalName, mimeType },
) {
  if (driver === 'local') return tempPath;
  if (!client)
    throw new Error(
      'S3 storage is selected but the S3/R2 credentials or bucket configuration are incomplete.',
    );
  const extension = path.extname(originalName).toLowerCase().slice(0, 10);
  const key = `uploads/${String(ownerId)}/${String(workspaceId)}/${randomUUID()}${extension}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: await readFile(tempPath),
      ContentType: mimeType || 'application/octet-stream',
    }),
  );
  await unlink(tempPath).catch(() => {});
  return `s3://${bucket}/${key}`;
}

export async function deleteStoredFile(storagePath) {
  if (!storagePath) return;
  if (storagePath.startsWith('s3://')) {
    const [storedBucket, ...keyParts] = storagePath.slice(5).split('/');
    if (storedBucket && keyParts.length)
      await client.send(new DeleteObjectCommand({ Bucket: storedBucket, Key: keyParts.join('/') }));
    return;
  }
  await unlink(storagePath).catch(() => {});
}

export async function copyStoredFileToTemp(storagePath, destination) {
  if (storagePath.startsWith('s3://')) {
    const [storedBucket, ...keyParts] = storagePath.slice(5).split('/');
    if (!client || storedBucket !== bucket || !keyParts.length)
      throw new Error('Stored object is unavailable.');
    const result = await client.send(
      new GetObjectCommand({ Bucket: storedBucket, Key: keyParts.join('/') }),
    );
    if (!result.Body) throw new Error('Stored object has no content.');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(await result.Body.transformToByteArray()));
    return destination;
  }
  return storagePath;
}
