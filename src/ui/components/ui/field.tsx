import type * as React from "react";
import { PiInfo } from "react-icons/pi";
import { cn } from "../../lib/cn";
import { Label } from "./label";

export function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("flex w-full flex-col gap-5", className)} {...props} />;
}

export function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }): React.ReactElement {
  return (
    <div
      className={cn(
        "flex w-full gap-2",
        orientation === "horizontal" ? "flex-row items-start gap-3" : "flex-col",
        className
      )}
      data-slot="field"
      role="group"
      {...props}
    />
  );
}

export function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn("flex min-w-0 flex-col gap-4 disabled:opacity-60", className)}
      {...props}
    />
  );
}
export function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return <legend className={cn("mb-2 text-sm font-medium", className)} {...props} />;
}
export function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)} {...props} />;
}

export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>): React.ReactElement {
  return <Label className={cn("leading-snug", className)} data-slot="field-label" {...props} />;
}

export function FieldLabelRow({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex min-h-5 items-center justify-between gap-3 [&_[data-slot=field-error]]:ml-auto [&_[data-slot=field-error]]:max-w-[70%] [&_[data-slot=field-error]]:text-right",
        className
      )}
      data-slot="field-label-row"
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  children,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-pretty text-xs font-normal leading-4 text-muted-foreground [text-wrap:pretty]",
        className
      )}
      data-slot="field-description"
      {...props}
    >
      <PiInfo aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">): React.ReactElement {
  return (
    <p
      className={cn("text-xs font-normal leading-4 text-destructive", className)}
      data-slot="field-error"
      role="alert"
      {...props}
    />
  );
}
