import type { BotTeammate } from "../../../domain/types";
import { AutomationEditor } from "../automations/automation-editor";

export function RoutineDialog({
  bot,
  open,
  onChanged,
  onOpenChange
}: {
  bot: BotTeammate;
  open: boolean;
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return open ? (
    <AutomationEditor
      bots={[bot]}
      initialBotId={bot.id}
      onClose={() => onOpenChange(false)}
      onSaved={onChanged}
    />
  ) : null;
}
