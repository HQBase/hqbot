import { nullableText, type Row, type Sql, text } from "../workspace/sql";

export const MAX_EXTERNAL_EFFECT_RESULT_BYTES = 1024 * 1024;

export type ExternalEffectState = "prepared" | "uncertain" | "applied";

export interface ExternalEffectIdentity {
  executionId: string;
  connector: string;
  method: string;
  args: unknown;
}

export interface ExternalEffectReceipt {
  key: string;
  state: ExternalEffectState;
  createdAt: string;
  updatedAt: string;
}

export class ExternalEffectUncertainError extends Error {
  readonly effectKey: string;

  constructor(effectKey: string) {
    super("The external action may have completed. Automatic retry is blocked.");
    this.name = "ExternalEffectUncertainError";
    this.effectKey = effectKey;
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Value is not valid JSON");
  if (ancestors.has(value)) throw new TypeError("JSON value contains a cycle");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Value is not a plain JSON object");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredIdentityPart(name: string, value: string): string {
  if (value.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

export async function externalEffectKey(identity: ExternalEffectIdentity): Promise<string> {
  return sha256Hex(
    canonicalizeJson({
      args: identity.args,
      connector: requiredIdentityPart("connector", identity.connector),
      executionId: requiredIdentityPart("executionId", identity.executionId),
      method: requiredIdentityPart("method", identity.method)
    })
  );
}

export function migrateExternalEffects(sql: Sql): void {
  sql`CREATE TABLE IF NOT EXISTS hqbot_external_effect_receipts (
    effect_key TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared', 'uncertain', 'applied')),
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (state = 'applied' AND result_json IS NOT NULL) OR
      (state != 'applied' AND result_json IS NULL)
    )
  )`;
  sql`CREATE INDEX IF NOT EXISTS hqbot_external_effect_execution
    ON hqbot_external_effect_receipts (execution_id)`;
}

function receiptFromRow(row: Row): ExternalEffectReceipt {
  return {
    key: text(row, "effect_key"),
    state: text(row, "state") as ExternalEffectState,
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

export class TeammateExternalEffects {
  constructor(
    private readonly sql: Sql,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  receipt(key: string): ExternalEffectReceipt | null {
    const row = this.sql<Row>`SELECT effect_key, state, created_at, updated_at
      FROM hqbot_external_effect_receipts WHERE effect_key = ${key}`[0];
    return row ? receiptFromRow(row) : null;
  }

  async run<T>(identity: ExternalEffectIdentity, action: () => Promise<T>): Promise<T> {
    const key = await externalEffectKey(identity);
    const existing = this.sql<Row>`SELECT state, result_json
      FROM hqbot_external_effect_receipts WHERE effect_key = ${key}`[0];
    if (existing) {
      const state = text(existing, "state") as ExternalEffectState;
      if (state === "applied") {
        const stored = nullableText(existing, "result_json");
        if (stored === null) throw new Error("Invalid applied external-effect receipt");
        return JSON.parse(stored) as T;
      }
      if (state === "uncertain") throw new ExternalEffectUncertainError(key);
    }

    const preparedAt = this.now();
    if (!existing) {
      this.sql`INSERT INTO hqbot_external_effect_receipts (
        effect_key, execution_id, state, result_json, created_at, updated_at
      ) VALUES (
        ${key}, ${identity.executionId}, 'prepared', NULL, ${preparedAt}, ${preparedAt}
      )`;
    }

    const attemptedAt = this.now();
    this.sql`UPDATE hqbot_external_effect_receipts
      SET state = 'uncertain', updated_at = ${attemptedAt}
      WHERE effect_key = ${key} AND state = 'prepared'`;

    let result: T;
    try {
      result = await action();
    } catch {
      throw new ExternalEffectUncertainError(key);
    }

    let serialized: string;
    try {
      serialized = canonicalizeJson(result);
    } catch {
      throw new ExternalEffectUncertainError(key);
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_EXTERNAL_EFFECT_RESULT_BYTES) {
      throw new ExternalEffectUncertainError(key);
    }

    const appliedAt = this.now();
    this.sql`UPDATE hqbot_external_effect_receipts
      SET state = 'applied', result_json = ${serialized}, updated_at = ${appliedAt}
      WHERE effect_key = ${key} AND state = 'uncertain'`;
    return JSON.parse(serialized) as T;
  }

  deleteSettled(executionId: string): void {
    this.sql`DELETE FROM hqbot_external_effect_receipts
      WHERE execution_id = ${executionId} AND state IN ('prepared', 'applied')`;
  }
}
