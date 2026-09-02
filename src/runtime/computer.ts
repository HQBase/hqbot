import type { Sandbox } from "@cloudflare/sandbox";
import { type ComputerControlLease, ComputerControlManager } from "./computer-control";
import { COMPUTER_LEASE_KEY, type ComputerLease, ComputerLeaseManager } from "./computer-lease";
import type {
  ComputerControlPayload,
  ComputerLeasePayload,
  ComputerRuntimeOptions,
  ComputerStatus
} from "./computer-types";
import {
  checkpointComputer,
  isComputerPrepared,
  openLinuxDesktop,
  restoreComputer,
  setLinuxDesktopOwnerControl,
  stopLinuxComputer,
  teammateSandbox
} from "./desktop";

const RUNNING_KEY = "hqbot:computer:running";
const STARTED_AT_KEY = "hqbot:computer:started-at";
const OWNER_CONTROL_KEY = "hqbot:computer:owner-control-until";
const CHECKPOINT_KEY = "hqbot:computer:checkpoint";
const OWNER_CONTROL_MS = 90_000;

export class TeammateComputer {
  private readonly controls: ComputerControlManager;
  private readonly leases: ComputerLeaseManager;
  private preparing: Promise<Sandbox> | null = null;

  constructor(private readonly options: ComputerRuntimeOptions) {
    this.leases = new ComputerLeaseManager({
      botId: options.botId,
      cancelSchedule: options.cancelSchedule,
      schedule: options.scheduleSleep,
      storage: options.storage,
      workspaceAgent: options.workspaceAgent
    });
    this.controls = new ComputerControlManager({
      cancelSchedule: options.cancelSchedule,
      key: OWNER_CONTROL_KEY,
      schedule: options.scheduleControl,
      storage: options.storage
    });
  }

  sandbox(): Sandbox {
    return teammateSandbox(this.options.env, this.options.botId);
  }

  acquire(input: { eventId: string; taskId: string | null }): Promise<Sandbox> {
    return this.controls.run(() => this.acquireNow(input));
  }

  private async acquireNow(input: { eventId: string; taskId: string | null }): Promise<Sandbox> {
    const sandbox = await this.prepare();
    try {
      await this.leases.touch(input);
    } catch (cause) {
      await this.stopNow();
      throw cause;
    }
    return sandbox;
  }

  open(input: { eventId: string; taskId: string | null }) {
    return this.controls.run(() => this.openNow(input));
  }

  private async openNow(input: { eventId: string; taskId: string | null }) {
    const sandbox = await this.acquireNow(input);
    try {
      return await openLinuxDesktop(sandbox, this.options.botId);
    } catch (cause) {
      await this.stopNow();
      throw cause;
    }
  }

  async setOwnerControl(active: boolean, renewOnly = false): Promise<ComputerStatus | null> {
    return this.controls.run(async () => {
      if (active) {
        if (!(await this.grantOwnerControl(renewOnly))) return null;
      } else await this.revokeOwnerControl(await this.controls.read());
      return this.statusNow();
    });
  }

  async assertModelControlAvailable(): Promise<void> {
    if (this.options.hasManagedProcess?.()) {
      throw new Error("A Bash process is running. Wait until it finishes.");
    }
    if (await this.controls.run(() => this.ownerHasControl())) {
      throw new Error("The owner is controlling this computer. Wait until they return control.");
    }
  }

  async status(): Promise<ComputerStatus> {
    return this.controls.run(() => this.statusNow());
  }

  private async statusNow(): Promise<ComputerStatus> {
    const checkpoint = await this.options.storage.get<{ updatedAt: string }>(CHECKPOINT_KEY);
    const running = Boolean(await this.options.storage.get<boolean>(RUNNING_KEY));
    const lease = await this.controls.read();
    const ownerControl = Boolean(
      running && lease?.state === "active" && lease.expiresAt > Date.now()
    );
    if (!running) {
      return {
        checkpointAt: checkpoint?.updatedAt ?? null,
        ownerControl,
        resources: null,
        running: false
      };
    }
    return {
      checkpointAt: checkpoint?.updatedAt ?? null,
      ownerControl,
      resources: null,
      running: true
    };
  }

  checkpoint(clean = false): Promise<void> {
    return this.controls.run(() => this.checkpointNow(clean));
  }

