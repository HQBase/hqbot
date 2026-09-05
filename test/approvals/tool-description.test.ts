import { expect, it } from "vitest";
import { TeammateIntegrations } from "../../src/runtime/teammate-integrations";

it("keeps SDK discovery instructions and connector names in the model tool", () => {
  const integrations = new TeammateIntegrations({
    ctx: { exports: { CodemodeRuntime: {} }, facets: { get: () => ({}) } },
    env: {},
    loader: {},
    readyServers: () => [{ id: "docs", name: "Public docs", connection: { tools: [] } }]
  } as unknown as ConstructorParameters<typeof TeammateIntegrations>[0]);

  const description = integrations.tool().description;
  expect(description).toContain("codemode.search");
  expect(description).toContain("codemode.describe");
  expect(description).toContain('return await codemode.search("short intent phrase")');
  expect(description).toContain("variable assignment alone returns no value");
  expect(description).toContain("mcp_docs");
  expect(description).toContain("Do not use `fetch`");
  expect(description).toContain("resumes automatically");
  expect(description).toContain(
    "Connected-service tool calls need owner approval unless an explicit owner rule"
  );
});
