import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

export function Shimmer({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("hqbot-shimmer", className)} {...props} />;
}