  private async checkpointNow(clean = false): Promise<void> {
    if (!(await this.options.storage.get<boolean>(RUNNING_KEY))) return;
    const result = await checkpointComputer(
      await this.prepare(),
      this.options.env.ARTIFACTS,
      this.options.botId,
      clean
    );
    await this.options.storage.put(CHECKPOINT_KEY, {
      size: result.size,
      updatedAt: new Date().toISOString()
    });
  }

  async stop(checkpoint = true, force = false): Promise<void> {
    return this.controls.run(() => this.stopNow(checkpoint, force));
  }

  private async stopNow(checkpoint = true, force = false): Promise<void> {
    if (this.options.hasManagedProcess?.() && !force) return;
    const running = Boolean(await this.options.storage.get<boolean>(RUNNING_KEY));
    if (!running && !force) return;
    const lease = await this.options.storage.get<ComputerLease>(COMPUTER_LEASE_KEY);
    let controlLease = await this.controls.read();
    if (controlLease?.state === "active") {
      controlLease = { ...controlLease, state: "revoking" };
      await this.options.storage.put(OWNER_CONTROL_KEY, controlLease);
    }
    if (controlLease && running) {
      try {
        await setLinuxDesktopOwnerControl(this.sandbox(), false);
      } catch (cause) {
        try {
          await stopLinuxComputer(this.sandbox());
        } catch {
          await this.controls.retryStop(controlLease).catch(() => undefined);
          throw cause;
        }
        await this.clearStoppedComputer(lease, controlLease);
        return;
      }
    }
    if (checkpoint && running) await this.checkpointNow(true).catch(() => undefined);
    try {
      await stopLinuxComputer(this.sandbox());
    } catch (cause) {
      if (controlLease) await this.controls.retryStop(controlLease).catch(() => undefined);
      else await this.leases.arm().catch(() => undefined);
      throw cause;
    }
    await this.clearStoppedComputer(lease, controlLease);
  }

  private async clearStoppedComputer(
    lease: ComputerLease | undefined,
    controlLease: ComputerControlLease | null
  ): Promise<void> {
    await this.options.storage.delete([
      RUNNING_KEY,
      STARTED_AT_KEY,
      COMPUTER_LEASE_KEY,
      OWNER_CONTROL_KEY
    ]);
    if (lease) await this.options.cancelSchedule(lease.scheduleId).catch(() => false);
    if (controlLease?.scheduleId)
      await this.options.cancelSchedule(controlLease.scheduleId).catch(() => false);
  }

  async settle(payload: ComputerLeasePayload): Promise<void> {
    return this.controls.run(async () => {
      const lease = await this.options.storage.get<ComputerLease>(COMPUTER_LEASE_KEY);
      if (!lease || lease.token !== payload.token) return;
      if (this.options.hasManagedProcess?.()) {
        try {
          await this.leases.touch({ eventId: `managed:${lease.token}`, taskId: null });
        } catch {
          await this.stopNow(false, true);
        }
        return;
      }
      if (await this.ownerHasControl()) {
        try {
          await this.leases.arm();
        } catch {
          await this.stopNow();
        }
        return;
      }
      await this.stopNow();
    });
  }

  async settleOwnerControl(payload: ComputerControlPayload): Promise<void> {
    return this.controls.run(async () => {
      const lease = await this.controls.read();
      if (!lease || lease.token !== payload.token) return;
      if (payload.stop) {
        await this.stopNow(false, true);
        return;
      }
      await this.revokeOwnerControl(lease, false);
    });
  }

  async recoveryCheckpoint(): Promise<void> {
    return this.controls.run(() => this.checkpointNow(false));
  }

  async reconcileOwnerControl(): Promise<void> {
    return this.controls.run(async () => {
      const lease = await this.controls.read();
      if (lease?.state === "revoking") {
        await this.stopNow(false, true);
        return;
      }
      if (!(await this.options.storage.get<boolean>(RUNNING_KEY))) {
        if (lease) await this.revokeOwnerControl(lease);
        return;
      }
      const sandbox = await this.prepare();
      await openLinuxDesktop(sandbox, this.options.botId);
      if (lease?.state === "active" && lease.expiresAt > Date.now()) {
        try {
          await setLinuxDesktopOwnerControl(sandbox, true);
        } catch (cause) {
          await this.revokeOwnerControl(lease);
          throw cause;
        }
        return;
      }
      await this.revokeOwnerControl(lease);
    });
  }

