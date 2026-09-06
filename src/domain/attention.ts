import type { IntegrationApproval } from "./actions";
export interface OwnerAttention {
  computerApprovals: { executionId: string; action: string; input: unknown; inputHash: string }[];
  integrationApprovals: (IntegrationApproval & { connectorLabel?: string })[];
  handoff: { id: string; state: string; ownerControl: boolean; running: boolean } | null;
}
export interface ConversationAttentionItem extends OwnerAttention {
  botId: string;
  name: string;
  error?: string;
}
