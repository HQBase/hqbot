import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceAuth } from "../../src/workspace/auth";
import type { Sql, SqlValue } from "../../src/workspace/sql";

function bind(value: SqlValue): SQLInputValue {
  return typeof value === "boolean" ? Number(value) : value;
}

function sqlFor(database: DatabaseSync): Sql {
  return ((strings: TemplateStringsArray, ...values: SqlValue[]) => {
    let statement = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      statement += `?${strings[index + 1] ?? ""}`;
    }
    return database.prepare(statement).all(...values.map(bind));
  }) as Sql;
}

describe("workspace owner authentication", () => {
  let database: DatabaseSync;
  let auth: WorkspaceAuth;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE owner (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, salt TEXT NOT NULL,
        password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE owner_sessions (
        token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE login_limits (
        key_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started_at TEXT NOT NULL,
        blocked_until TEXT, updated_at TEXT NOT NULL
      );
    `);
    auth = new WorkspaceAuth(sqlFor(database));
  });

  afterEach(() => database.close());

  it("limits repeated failures before another password derivation", async () => {
    await auth.bootstrap("owner", "correct horse battery staple");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.login("owner", "incorrect password value", "client-a")).resolves.toEqual({
        token: null,
        limited: false
      });
    }

    await expect(auth.login("owner", "correct horse battery staple", "client-a")).resolves.toEqual({
      token: null,
      limited: true
    });
    const otherClient = await auth.login("owner", "correct horse battery staple", "client-b");
    expect(otherClient.limited).toBe(false);
    expect(otherClient.token).toHaveLength(43);
  });

  it("stores only session and attempt hashes", async () => {
    const token = await auth.bootstrap("owner", "correct horse battery staple");
    await auth.login("owner", "incorrect password value", "hashed-client-address");

    expect(JSON.stringify(database.prepare("SELECT * FROM owner_sessions").all())).not.toContain(
      token
    );
    expect(database.prepare("SELECT key_hash FROM login_limits").all()).toEqual([
      { key_hash: "hashed-client-address" }
    ]);
  });

  it("does not let distributed failures lock out a correct login", async () => {
    await auth.bootstrap("owner", "correct horse battery staple");
    for (let client = 0; client < 60; client += 1) {
      await auth.login("owner", "incorrect password value", `client-${client}`);
    }

    const result = await auth.login("owner", "correct horse battery staple", "owner-client");

    expect(result.limited).toBe(false);
    expect(result.token).toHaveLength(43);
  });
});
