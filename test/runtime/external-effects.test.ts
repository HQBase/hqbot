import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeJson,
  ExternalEffectUncertainError,
  externalEffectKey,
  MAX_EXTERNAL_EFFECT_RESULT_BYTES,
  migrateExternalEffects,
  TeammateExternalEffects
} from "../../src/runtime/external-effects";
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

const identity = {
  executionId: "execution-1",
  connector: "mail",
  method: "send",
  args: { subject: "Hello", to: ["owner@example.com"] }
};

describe("external-effect receipts", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("creates its schema idempotently", () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);

    migrateExternalEffects(sql);
    migrateExternalEffects(sql);

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hqbot_external_effect_receipts'"
        )
        .get()
    ).toEqual({ name: "hqbot_external_effect_receipts" });
  });

  it("canonicalizes object keys recursively and creates a stable hash", async () => {
    expect(canonicalizeJson({ z: [{ b: 2, a: 1 }], a: true })).toBe(
      '{"a":true,"z":[{"a":1,"b":2}]}'
    );
    await expect(
      externalEffectKey({ ...identity, args: { to: ["owner@example.com"], subject: "Hello" } })
    ).resolves.toBe(await externalEffectKey(identity));
    await expect(externalEffectKey({ ...identity, method: "draft" })).resolves.not.toBe(
      await externalEffectKey(identity)
    );
  });

  it("marks the action uncertain before the call and returns the cached result", async () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateExternalEffects(sql);
    const effects = new TeammateExternalEffects(sql);
    const key = await externalEffectKey(identity);
    const action = vi.fn(async () => {
      expect(effects.receipt(key)?.state).toBe("uncertain");
      return { messageId: "message-1", nested: { z: 2, a: 1 } };
    });

    await expect(effects.run(identity, action)).resolves.toEqual({
      messageId: "message-1",
      nested: { a: 1, z: 2 }
    });
    await expect(effects.run(identity, action)).resolves.toEqual({
      messageId: "message-1",
      nested: { a: 1, z: 2 }
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(effects.receipt(key)?.state).toBe("applied");
  });

  it("keeps a failed attempt uncertain and never invokes it again", async () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateExternalEffects(sql);
    const effects = new TeammateExternalEffects(sql);
    const action = vi.fn(async () => {
      throw new Error("secret provider error");
    });

    await expect(effects.run(identity, action)).rejects.toBeInstanceOf(
      ExternalEffectUncertainError
    );
    await expect(effects.run(identity, action)).rejects.toBeInstanceOf(
      ExternalEffectUncertainError
    );
    expect(action).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(database.prepare("SELECT * FROM hqbot_external_effect_receipts").all())
    ).not.toContain("owner@example.com");
    expect(
      JSON.stringify(database.prepare("SELECT * FROM hqbot_external_effect_receipts").all())
    ).not.toContain("secret provider error");
  });

  it("leaves an oversized result uncertain and blocks another attempt", async () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateExternalEffects(sql);
    const effects = new TeammateExternalEffects(sql);
    const action = vi.fn(async () => "x".repeat(MAX_EXTERNAL_EFFECT_RESULT_BYTES));

    await expect(effects.run(identity, action)).rejects.toBeInstanceOf(
      ExternalEffectUncertainError
    );
    await expect(effects.run(identity, action)).rejects.toBeInstanceOf(
      ExternalEffectUncertainError
    );
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cleans settled executions but keeps uncertain receipts for review", async () => {
    database = new DatabaseSync(":memory:");
    const sql = sqlFor(database);
    migrateExternalEffects(sql);
    const effects = new TeammateExternalEffects(sql);
    await effects.run(identity, async () => ({ ok: true }));
    await expect(
      effects.run({ ...identity, method: "delete" }, async () => {
        throw new Error("unknown outcome");
      })
    ).rejects.toBeInstanceOf(ExternalEffectUncertainError);

    effects.deleteSettled(identity.executionId);

    expect(database.prepare("SELECT state FROM hqbot_external_effect_receipts").all()).toEqual([
      { state: "uncertain" }
    ]);
  });
});
