import { PiChatCircle, PiCopy, PiUsers } from "react-icons/pi";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function NewConversationDialog({
  onClose,
  onTeammate,
  onGroup,
  onTemplate,
  canGroup
}: {
  onClose: () => void;
  onTeammate: () => void;
  onGroup: () => void;
  onTemplate: () => void;
  canGroup: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Start with one teammate or bring a group together.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button className="justify-start" variant="outline" onClick={onTeammate}>
            <PiChatCircle data-icon="inline-start" /> New teammate
          </Button>
          <Button
            className="justify-start"
            variant="outline"
            disabled={!canGroup}
            onClick={onGroup}
          >
            <PiUsers data-icon="inline-start" /> New group
          </Button>
          <Button className="justify-start" variant="ghost" onClick={onTemplate}>
            <PiCopy data-icon="inline-start" /> Use a template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