  private async prepare(): Promise<Sandbox> {
    const pending = this.preparing;
    if (pending !== null) return pending;
    this.preparing = this.prepareNow().finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }

  private async prepareNow(): Promise<Sandbox> {
    const sandbox = this.sandbox();
    try {
      await sandbox.setKeepAlive(true);
      if (!(await isComputerPrepared(sandbox))) {
        await restoreComputer(sandbox, this.options.env.ARTIFACTS, this.options.botId);
        await this.options.storage.put(STARTED_AT_KEY, Date.now());
      }
      await this.options.storage.put(RUNNING_KEY, true);
      if (!(await this.options.storage.get<number>(STARTED_AT_KEY))) {
        await this.options.storage.put(STARTED_AT_KEY, Date.now());
      }
      return sandbox;
    } catch (cause) {
      await this.stopNow(false, true).catch(() => undefined);
      throw cause;
    }
  }

  private async ownerHasControl(): Promise<boolean> {
    const lease = await this.controls.read();
    if (!lease) return false;
    if (lease.state === "active" && lease.expiresAt > Date.now()) return true;
    try {
      await this.revokeOwnerControl(lease);
      return false;
    } catch {
      return true;
    }
  }

  private async grantOwnerControl(renewOnly: boolean): Promise<boolean> {
    if (this.options.hasManagedProcess?.()) {
      throw new Error("Wait until the Bash process finishes before you give control.");
    }
    if (!(await this.options.storage.get<boolean>(RUNNING_KEY))) {
      if (renewOnly) return false;
      throw new Error("Open the computer before you take control");
    }
    const previous = await this.controls.read();
    if (renewOnly && (previous?.state !== "active" || previous.expiresAt <= Date.now())) {
      return false;
    }
    await this.leases.touch({ eventId: `owner:${Date.now()}`, taskId: null });
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + OWNER_CONTROL_MS;
    const schedule = await this.options.scheduleControl(new Date(expiresAt), { token });
    const lease: ComputerControlLease = {
      expiresAt,
      scheduleId: schedule.id,
      state: renewOnly ? "active" : "revoking",
      token
    };
    try {
      await this.options.storage.put(OWNER_CONTROL_KEY, lease);
    } catch (cause) {
      await this.options.cancelSchedule(schedule.id).catch(() => false);
      throw cause;
    }
    if (renewOnly) {
      if (previous?.scheduleId)
        await this.options.cancelSchedule(previous.scheduleId).catch(() => false);
      return true;
    }
    try {
      await this.sandbox().exec("pkill -TERM -f '[h]qbot-(browser|desktop)-control' || true", {
        timeout: 5_000
      });
      await setLinuxDesktopOwnerControl(this.sandbox(), true);
      await this.options.storage.put(OWNER_CONTROL_KEY, { ...lease, state: "active" });
    } catch (cause) {
      try {
        await this.revokeOwnerControl(lease);
      } finally {
        if (previous?.scheduleId)
          await this.options.cancelSchedule(previous.scheduleId).catch(() => false);
      }
      throw cause;
    }
    if (previous?.scheduleId)
      await this.options.cancelSchedule(previous.scheduleId).catch(() => false);
    return true;
  }

  private async revokeOwnerControl(
    lease: ComputerControlLease | null,
    cancelSchedule = true
  ): Promise<void> {
    const running = Boolean(await this.options.storage.get<boolean>(RUNNING_KEY));
    if (!running && !lease) return;
    const revoking: ComputerControlLease = lease
      ? { ...lease, state: "revoking" }
      : { expiresAt: 0, scheduleId: "", state: "revoking", token: crypto.randomUUID() };
    await this.options.storage.put(OWNER_CONTROL_KEY, revoking);
    try {
      if (running) await setLinuxDesktopOwnerControl(this.sandbox(), false);
      else await stopLinuxComputer(this.sandbox());
    } catch (cause) {
      try {
        await this.stopNow(false, true);
      } catch {
        throw cause;
      }
      return;
    }
    await this.options.storage.delete(OWNER_CONTROL_KEY);
    if (cancelSchedule && revoking.scheduleId) {
      await this.options.cancelSchedule(revoking.scheduleId).catch(() => false);
    }
  }
}
