import pg from 'pg';

/**
 * The single Postgres pool for the API. Null when DATABASE_URL is unset —
 * read endpoints then fall back to the bundled sample, and write endpoints 400.
 */
export const pool: pg.Pool | null = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

/** Get the pool or throw a clear error — for endpoints that require persistence. */
export function db(): pg.Pool {
  if (!pool) throw new HttpError(503, 'no_database', 'DATABASE_URL is not configured');
  return pool;
}

/** Money crosses the API boundary in rupees; the DB stores paise. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number | string | null): number =>
  paise == null ? 0 : Number(paise) / 100;

/** An error with an HTTP status and a machine-readable code. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}
