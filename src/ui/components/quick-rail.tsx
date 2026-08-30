import type { ComponentType } from "react";
import { PiChatCircle, PiClock, PiCoin, PiMoon, PiRobot, PiSignOut, PiSun } from "react-icons/pi";

import { useTheme } from "../features/theme/theme-provider";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type RailAction = {
  icon: ComponentType;
  id: "costs" | "routines" | "teammates";
  label: string;
};

const actions: RailAction[] = [
  { icon: PiChatCircle, id: "teammates", label: "Teammates" },
  { icon: PiClock, id: "routines", label: "Schedules" },
  { icon: PiCoin, id: "costs", label: "Costs" }
];

export function QuickRail({
  onLogout,
  onNavigate
}: {
  onLogout: () => void;
  onNavigate: (section: "costs" | "routines") => void;
}) {
  const { setTheme, theme } = useTheme();
  return (
    <TooltipProvider delayDuration={250}>
      <nav
        aria-label="Quick access"
        className="flex w-12 shrink-0 flex-col items-center py-2 pr-2 pl-1"
      >
        <span
          className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
          title="HQBot"
        >
          <PiRobot aria-hidden="true" className="size-4" />
        </span>
        <div className="mt-5 flex flex-col gap-1">
          {actions.map(({ icon: Icon, id, label }, index) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  aria-current={index === 0 ? "page" : undefined}
                  aria-label={label}
                  className={
                    index === 0
                      ? "size-10 min-h-10 min-w-10 bg-selected text-foreground"
                      : "size-10 min-h-10 min-w-10 text-tertiary"
                  }
                  disabled={id === "teammates"}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => id !== "teammates" && onNavigate(id)}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={`Use ${theme === "dark" ? "light" : "dark"} appearance`}
                className="size-10 min-h-10 min-w-10 text-tertiary"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <PiSun /> : <PiMoon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Appearance</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Sign out"
                className="size-10 min-h-10 min-w-10 text-tertiary"
                size="icon"
                type="button"
                variant="ghost"
                onClick={onLogout}
              >
                <PiSignOut />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  );
}
