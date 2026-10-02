import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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

async function getCompanyStorage(companyId: number): Promise<CompanyStorage> {
  const { rows } = await pool.query(
    'SELECT storage_provider, storage_bucket, storage_region, storage_access_key, storage_secret_key, storage_azure_connection FROM companies WHERE id = $1',
    [companyId]
  );
  if (!rows[0]) throw new Error('Company not found');
  return rows[0];
}

export async function uploadFile(
  companyId: number,
  projectId: number,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const co = await getCompanyStorage(companyId);
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
  expiresInSeconds = 3600
): Promise<string> {
  const co = await getCompanyStorage(companyId);

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

export async function deleteFile(companyId: number, storageKey: string): Promise<void> {
  const co = await getCompanyStorage(companyId);

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
