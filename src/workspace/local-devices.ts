import { z } from "zod";
import {
  type LocalDevice,
  type LocalJob,
  localCommandInput,
  localResultInput
} from "../domain/local-devices";
import { now, type Row, type Sql, text } from "./sql";

export class WorkspaceLocalDevices {
  constructor(private readonly sql: Sql) {}
  list(botId?: string): LocalDevice[] {
    return this
      .sql<Row>`SELECT * FROM local_devices WHERE revoked_at IS NULL ORDER BY created_at DESC`
      .map((row) => ({
        id: text(row, "id"),
        name: text(row, "name"),
        botIds: this.sql<{
          bot_id: string;
        }>`SELECT bot_id FROM local_device_bots WHERE device_id=${text(row, "id")}`.map(
          (item) => item.bot_id
        ),
        createdAt: text(row, "created_at"),
        lastSeenAt: row.last_seen_at ? text(row, "last_seen_at") : null,
        revokedAt: null
      }))
      .filter((device) => !botId || device.botIds.includes(botId));
  }
  createPairing(hash: string, ids: string[]) {
    z.array(z.string().min(1).max(200)).min(1).max(12).parse(ids);
    for (const id of ids)
      if (!this.sql`SELECT id FROM bots WHERE id=${id} AND hidden=0`.length)
        throw new Error("Choose active teammates");
    const expiresAt = new Date(Date.now() + 600000).toISOString();
    this.sql`DELETE FROM local_pairings WHERE expires_at<=${now()} OR used_at IS NOT NULL`;
    if (this.sql`SELECT token_hash FROM local_pairings`.length >= 20)
      throw new Error("Use an existing pairing code first");
    this
      .sql`INSERT INTO local_pairings (token_hash,bots_json,expires_at) VALUES (${hash},${JSON.stringify([...new Set(ids)])},${expiresAt})`;
    return { expiresAt };
  }
  pair(codeHash: string, tokenHash: string, name: string) {
    z.string().trim().min(1).max(80).parse(name);
    const code = this
      .sql<Row>`SELECT * FROM local_pairings WHERE token_hash=${codeHash} AND expires_at>${now()} AND used_at IS NULL`[0];
    if (!code) throw new Error("Pairing code expired or was already used");
    if (this.list().length >= 20) throw new Error("Remove an old device before pairing another");
    const ids = JSON.parse(text(code, "bots_json")) as string[];
    for (const id of ids)
      if (!this.sql`SELECT id FROM bots WHERE id=${id} AND hidden=0`.length)
        throw new Error("A selected teammate is unavailable");
    const id = crypto.randomUUID();
    this
      .sql`INSERT INTO local_devices (id,name,token_hash,created_at) VALUES (${id},${name},${tokenHash},${now()})`;
    for (const botId of ids)
      this.sql`INSERT INTO local_device_bots (device_id,bot_id) VALUES (${id},${botId})`;
    this.sql`UPDATE local_pairings SET used_at=${now()} WHERE token_hash=${codeHash}`;
    return id;
  }
  identify(hash: string) {
    return (
      this.sql<{
        id: string;
      }>`SELECT id FROM local_devices WHERE token_hash=${hash} AND revoked_at IS NULL`[0]?.id ??
      null
    );
  }
  private job(row: Row): LocalJob {
    return {
      id: text(row, "id"),
      deviceId: text(row, "device_id"),
      botId: text(row, "bot_id"),
      taskId: row.task_id ? text(row, "task_id") : null,
      command: text(row, "command"),
      directory: text(row, "directory"),
      state: text(row, "state"),
      claimId: row.claim_id ? text(row, "claim_id") : null,
      result: row.result === null ? null : text(row, "result"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at")
    };
  }
  read(id: string) {
    const row = this.sql<Row>`SELECT * FROM local_jobs WHERE id=${id}`[0];
    return row ? this.job(row) : null;
  }
  resultAllowed(botId: string, id: string) {
    return (
      this
        .sql`SELECT id FROM local_jobs WHERE id=${id} AND bot_id=${botId} AND delivery_state IN ('queued','delivered')`
        .length > 0
    );
  }
  history() {
    return this.sql<Row>`SELECT * FROM local_jobs ORDER BY created_at DESC LIMIT 50`.map((row) =>
      this.job(row)
    );
  }
  queue(botId: string, taskId: string | null, id: string, value: unknown) {
    const input = localCommandInput.parse(value);
    z.string().min(1).max(300).parse(id);
    if (!this.list(botId).some((item) => item.id === input.deviceId))
      throw new Error("This device is not paired with the teammate");
    if (!this.sql`SELECT id FROM bots WHERE id=${botId} AND hidden=0`.length)
      throw new Error("The teammate is not active");
    const prior = this.read(id);
    if (prior) {
      if (
        prior.botId !== botId ||
        prior.deviceId !== input.deviceId ||
        prior.command !== input.command ||
        prior.directory !== input.directory
      )
        throw new Error("Command ID is already in use");
      return prior;
    }
    if (
      this
        .sql`SELECT id FROM local_jobs WHERE device_id=${input.deviceId} AND state IN ('queued','claimed','running')`
        .length >= 20
    )
      throw new Error("The device command queue is full");
    const stamp = now();
    this
      .sql`INSERT INTO local_jobs (id,device_id,bot_id,task_id,command,directory,state,created_at,updated_at) VALUES (${id},${input.deviceId},${botId},${taskId},${input.command},${input.directory},'queued',${stamp},${stamp})`;
    return this.read(id);
  }
  poll(deviceId: string) {
    this.sql`UPDATE local_devices SET last_seen_at=${now()} WHERE id=${deviceId}`;
    return this
      .sql<Row>`SELECT * FROM local_jobs WHERE device_id=${deviceId} AND state='queued' ORDER BY created_at LIMIT 1`.map(
      (row) => this.job(row)
    );
  }
  claim(deviceId: string, id: string, claimId: string) {
    z.uuid().parse(claimId);
    const job = this.read(id);
    if (!job || job.deviceId !== deviceId) throw new Error("Command not found");
    if (job.state === "claimed" && job.claimId === claimId) return job;
    if (job.state !== "queued") throw new Error("This command was already claimed or stopped");
    this
      .sql`UPDATE local_jobs SET state='claimed',claim_id=${claimId},updated_at=${now()} WHERE id=${id} AND state='queued'`;
    return this.read(id);
  }
  start(deviceId: string, id: string, claimId: string) {
    const job = this.read(id);
    if (!job || job.deviceId !== deviceId || job.claimId !== claimId || job.state !== "claimed")
      throw new Error("This command cannot start. Check its current state.");
    this.sql`UPDATE local_jobs SET state='running',updated_at=${now()} WHERE id=${id}`;
    return { started: true };
  }
  finish(deviceId: string, value: unknown) {
    const input = localResultInput.parse(value);
    const job = this.read(input.id);
    if (!job || job.deviceId !== deviceId || job.claimId !== input.claimId)
      throw new Error("Command receipt does not match");
    if (!["claimed", "running"].includes(job.state)) {
      if (job.state === input.state && job.result === input.result) return job;
      throw new Error("The command was stopped or already settled");
    }
    this
      .sql`UPDATE local_jobs SET state=${input.state},result=${input.result},delivery_state='queued',updated_at=${now()} WHERE id=${job.id}`;
    return this.read(job.id);
  }
  recovery() {
    const expired = new Date(Date.now() - 300000).toISOString();
    const queued = new Date(Date.now() - 86400000).toISOString();
    this
      .sql`UPDATE local_jobs SET state='uncertain',result='The device did not return an outcome. Check the local command before requesting it again.',delivery_state='queued',updated_at=${now()} WHERE state IN ('claimed','running') AND updated_at<${expired}`;
    this
      .sql`UPDATE local_jobs SET state='failed',result='The device did not accept this command within one day.',delivery_state='queued',updated_at=${now()} WHERE state='queued' AND created_at<${queued}`;
  }
  pendingResults() {
    return this
      .sql<Row>`SELECT * FROM local_jobs WHERE delivery_state='queued' ORDER BY updated_at LIMIT 20`.map(
      (row) => this.job(row)
    );
  }
  delivered(id: string) {
    this
      .sql`UPDATE local_jobs SET delivery_state='delivered' WHERE id=${id} AND delivery_state='queued'`;
  }
  cancelBot(botId: string) {
    this
      .sql`UPDATE local_jobs SET delivery_state='none' WHERE bot_id=${botId} AND delivery_state='queued'`;
    this
      .sql`UPDATE local_jobs SET state='cancelled',delivery_state='none',updated_at=${now()} WHERE bot_id=${botId} AND state IN ('queued','claimed','running')`;
  }
  revoke(id: string) {
    this.sql`UPDATE local_devices SET revoked_at=${now()} WHERE id=${id}`;
    this
      .sql`UPDATE local_jobs SET delivery_state='none' WHERE device_id=${id} AND delivery_state='queued'`;
    this
      .sql`UPDATE local_jobs SET state='cancelled',delivery_state='none',updated_at=${now()} WHERE device_id=${id} AND state IN ('queued','claimed','running')`;
  }
}
