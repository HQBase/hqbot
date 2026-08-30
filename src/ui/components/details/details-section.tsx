import { type ComponentType, type ReactNode, useId, useState } from "react";
import { PiCaretDown } from "react-icons/pi";

import { Badge } from "../ui/badge";

export function DetailsSection({
  badge,
  children,
  defaultOpen = false,
  icon: Icon,
  id,
  title
}: {
  badge?: number | string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon: ComponentType<{ className?: string }>;
  id?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const contentId = `${id ?? "details"}-${generatedId}`;

  return (
    <section className="border-b border-divider last:border-b-0" id={id}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 py-3 text-left text-sm font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="size-4 text-tertiary" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge !== undefined ? <Badge variant="outline">{badge}</Badge> : null}
        <PiCaretDown
          aria-hidden="true"
          className={`size-3.5 text-tertiary transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        id={contentId}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pb-4 pt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
