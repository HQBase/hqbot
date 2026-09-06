// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { HQBOT_MODELS } from "../../../src/domain/models";
import type { TeamWork } from "../../../src/domain/team-work";
import { TeamAssignmentCard } from "../../../src/ui/components/details/team-assignment-card";
import { TeamManagementPanel } from "../../../src/ui/components/details/team-management-panel";
import { interact, renderComponent, setInputValue } from "./render";

const policy = {
  canManage: true,
  canCreate: false,
  canCreateManagers: false,
  allowedModelIds: [HQBOT_MODELS[0].id],
  defaultModelId: HQBOT_MODELS[0].id,
  maxEmployees: 8,
  maxConcurrent: 6,
  dailyBudgetUsd: 2
};
afterEach(() => vi.unstubAllGlobals());
it("saves a deliberate policy edit with its limits and keeps the last allowed model", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      policy: init?.method === "PATCH" ? JSON.parse(String(init.body)) : policy,
      models: HQBOT_MODELS.filter((model) => model.rates)
    })
  );
  vi.stubGlobal("fetch", fetcher);
  const view = await renderComponent(<TeamManagementPanel botId="chief" />);
  const toggle = view.container.querySelector<HTMLInputElement>('input[id$="-create"]');
  await interact(() => toggle?.click());
  const employees = view.container.querySelector<HTMLInputElement>('input[id$="-employees"]');
  if (!employees) throw new Error("Employee limit was not shown");
  await setInputValue(employees, "3");
  expect(
    view.container.querySelector<HTMLInputElement>(`input[id$="${HQBOT_MODELS[0].id}"]`)?.disabled
  ).toBe(true);
  await interact(() =>
    view.container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  const write = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
    canCreate: true,
    canCreateManagers: false,
    maxEmployees: 3,
    defaultModelId: HQBOT_MODELS[0].id
  });
  expect(
    [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save team settings")
    )?.disabled
  ).toBe(true);
  await view.unmount();
});
it("shows a retry after a settings load failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "Connection lost" }, { status: 503 }))
  );
  const view = await renderComponent(<TeamManagementPanel botId="chief" />);
  expect(view.container.textContent).toContain("Connection lost");
  expect(view.container.textContent).toContain("Try again");
  await view.unmount();
});
it("keeps a failed save beside the button and preserves the draft for retry", async () => {
  let fail = true;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH" && fail)
      return Response.json({ error: "Connection lost. Try again." }, { status: 503 });
    return Response.json({
      policy: init?.method === "PATCH" ? JSON.parse(String(init.body)) : policy,
      models: HQBOT_MODELS.filter((model) => model.rates)
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const view = await renderComponent(<TeamManagementPanel botId="chief" />);
  const budget = view.container.querySelector<HTMLInputElement>('input[id$="-budget"]');
  if (!budget) throw new Error("Budget control was not shown");
  await setInputValue(budget, "3");
  const form = view.container.querySelector("form");
  const submit = () =>
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await interact(submit);
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(button?.previousElementSibling?.getAttribute("role")).toBe("alert");
  expect(button?.previousElementSibling?.textContent).toContain("Connection lost. Try again.");
  expect(budget.value).toBe("3");
  expect(button?.disabled).toBe(false);
  fail = false;
  await interact(submit);
  expect(form?.querySelector('[role="alert"]')).toBeNull();
  expect(button?.disabled).toBe(true);
  expect(budget.value).toBe("3");
  await view.unmount();
});
it("sends one check-in for the exact assignment and shows pending guidance", async () => {
  const fetcher = vi.fn(async () => Response.json({ pending: true }));
  vi.stubGlobal("fetch", fetcher);
  const item = {
    id: "assignment",
    workId: "task",
    key: "a",
    botId: "employee",
    managerBotId: "chief",
    instruction: "Check a source",
    criterion: "Cite it",
    state: "submitted",
    result: null,
    review: null,
    updatedAt: "2026-09-06T12:00:00Z"
  };
  const work: TeamWork = {
    id: "task",
    ownerBotId: "chief",
    projectId: null,
    goal: "Research",
    criteria: ["Checked"],
    deadlineAt: "2026-09-07T12:00:00Z",
    budgetUsd: 1,
    spentUsd: 0.01,
    state: "active",
    result: null,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    assignments: [item]
  };
  const onUpdated = vi.fn();
  const props = {
    item,
    work,
    botId: "chief",
    names: { chief: "Chief", employee: "Researcher" },
    onUpdated
  };
  const view = await renderComponent(<TeamAssignmentCard {...props} />);
  await interact(() =>
    [...view.container.querySelectorAll("button")]
      .find((button) => button.textContent === "Check in")
      ?.click()
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))
  ).toMatchObject({ action: "check_in", assignmentId: "assignment", workId: "task" });
  await view.rerender(
    <TeamAssignmentCard
      {...props}
      work={{
        ...work,
        updates: [
          {
            id: "request",
            assignmentId: item.id,
            senderBotId: "chief",
            recipientBotId: "employee",
            kind: "check_in",
            message: "Progress",
            acknowledged: false,
            createdAt: item.updatedAt
          }
        ]
      }}
    />
  );
  expect(view.container.textContent).toContain("next safe step");
  expect(
    [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Check in"
    )?.disabled
  ).toBe(true);
  await view.unmount();
});
