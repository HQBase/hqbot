import type { ComponentProps, ReactNode } from "react";
import type { IconType } from "react-icons";
import { PiBrain, PiCaretDown, PiCircle } from "react-icons/pi";

import { cn } from "../../lib/cn";

export type ChainOfThoughtProps = ComponentProps<"details">;

export function ChainOfThought({ className, children, ...props }: ChainOfThoughtProps): ReactNode {
  return (
    <details
      className={cn(
        "group/activity not-prose w-full overflow-hidden rounded-2xl border border-divider bg-card/80 shadow-[0_1px_0_hsl(var(--foreground)/0.03),0_12px_34px_hsl(var(--foreground)/0.035)]",
        className
      )}
      {...props}
    >
      {children}
    </details>
  );
}

export type ChainOfThoughtHeaderProps = ComponentProps<"summary">;

export function ChainOfThoughtHeader({
  className,
  children,
  ...props
}: ChainOfThoughtHeaderProps): ReactNode {
  return (
    <summary
      className={cn(
        "flex min-h-12 w-full cursor-pointer list-none items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden",
        className
      )}
      {...props}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-divider bg-reader text-muted-foreground shadow-sm">
        <PiBrain className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">{children ?? "Agent activity"}</span>
      <PiCaretDown
        aria-hidden="true"
        className="size-3.5 shrink-0 text-tertiary transition-transform duration-200 group-open/activity:rotate-180"
      />
    </summary>
  );
}

export type ChainOfThoughtContentProps = ComponentProps<"div">;

export function ChainOfThoughtContent({
  className,
  children,
  ...props
}: ChainOfThoughtContentProps): ReactNode {
  return (
    <div
      className={cn(
        "hqbot-activity-content border-t border-divider bg-gradient-to-b from-muted/30 to-transparent px-4 py-4",
        className
      )}
      {...props}
    >
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: IconType;
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending";
};

const stepStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/55"
};

export function ChainOfThoughtStep({
  className,
  icon: Icon = PiCircle,
  label,
  description,
  status = "complete",
  children,
  ...props
}: ChainOfThoughtStepProps): ReactNode {
  return (
    <div className={cn("group/step flex gap-3 text-sm", stepStyles[status], className)} {...props}>
      <div className="relative flex w-5 shrink-0 justify-center">
        <span
          className={cn(
            "activity-step-icon relative z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border border-divider bg-reader",
            status === "active" &&
              "border-foreground/20 shadow-[0_0_0_4px_hsl(var(--foreground)/0.04)]"
          )}
        >
          <Icon className="size-3" />
        </span>
        <span
          aria-hidden="true"
          className="absolute bottom-[-1rem] top-6 w-px bg-divider group-last/step:hidden"
        />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex min-h-5 items-start justify-between gap-3 font-medium text-foreground">
          {label}
        </div>
        {description ? (
          <div className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  );
}
