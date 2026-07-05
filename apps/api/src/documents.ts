// Document vault — agreements, maintenance bills, receipts, deeds. Files live
// in a PRIVATE S3 bucket; the DB keeps metadata + the storage key. Downloads
// stream through the API so household RBAC stays in charge — no public URLs.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { db, HttpError } from './pool.ts';

const REGION = process.env.NOTIFY_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const BUCKET = process.env.DOCS_BUCKET ?? '';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per document

export const DOC_KINDS = [
  'agreement', 'maintenance_bill', 'invoice',
  'sale_deed', 'title_deed', 'encumbrance_certificate', 'allotment_letter',
  'occupancy_certificate', 'tax_receipt', 'insurance', 'loan_schedule', 'other',
] as const;

const ALLOWED_CONTENT = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/;

// ---- storage abstraction (S3 in prod; injectable for tests) -----------------
export interface DocStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const creds = process.env.NOTIFY_ACCESS_KEY_ID && process.env.NOTIFY_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.NOTIFY_ACCESS_KEY_ID, secretAccessKey: process.env.NOTIFY_SECRET_ACCESS_KEY }
  : undefined;
const s3 = creds && BUCKET ? new S3Client({ region: REGION, credentials: creds }) : null;

const s3Storage: DocStorage = {
  async put(key, body, contentType) {
    if (!s3) throw new HttpError(503, 'vault_not_configured', 'Document storage is not configured');
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  },
  async get(key) {
    if (!s3) throw new HttpError(503, 'vault_not_configured', 'Document storage is not configured');
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  },
  async remove(key) {
    if (!s3) throw new HttpError(503, 'vault_not_configured', 'Document storage is not configured');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  },
};

let storage: DocStorage = s3Storage;
/** Test seam — swap S3 for an in-memory store. */
export function _setStorageForTests(s: DocStorage | null) { storage = s ?? s3Storage; }

// ---- rows -------------------------------------------------------------------
const docRow = (r: any) => ({
  id: r.id,
  assetId: r.asset_id ?? null,
  workOrderId: r.work_order_id ?? null,
  kind: r.document_type,
  filename: r.filename,
  size: r.size_bytes != null ? Number(r.size_bytes) : null,
  contentType: r.content_type ?? null,
  uploadedBy: r.uploaded_by ?? null,
  uploadedAt: r.uploaded_at,
});

function parseDataUrl(dataUrl: unknown): { buffer: Buffer; contentType: string } {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'invalid_input', 'dataUrl is required');
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) throw new HttpError(400, 'invalid_input', 'dataUrl must be a base64 data URL');
  const contentType = m[1];
  if (!ALLOWED_CONTENT.test(contentType)) {
    throw new HttpError(400, 'unsupported_type', 'Only PDF and image files are supported');
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw new HttpError(400, 'invalid_input', 'Empty file');
  if (buffer.length > MAX_BYTES) throw new HttpError(400, 'file_too_large', 'Documents are capped at 10MB');
  return { buffer, contentType };
}

/** Upload a document attached to an asset (and optionally a work order). */
export async function uploadDocument(assetId: string, body: any, uploadedBy: string | null) {
  const a = await db().query(`SELECT household_id FROM assets WHERE id = $1`, [assetId]);
  if (!a.rows[0]) throw new HttpError(404, 'asset_not_found');
  const householdId = a.rows[0].household_id;

  const kind = DOC_KINDS.includes(body.kind) ? body.kind : 'other';
  const filename = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'document').slice(0, 200);
  const { buffer, contentType } = parseDataUrl(body.dataUrl);

  let workOrderId: string | null = null;
  if (typeof body.workOrderId === 'string' && body.workOrderId) {
    const wo = await db().query(`SELECT 1 FROM work_orders WHERE id = $1 AND household_id = $2`, [body.workOrderId, householdId]);
    if (!wo.rowCount) throw new HttpError(400, 'invalid_input', 'That work order is not in this household');
    workOrderId = body.workOrderId;
  }

  const { rows } = await db().query(
    `INSERT INTO documents (asset_id, household_id, work_order_id, document_type, filename, storage_key, size_bytes, content_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8) RETURNING *`,
    [assetId, householdId, workOrderId, kind, filename, buffer.length, contentType, uploadedBy]
  );
  const doc = rows[0];
  const key = `households/${householdId}/assets/${assetId}/${doc.id}`;
  try {
    await storage.put(key, buffer, contentType);
  } catch (e) {
    await db().query(`DELETE FROM documents WHERE id = $1`, [doc.id]).catch(() => {});
    throw e;
  }
  await db().query(`UPDATE documents SET storage_key = $2 WHERE id = $1`, [doc.id, key]);
  return docRow({ ...doc, storage_key: key });
}

export async function listAssetDocuments(assetId: string) {
  const { rows } = await db().query(
    `SELECT * FROM documents WHERE asset_id = $1 ORDER BY uploaded_at DESC`, [assetId]);
  return rows.map(docRow);
}

export async function listWorkOrderDocuments(workOrderId: string) {
  const { rows } = await db().query(
    `SELECT * FROM documents WHERE work_order_id = $1 ORDER BY uploaded_at DESC`, [workOrderId]);
  return rows.map(docRow);
}

/** The file bytes + metadata for an authenticated streaming download. */
export async function getDocumentFile(id: string) {
  const { rows } = await db().query(`SELECT * FROM documents WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'document_not_found');
  const doc = rows[0];
  const buffer = await storage.get(doc.storage_key);
  return { buffer, contentType: doc.content_type ?? 'application/octet-stream', filename: doc.filename as string };
}

export async function deleteDocument(id: string) {
  const { rows } = await db().query(`DELETE FROM documents WHERE id = $1 RETURNING storage_key`, [id]);
  if (!rows[0]) throw new HttpError(404, 'document_not_found');
  await storage.remove(rows[0].storage_key).catch((e) => console.error(`[docs] S3 delete failed: ${e?.message}`));
}

/** Save server-generated content (e.g. a rent receipt) straight into the vault. */
export async function saveGenerated(assetId: string, householdId: string, kind: string, filename: string, html: string) {
  const buffer = Buffer.from(html, 'utf8');
  const { rows } = await db().query(
    `INSERT INTO documents (asset_id, household_id, document_type, filename, storage_key, size_bytes, content_type, uploaded_by)
     VALUES ($1,$2,$3,$4,'pending',$5,'text/html','system') RETURNING *`,
    [assetId, householdId, kind, filename.slice(0, 200), buffer.length]
  );
  const doc = rows[0];
  const key = `households/${householdId}/assets/${assetId}/${doc.id}`;
  await storage.put(key, buffer, 'text/html; charset=utf-8');
  await db().query(`UPDATE documents SET storage_key = $2 WHERE id = $1`, [doc.id, key]);
  return docRow({ ...doc, storage_key: key });
}
