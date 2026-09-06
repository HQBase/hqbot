import type { ComputerPolicy, ComputerReview } from "../domain/computer-review";
import type { Sql } from "../workspace/sql";
import { type BrowserActionContext, browserTargetActions } from "./computer-action-context";
import { canonicalizeJson, sha256Hex } from "./external-effects";

export function migrateComputerSafety(sql: Sql, fresh: boolean) {
  sql`ALTER TABLE hqbot_computer_permissions RENAME TO hqbot_computer_permissions_v9`;
  sql`CREATE TABLE hqbot_computer_permissions (slot INTEGER PRIMARY KEY CHECK(slot = 1), mode TEXT NOT NULL CHECK(mode IN ('autonomous', 'review', 'allow')))`;
  sql`INSERT INTO hqbot_computer_permissions SELECT slot, mode FROM hqbot_computer_permissions_v9`;
  if (fresh) sql`UPDATE hqbot_computer_permissions SET mode = 'autonomous' WHERE slot = 1`;
  sql`DROP TABLE hqbot_computer_permissions_v9`;
  sql`CREATE TABLE hqbot_computer_reviews (id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, review_json TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0)`;
}
interface SavedReview {
  mode: ComputerPolicy;
  context: BrowserActionContext | null;
  view: ComputerReview;
}
export class ComputerSafety {
  private inFlight = new Map<string, Promise<SavedReview>>();
  constructor(
    private readonly sql: Sql,
    private readonly host: {
      inspect(input: Record<string, unknown>): Promise<BrowserActionContext>;
      classify(
        action: string,
        input: unknown,
        context: BrowserActionContext | null
      ): Promise<Pick<ComputerReview, "decision" | "title" | "reason">>;
      ownerHasControl(): Promise<boolean>;
    }
  ) {}
  async controlCheck(name: string, input: Record<string, unknown>) {
    if (
      name === "computer_session" &&
      input.action === "take_back" &&
      (await this.host.ownerHasControl())
    )
      throw new Error(
        "The owner still has the computer handoff. Wait for the Continue button; do not request approval to take control."
      );
  }
  async prepare(
    id: string,
    name: string,
    input: Record<string, unknown>,
    mode: ComputerPolicy
  ): Promise<SavedReview> {
    const inputHash = await sha256Hex(canonicalizeJson({ name, input }));
    const saved = this.sql<{
      input_hash: string;
      review_json: string;
    }>`SELECT input_hash, review_json FROM hqbot_computer_reviews WHERE id = ${id}`[0];
    if (saved && saved.input_hash !== inputHash) throw new Error("The computer request changed");
    if (saved) {
      const review = JSON.parse(saved.review_json) as SavedReview;
      if (review.mode === mode) return review;
    }
    const key = `${id}:${mode}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.assess(name, input, mode)
      .then((review) => {
        this
          .sql`INSERT INTO hqbot_computer_reviews (id, input_hash, review_json) VALUES (${id}, ${inputHash}, ${JSON.stringify(review)}) ON CONFLICT(id) DO UPDATE SET review_json = excluded.review_json, approved = 0`;
        return review;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
  async hash(input: unknown, review: SavedReview) {
    return sha256Hex(canonicalizeJson({ input, review }));
  }
  markApproved(id: string) {
    this.sql`UPDATE hqbot_computer_reviews SET approved = 1 WHERE id = ${id}`;
  }
  isApproved(id: string) {
    return Boolean(
      this.sql<{
        approved: number;
      }>`SELECT approved FROM hqbot_computer_reviews WHERE id = ${id}`[0]?.approved
    );
  }
  async validate(name: string, input: Record<string, unknown>, review: SavedReview) {
    await this.controlCheck(name, input);
    if (review.view.unavailable)
      throw new Error(
        "This request has no verified target. Deny it and ask the agent to inspect the page again."
      );
    if (
      review.context &&
      canonicalizeJson(await this.host.inspect(input)) !== canonicalizeJson(review.context)
    )
      throw new Error(
        "The page or target changed. Ask the agent to inspect it and make a fresh request."
      );
  }
  private async assess(
    name: string,
    input: Record<string, unknown>,
    mode: ComputerPolicy
  ): Promise<SavedReview> {
    let context: BrowserActionContext | null = null;
    const title = actionTitle(name, input);
    if (
      name === "computer_session" &&
      input.action === "take_back" &&
      (await this.host.ownerHasControl())
    )
      return {
        mode,
        context,
        view: {
          title: "Return control with Continue",
          details: "Use the Continue button on the computer handoff.",
          decision: "review",
          unavailable: true,
          reason:
            "The agent cannot take control during your handoff. Deny this old request and use Continue when you are done."
        }
      };
    let view: ComputerReview = {
      title,
      decision: "review",
      reason: "This action needs your review.",
      details: actionDetails(name, input)
    };
    if (browserTargetActions.has(name)) {
      try {
        context = await this.host.inspect(input);
        if (
          /password|one-time-code|cc-number|cc-csc/iu.test(
            `${context.target?.type} ${context.target?.autocomplete}`
          )
        )
          throw new Error("Enter private credentials directly in the computer handoff.");
        view = {
          ...view,
          title: targetTitle(name, input, context),
          details: `${context.title}\n${context.url}${context.target?.href ? `\nDestination: ${context.target.href}` : ""}${name === "browser_type" ? `\nText: ${String(input.text ?? "")}` : ""}`
        };
      } catch {
        return {
          mode,
          context: null,
          view: {
            ...view,
            unavailable: true,
            reason:
              "The target could not be verified. Deny this request and ask the agent to inspect the page again."
          }
        };
      }
    }
    const routine =
      (name === "computer_session" &&
        ["start", "give_to_owner", "take_back"].includes(String(input.action))) ||
      (name === "browser_tabs" && ["list", "select"].includes(String(input.operation))) ||
      (name === "desktop_mouse" && ["move", "scroll"].includes(String(input.action))) ||
      name === "copy_file_to_computer" ||
      (name === "browser_click" &&
        (context?.target?.tag === "select" ||
          (context?.target?.role === "combobox" &&
            context.target.expanded === "false" &&
            context.target.hasPopup === "listbox")));
    if (
      (routine &&
        (mode !== "review" ||
          name === "computer_session" ||
          (name === "browser_tabs" && input.operation === "list"))) ||
      mode === "allow"
    )
      view = { ...view, decision: "allow", reason: "Routine computer work." };
    else if (mode === "autonomous" && name !== "delete_file") {
      try {
        const result = await this.host.classify(name, input, context);
        view = { ...view, ...result, ...(context ? { title: view.title } : {}) };
      } catch {
        view.reason =
          "The automatic check could not confirm this action. Please review its effects.";
      }
    } else if (mode === "review")
      view.reason = "Strict mode asks you to approve each computer action.";
    return { mode, context, view };
  }
}
function targetTitle(name: string, input: Record<string, unknown>, page: BrowserActionContext) {
  const target = page.target?.name ?? "the selected control";
  return name === "browser_type"
    ? `Type in “${target}”${input.submit ? " and submit" : ""}`
    : name === "browser_press"
      ? `Press ${String(input.key)} on “${target}”`
      : `Click “${target}”`;
}
export function actionTitle(name: string, input: Record<string, unknown>) {
  if (name === "computer_session")
    return (
      (
        {
          start: "Start the computer",
          give_to_owner: "Give you computer control",
          take_back: "Continue computer work",
          stop: "Stop the computer"
        } as Record<string, string>
      )[String(input.action)] ?? "Change computer session"
    );
  return (
    (
      {
        browser_open: "Open a web page",
        browser_click: "Click a browser control",
        browser_type: "Type in the browser",
        browser_press: "Press a browser key",
        browser_evaluate: "Run code in the web page",
        browser_tabs: "Change browser tabs",
        bash: "Run a command on the computer",
        desktop_mouse: "Use the computer pointer",
        desktop_keyboard: "Use the computer keyboard",
        copy_file_to_computer: "Copy a working file to the computer",
        delete_file: "Delete a file"
      } as Record<string, string>
    )[name] ?? "Use the computer"
  );
}
function actionDetails(name: string, input: Record<string, unknown>) {
  if (typeof input.url === "string") return input.url;
  if (name === "computer_session") return "The same private computer and saved task.";
  if (name === "bash")
    return String(
      input.description ??
        "Run the requested command in this teammate’s computer. Review the command in technical details."
    );
  if (name === "delete_file") return String(input.path ?? input.fileId ?? "The selected file");
  return "Review the action and its effects before continuing.";
}
