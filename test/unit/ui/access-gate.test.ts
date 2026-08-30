// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessGate } from "../../../src/ui/components/access-gate";
import { interact, renderComponent, setInputValue } from "./render.tsx";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

function expectCookieRequestWithoutBearer(call: unknown[]): void {
  const init = call[1] as RequestInit;
  expect(init.credentials).toBe("include");
  expect(new Headers(init.headers).has("Authorization")).toBe(false);
}

function requiredInput(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Expected input ${selector}`);
  return input;
}

function requiredSubmit(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error("Expected submit button");
  return button;
}

function submit(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (!form) throw new Error("Expected access form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AccessGate", () => {
  it("creates the first owner through the bootstrap cookie endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, configured: false }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthenticated = vi.fn();
    const view = await renderComponent(createElement(AccessGate, { onAuthenticated }));

    expect(view.container.textContent).toContain("Create the HQBot owner");
    expect(view.container.textContent).toContain("One-time setup code");
    await setInputValue(
      requiredInput(view.container, "#owner-setup-code"),
      "integration-setup-code-32-bytes"
    );
    await setInputValue(requiredInput(view.container, "#owner-username"), "owner");
    await setInputValue(requiredInput(view.container, "#owner-password"), "a-secure-password");
    await setInputValue(
      requiredInput(view.container, "#owner-password-confirmation"),
      "a-secure-password"
    );
    expect(requiredSubmit(view.container).disabled).toBe(false);
    await interact(() => submit(view.container));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/status", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/bootstrap",
      expect.objectContaining({ method: "POST" })
    );
    const bootstrapInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(bootstrapInit).toBeDefined();
    expect(JSON.parse(String(bootstrapInit?.body ?? ""))).toMatchObject({
      setupCode: "integration-setup-code-32-bytes"
    });
    for (const call of fetchMock.mock.calls) expectCookieRequestWithoutBearer(call);
    expect(onAuthenticated).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("signs in an existing owner through the login cookie endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, configured: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthenticated = vi.fn();
    const view = await renderComponent(createElement(AccessGate, { onAuthenticated }));

    expect(view.container.textContent).toContain("Welcome back");
    expect(view.container.querySelector("#owner-password-confirmation")).toBeNull();
    await setInputValue(requiredInput(view.container, "#owner-username"), "owner");
    await setInputValue(requiredInput(view.container, "#owner-password"), "a-secure-password");
    expect(requiredSubmit(view.container).disabled).toBe(false);
    await interact(() => submit(view.container));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/login",
      expect.objectContaining({ method: "POST" })
    );
    for (const call of fetchMock.mock.calls) expectCookieRequestWithoutBearer(call);
    expect(onAuthenticated).toHaveBeenCalledOnce();
    await view.unmount();
  });
});
