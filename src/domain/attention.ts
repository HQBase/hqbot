import type { IntegrationApproval } from "./actions";
import type { ComputerApproval } from "./computer-review";
export interface OwnerAttention {
  computerApprovals: ComputerApproval[];
  integrationApprovals: (IntegrationApproval & { connectorLabel?: string })[];
  handoff: { id: string; state: string; ownerControl: boolean; running: boolean } | null;
}
export interface ConversationAttentionItem extends OwnerAttention {
  botId: string;
  name: string;
  error?: string;
}
