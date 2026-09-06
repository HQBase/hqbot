import type { ComputerApproval } from "../../../domain/computer-review";
import { ApprovalCard } from "./approval-card";

export function ComputerApprovalCard({
  approval,
  name,
  disabled,
  pending,
  onApprove,
  onDeny
}: {
  approval: ComputerApproval;
  name?: string;
  disabled?: boolean;
  pending: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const review = approval.review;
  return (
    <ApprovalCard
      title={review?.title ?? "Review computer action"}
      description={`${name ? `${name}: ` : ""}${review?.reason ?? "Review the requested action before continuing."}`}
      details={
        review?.details ?? "The action description is loading. Refresh if it does not appear."
      }
      technicalDetails={JSON.stringify({ action: approval.action, input: approval.input }, null, 2)}
      disabled={disabled}
      approveDisabled={Boolean(review?.unavailable)}
      pending={pending}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
