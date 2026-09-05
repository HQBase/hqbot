import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../../domain/projects";
import type { AuditEntry, Principal, TeamInvite, TeamUser } from "../../../domain/team";
import { api, errorMessage } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";

interface Administration {
  users: TeamUser[];
  invitations: TeamInvite[];
  audit: AuditEntry[];
  projects: Project[];
}
export function TeamAdministration({ user }: { user: Principal }) {
  const [data, setData] = useState<Administration | null>(null);
  const [edit, setEdit] = useState<TeamUser | "invite" | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<Administration>("/api/team/admin"));
    } catch (cause) {
      setError(errorMessage(cause, "Team access could not load"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">People and access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite people to selected projects. Keep control of tools and credentials with the
            owner.
          </p>
        </div>
        <Button disabled={!data} onClick={() => setEdit("invite")}>
          Invite person
        </Button>
      </div>
      {link && (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-medium">Invitation created</p>
          <Input readOnly aria-label="Invitation link" value={link} />
          <Button
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .catch(() => setError("Select and copy the link above."))
            }
          >
            Copy invitation
          </Button>
          <p className="text-xs text-muted-foreground">
            Share this privately. It expires in seven days and can be used once.
          </p>
        </div>
      )}
      {data?.users.map((member) => (
        <article
          key={member.id}
          className="flex items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div>
            <p className="font-medium">{member.username}</p>
            <p className="text-xs text-muted-foreground">
              {member.role} ·{" "}
              {member.disabled
                ? "Access disabled"
                : member.role === "admin"
                  ? "All projects"
                  : `${member.projectIds.length} projects`}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={member.id === user.id || (member.role === "admin" && user.role !== "owner")}
            onClick={() => setEdit(member)}
          >
            Edit access
          </Button>
        </article>
      ))}
      {data && !data.users.length && (
        <p className="text-sm text-muted-foreground">No team accounts yet.</p>
      )}
      {Boolean(data?.invitations.length) && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          {data?.invitations.map((invite) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
              key={invite.id}
            >
              <p className="text-sm">
                {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
              </p>
              <Button
                variant="ghost"
                disabled={invite.role === "admin" && user.role !== "owner"}
                onClick={async () => {
                  try {
                    await api(`/api/team/invitations/${invite.id}`, { method: "DELETE" });
                    setLink("");
                    await load();
                  } catch (cause) {
                    setError(errorMessage(cause, "The invitation could not be revoked"));
                  }
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">Recent access activity</summary>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {data?.audit.map((entry) => (
            <p className="text-xs text-muted-foreground" key={entry.id}>
              {new Date(entry.createdAt).toLocaleString()} ·{" "}
              {entry.actorId === "owner"
                ? "Owner"
                : (data.users.find((member) => member.id === entry.actorId)?.username ??
                  "Team member")}{" "}
              · {entry.action}
            </p>
          ))}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {edit && data && (
        <AccessEditor
          user={user}
          member={edit === "invite" ? undefined : edit}
          projects={data.projects}
          onClose={() => setEdit(null)}
          onSaved={(token) => {
            if (token) setLink(`${location.origin}/#invite=${encodeURIComponent(token)}`);
            void load();
            setEdit(null);
          }}
        />
      )}
    </section>
  );
}
function AccessEditor({
  user,
  member,
  projects,
  onClose,
  onSaved
}: {
  user: Principal;
  member?: TeamUser;
  projects: Project[];
  onClose: () => void;
  onSaved: (token?: string) => void;
}) {
  const [role, setRole] = useState(member?.role ?? "member");
  const [ids, setIds] = useState(member?.projectIds ?? []);
  const [disabled, setDisabled] = useState(member?.disabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token?: string }>(
        member ? `/api/team/members/${member.id}` : "/api/team/invitations",
        {
          method: member ? "PATCH" : "POST",
          body: JSON.stringify({ role, disabled, projectIds: ids })
        }
      );
      onSaved(result.token);
    } catch (cause) {
      setError(errorMessage(cause, "Access could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{member ? `Access for ${member.username}` : "Invite a person"}</DialogTitle>
        <DialogDescription>
          Project access includes the full conversation and files of every teammate in that project.
          Use separate teammates for confidential work.
        </DialogDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="team-role">Role</FieldLabel>
            <select
              id="team-role"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as TeamUser["role"])}
            >
              {user.role === "owner" && (
                <option value="admin">Administrator — all projects and team access</option>
              )}
              <option value="member">Member — read and request work</option>
              <option value="viewer">Viewer — read only</option>
            </select>
          </Field>
          <Field>
            <FieldLabel>Projects</FieldLabel>
            <div className="max-h-60 space-y-3 overflow-y-auto">
              {role === "admin" ? (
                <p className="text-sm text-muted-foreground">
                  Administrators can access all projects.
                </p>
              ) : (
                projects.map((project) => (
                  <label key={project.id} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={ids.includes(project.id)}
                      onChange={(event) =>
                        setIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id)
                        )
                      }
                    />
                    <span>{project.name}</span>
                  </label>
                ))
              )}
            </div>
          </Field>
          {member && (
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={disabled}
                onChange={(event) => setDisabled(event.target.checked)}
              />
              Disable account access
            </label>
          )}
        </FieldGroup>
        <p className="text-xs text-muted-foreground">
          Changes sign the person out. Tool approvals, credentials, and permission rules remain with
          the owner.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : member ? "Save access" : "Create invitation"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
