import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BlobServiceClient } from '@azure/storage-blob';
import { randomUUID } from 'crypto';
import pool from '../db.js';

interface CompanyStorage {
  storage_provider: string | null;
  storage_bucket: string;
  storage_region: string;
  storage_access_key: string;
  storage_secret_key: string;
  storage_azure_connection: string;
}

async function getCompanyStorage(companyId: number, userId?: number): Promise<CompanyStorage> {
  // Try company-level storage first
  const { rows } = await pool.query(
    'SELECT storage_provider, storage_bucket, storage_region, storage_access_key, storage_secret_key, storage_azure_connection FROM companies WHERE id = $1',
    [companyId]
  );
  if (rows[0]?.storage_provider) return rows[0];

  // Fallback: user-level storage (General users and App Admins configure storage on their own account)
  if (userId) {
    const { rows: uRows } = await pool.query(
      'SELECT storage_provider, storage_bucket, storage_region, storage_access_key, storage_secret_key, storage_azure_connection FROM users WHERE id = $1',
      [userId]
    );
    if (uRows[0]?.storage_provider) return uRows[0];
  }

  throw new Error('No cloud storage configured. Please configure storage in Settings → Storage.');
}

export async function uploadFile(
  companyId: number,
  projectId: number,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  userId?: number
): Promise<string> {
  const co = await getCompanyStorage(companyId, userId);
  const key = `projects/${projectId}/${randomUUID()}-${fileName}`;

  if (co.storage_provider === 's3') {
    const client = new S3Client({
      region: co.storage_region || 'us-east-1',
      credentials: { accessKeyId: co.storage_access_key, secretAccessKey: co.storage_secret_key },
    });
    await client.send(new PutObjectCommand({ Bucket: co.storage_bucket, Key: key, Body: buffer, ContentType: mimeType }));
    return key;
  }

  if (co.storage_provider === 'azure') {
    const blobServiceClient = BlobServiceClient.fromConnectionString(co.storage_azure_connection);
    const containerClient = blobServiceClient.getContainerClient(co.storage_bucket);
    const blockBlobClient = containerClient.getBlockBlobClient(key);
    await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
    return key;
  }

  throw new Error('Company has no cloud storage configured');
}

export async function getSignedUrl(
  companyId: number,
  storageKey: string,
  expiresInSeconds = 3600,
  userId?: number
): Promise<string> {
  const co = await getCompanyStorage(companyId, userId);

  if (co.storage_provider === 's3') {
    const client = new S3Client({
      region: co.storage_region || 'us-east-1',
      credentials: { accessKeyId: co.storage_access_key, secretAccessKey: co.storage_secret_key },
    });
    const cmd = new GetObjectCommand({ Bucket: co.storage_bucket, Key: storageKey });
    return s3GetSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
  }

  if (co.storage_provider === 'azure') {
    const blobServiceClient = BlobServiceClient.fromConnectionString(co.storage_azure_connection);
    const containerClient = blobServiceClient.getContainerClient(co.storage_bucket);
    const blockBlobClient = containerClient.getBlockBlobClient(storageKey);
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);
    return blockBlobClient.generateSasUrl({ permissions: { read: true } as any, expiresOn });
  }

  throw new Error('Company has no cloud storage configured');
}

export async function getPresignedUploadUrl(
  companyId: number,
  projectId: number,
  fileName: string,
  mimeType: string,
  userId?: number
): Promise<{ uploadUrl: string; storageKey: string; method: 'PUT' }> {
  const co = await getCompanyStorage(companyId, userId);
  const key = `projects/${projectId}/${randomUUID()}-${fileName}`;

  if (co.storage_provider === 's3') {
    const client = new S3Client({
      region: co.storage_region || 'us-east-1',
      credentials: { accessKeyId: co.storage_access_key, secretAccessKey: co.storage_secret_key },
    });
    const cmd = new PutObjectCommand({ Bucket: co.storage_bucket, Key: key, ContentType: mimeType });
    const uploadUrl = await s3GetSignedUrl(client, cmd, { expiresIn: 900 });
    return { uploadUrl, storageKey: key, method: 'PUT' };
  }

  if (co.storage_provider === 'azure') {
    const blobServiceClient = BlobServiceClient.fromConnectionString(co.storage_azure_connection);
    const containerClient = blobServiceClient.getContainerClient(co.storage_bucket);
    const blockBlobClient = containerClient.getBlockBlobClient(key);
    const expiresOn = new Date(Date.now() + 900_000);
    const uploadUrl = await blockBlobClient.generateSasUrl({
      permissions: { write: true, create: true } as any,
      expiresOn,
      contentType: mimeType,
    });
    return { uploadUrl, storageKey: key, method: 'PUT' };
  }

  throw new Error('Company has no cloud storage configured');
}

export async function testStorageConnection(
  companyId: number,
  userId?: number
): Promise<{ ok: boolean; provider: string; bucket: string; error?: string }> {
  let co: CompanyStorage;
  try {
    co = await getCompanyStorage(companyId, userId);
  } catch (e: any) {
    return { ok: false, provider: 'none', bucket: '', error: e.message };
  }

  const provider = co.storage_provider ?? 'none';
  const bucket = co.storage_bucket ?? '';

  try {
    if (co.storage_provider === 's3') {
      const client = new S3Client({
        region: co.storage_region || 'us-east-1',
        credentials: { accessKeyId: co.storage_access_key, secretAccessKey: co.storage_secret_key },
      });
      await client.send(new HeadBucketCommand({ Bucket: co.storage_bucket }));
      return { ok: true, provider, bucket };
    }

    if (co.storage_provider === 'azure') {
      const blobServiceClient = BlobServiceClient.fromConnectionString(co.storage_azure_connection);
      const containerClient = blobServiceClient.getContainerClient(co.storage_bucket);
      const exists = await containerClient.exists();
      if (!exists) return { ok: false, provider, bucket, error: 'Container not found' };
      return { ok: true, provider, bucket };
    }

    return { ok: false, provider, bucket, error: 'No storage provider configured' };
  } catch (e: any) {
    return { ok: false, provider, bucket, error: e.message };
  }
}

export async function deleteFile(companyId: number, storageKey: string, userId?: number): Promise<void> {
  const co = await getCompanyStorage(companyId, userId);

  if (co.storage_provider === 's3') {
    const client = new S3Client({
      region: co.storage_region || 'us-east-1',
      credentials: { accessKeyId: co.storage_access_key, secretAccessKey: co.storage_secret_key },
    });
    await client.send(new DeleteObjectCommand({ Bucket: co.storage_bucket, Key: storageKey }));
    return;
  }

  if (co.storage_provider === 'azure') {
    const blobServiceClient = BlobServiceClient.fromConnectionString(co.storage_azure_connection);
    const containerClient = blobServiceClient.getContainerClient(co.storage_bucket);
    await containerClient.deleteBlob(storageKey);
    return;
  }

  throw new Error('Company has no cloud storage configured');
}
