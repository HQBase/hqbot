import { now, type Sql } from "./sql";

const PASSWORD_ITERATIONS = 210_000;
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS = 15 * 60 * 1_000;
const PER_CLIENT_FAILURES = 5;

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomToken(bytes: number): string {
  return encode(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encode(new Uint8Array(result));
}

async function derive(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations
    },
    key,
    256
  );
  return encode(new Uint8Array(bits));
}

function equal(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

interface OwnerRow extends Record<string, string | number | boolean | null> {
  username: string;
  salt: string;
  password_hash: string;
  iterations: number;
}

interface LoginLimitRow extends Record<string, string | number | boolean | null> {
  failures: number;
  window_started_at: string;
  blocked_until: string | null;
}

export interface OwnerLoginResult {
  token: string | null;
  limited: boolean;
}

export class WorkspaceAuth {
  constructor(private readonly sql: Sql) {}

  hasOwner(): boolean {
    return this.sql<{ id: string }>`SELECT id FROM owner WHERE id = 'owner'`.length > 0;
  }

  async bootstrap(username: string, password: string): Promise<string> {
    if (this.hasOwner()) throw new Error("HQBot already has an owner");
    const salt = randomToken(24);
    const passwordHash = await derive(password, salt, PASSWORD_ITERATIONS);
    const inserted = this.sql<{ id: string }>`INSERT OR IGNORE INTO owner (
      id, username, salt, password_hash, iterations, created_at
    ) VALUES (
      'owner', ${username}, ${salt}, ${passwordHash}, ${PASSWORD_ITERATIONS}, ${now()}
    ) RETURNING id`;
    if (inserted.length === 0) throw new Error("HQBot already has an owner");
    return this.createSession();
  }

  async login(username: string, password: string, attemptKey: string): Promise<OwnerLoginResult> {
    if (!this.canAttempt(attemptKey, PER_CLIENT_FAILURES)) {
      return { token: null, limited: true };
    }
    const owner = this.sql<OwnerRow>`SELECT username, salt, password_hash, iterations
      FROM owner WHERE id = 'owner'`[0];
    if (!owner) return { token: null, limited: false };
    const computed = await derive(password, owner.salt, owner.iterations);
    if (!equal(owner.username, username) || !equal(owner.password_hash, computed)) {
      this.recordFailure(attemptKey, PER_CLIENT_FAILURES);
      return { token: null, limited: false };
    }
    this.sql`DELETE FROM login_limits WHERE key_hash = ${attemptKey}`;
    return { token: await this.createSession(), limited: false };
  }

  async validateSession(token: string): Promise<boolean> {
    if (token.length < 32 || token.length > 256) return false;
    const tokenHash = await digest(token);
    const valid =
      this.sql<{ token_hash: string }>`SELECT token_hash FROM owner_sessions
      WHERE token_hash = ${tokenHash} AND expires_at > ${now()}`.length > 0;
    return valid;
  }

  async logout(token: string): Promise<void> {
    if (token.length < 32 || token.length > 256) return;
    const tokenHash = await digest(token);
    this.sql`DELETE FROM owner_sessions WHERE token_hash = ${tokenHash}`;
  }

  private async createSession(): Promise<string> {
    const token = randomToken(32);
    const tokenHash = await digest(token);
    const createdAt = now();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    this.sql`DELETE FROM owner_sessions WHERE expires_at <= ${createdAt}`;
    this.sql`INSERT INTO owner_sessions (token_hash, expires_at, created_at)
      VALUES (${tokenHash}, ${expiresAt}, ${createdAt})`;
    return token;
  }

  private canAttempt(key: string, failureLimit: number): boolean {
    const row = this.sql<LoginLimitRow>`SELECT failures, window_started_at, blocked_until
      FROM login_limits WHERE key_hash = ${key}`[0];
    if (!row) return true;
    const currentTime = Date.now();
    if (row.blocked_until && Date.parse(row.blocked_until) > currentTime) return false;
    if (Date.parse(row.window_started_at) + LOGIN_WINDOW_MS <= currentTime) {
      this.sql`DELETE FROM login_limits WHERE key_hash = ${key}`;
      return true;
    }
    return row.failures < failureLimit;
  }

  private recordFailure(key: string, failureLimit: number): void {
    const timestamp = now();
    const row = this.sql<LoginLimitRow>`SELECT failures, window_started_at, blocked_until
      FROM login_limits WHERE key_hash = ${key}`[0];
    const expired = !row || Date.parse(row.window_started_at) + LOGIN_WINDOW_MS <= Date.now();
    const failures = expired ? 1 : row.failures + 1;
    const windowStartedAt = expired ? timestamp : row.window_started_at;
    const blockedUntil =
      failures >= failureLimit
        ? new Date(Date.now() + LOGIN_BLOCK_MS).toISOString()
        : (row?.blocked_until ?? null);
    this.sql`INSERT INTO login_limits (
      key_hash, failures, window_started_at, blocked_until, updated_at
    ) VALUES (${key}, ${failures}, ${windowStartedAt}, ${blockedUntil}, ${timestamp})
    ON CONFLICT(key_hash) DO UPDATE SET failures = excluded.failures,
      window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at`;
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    this.sql`DELETE FROM login_limits WHERE updated_at < ${stale}`;
  }
}
