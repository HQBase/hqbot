export {};

declare global {
  interface Env {
    HQBOT_MODEL_ID: string;
    HQBOT_BOT_DAILY_BUDGET_USD: string;
    HQBOT_GLOBAL_DAILY_BUDGET_USD: string;
    HQBOT_TASK_BUDGET_USD: string;
    HQBOT_DAILY_TASK_LIMIT: string;
    HQBOT_SETUP_TOKEN: string;
    ARTIFACTS: R2Bucket;
    SANDBOX: DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox>;
  }
  declare class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
    constructor(length: number);
  }
}
