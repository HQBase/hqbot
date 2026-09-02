import { PiArrowUp, PiShieldCheck } from "react-icons/pi";

import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";

export function ApprovalCard({
  approveLabel = "Approve",
  description = "This connected-service tool can change remote data.",
  denyLabel = "Deny",
  details,
  pending,
  title = "Approve this action?",
  onApprove,
  onDeny
}: {
  approveLabel?: string;
  description?: string;
  denyLabel?: string;
  details?: string | null;
  pending: boolean;
  title?: string;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <Card className="ml-10 max-w-xl bg-card/80 shadow-none">
      <CardHeader className="flex-row items-start gap-3 p-4 pb-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-divider bg-reader">
          <PiShieldCheck />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-2">
        {details ? (
          <section
            aria-label="Action details"
            className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-divider bg-reader p-3 text-sm leading-6"
          >
            {details}
          </section>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button disabled={pending} size="sm" type="button" variant="outline" onClick={onDeny}>
            {denyLabel}
          </Button>
          <Button disabled={pending} size="sm" type="button" onClick={onApprove}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PiArrowUp data-icon="inline-start" />
            )}
            {approveLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
