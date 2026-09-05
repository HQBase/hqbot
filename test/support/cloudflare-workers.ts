// Node-side adapter for the SDK facet storage tests. Production uses workerd.
export class DurableObject {
  constructor(
    protected ctx: unknown,
    protected env: unknown
  ) {}
}
export class WorkerEntrypoint {}
export class RpcTarget {}
