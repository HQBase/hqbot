import { eventTriggerInput } from "../domain/events";
import { InboundEventError, verifyInboundEvent } from "../services/inbound-events";
import { WorkspaceAutomationsAgent } from "./automations-agent";
import { WorkspaceEvents } from "./events";

export class WorkspaceEventsAgent extends WorkspaceAutomationsAgent {
  private get events() {
    return new WorkspaceEvents(this.db);
  }
  listEventTriggers(routineId: string) {
    return this.events.list(routineId);
  }
  saveEventTrigger(input: unknown) {
    const result = this.ctx.storage.transactionSync(() =>
      this.events.save(eventTriggerInput.parse(input))
    );
    this.changed();
    return result;
  }
  deleteEventTrigger(id: string) {
    const deleted = this.events.remove(id);
    this.changed();
    return deleted;
  }
  eventTriggerHistory(id: string) {
    return this.events.history(id);
  }
  async receiveInboundEvent(
    id: string,
    raw: Uint8Array<ArrayBuffer>,
    headers: Record<string, string>
  ): Promise<{
    status: number;
    body: { error?: string; challenge?: string; state?: string; runId?: string };
  }> {
    try {
      const trigger = this.events.read(id);
      if (!trigger?.enabled) return { status: 404, body: { error: "Event trigger not found" } };
      const event = await verifyInboundEvent(
        trigger.filter,
        trigger.secret,
        raw,
        new Headers(headers)
      );
      if (event.challenge) return { status: 200, body: { challenge: event.challenge } };
      await this.wakeRoutines();
      const result = this.ctx.storage.transactionSync(() => this.events.accept(trigger, event));
      this.changed();
      return { status: 200, body: result };
    } catch (cause) {
      if (cause instanceof InboundEventError)
        return { status: cause.status, body: { error: cause.message } };
      const message = cause instanceof Error ? cause.message : "Event could not be accepted";
      return { status: message.includes("too many queued") ? 503 : 409, body: { error: message } };
    }
  }
}
