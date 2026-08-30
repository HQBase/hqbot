import { useChat } from "@ai-sdk/react";
import { createChat } from "@shadcn/helpers/ai-sdk";
import { PiArrowRight, PiRobot } from "react-icons/pi";

import { AgentMessage, type AgentPart } from "../../components/chat/agent-message";
import { ApprovalCard } from "../../components/chat/approval-card";
import { CostPanel } from "../../components/details/cost-panel";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import { useTheme } from "../theme/theme-provider";

const fixture = createChat({
  messageIdPrefix: "hqbot-preview-message",
  now: "2026-08-30T14:00:00.000Z",
  sourceIdPrefix: "hqbot-preview-source",
  toolCallIdPrefix: "hqbot-preview-tool"
})
  .user("Find the current Browser Run pricing and give me the short version.")
  .assistant(({ writer }) => {
    writer.reasoning("I should use the browser because the request asks for current pricing.");
    writer
      .tool("browser", {
        dynamic: true,
        input: { url: "https://developers.cloudflare.com/browser-rendering/pricing/" },
        title: "Opening Cloudflare pricing"
      })
      .sleep(450)
      .output({ page: "Browser Run pricing", status: "read" });
    writer.sourceUrl({
      title: "Cloudflare Browser Run pricing",
      url: "https://developers.cloudflare.com/browser-rendering/pricing/"
    });
    writer.text(
      "Browser time is metered only while the session runs. HQBot stops idle sessions automatically."
    );
  });

export function AgentUiLab() {
  const { setTheme, theme } = useTheme();
  const { messages, sendMessage, status } = useChat({
    messages: fixture.get(0),
    transport: fixture.transport({ delayMs: 20 })
  });
  const next = fixture.next(messages);
  const busy = status === "submitted" || status === "streaming";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PiRobot />
            </span>
            <Separator className="h-6" orientation="vertical" />
            <div>
              <p className="text-sm font-semibold">HQBot agent UI lab</p>
              <p className="text-xs text-muted-foreground">
                Deterministic streams. No model or credits.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Development only</Badge>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-6">
        <section className="rounded-[24px] border border-divider bg-reader p-4 shadow-sm sm:p-8">
          <div className="mx-auto flex max-w-[780px] flex-col gap-7">
            {messages.map((message) => (
              <AgentMessage
                key={message.id}
                name={message.role === "user" ? "You" : "Researcher"}
                parts={message.parts as unknown as AgentPart[]}
                speaker={message.role === "user" ? "user" : "assistant"}
              />
            ))}
            <Button
              className="self-center"
              disabled={!next || busy}
              type="button"
              onClick={() => next && void sendMessage(next)}
            >
              {busy
                ? "Streaming…"
                : messages.length === 0
                  ? "Run research fixture"
                  : "Fixture complete"}
              <PiArrowRight data-icon="inline-end" />
            </Button>
            <ApprovalCard pending={false} onApprove={() => undefined} onDeny={() => undefined} />
          </div>
        </section>
        <CostPanel
          budgetUsd={50}
          modelId="@cf/zai-org/glm-5.3-flash"
          costs={{
            dayStartedAt: "2026-08-30T00:00:00.000Z",
            overall: { estimatedUsd: 1.24, inputUnits: 12400, outputUnits: 3200 },
            selectedBot: { estimatedUsd: 0.37, inputUnits: 4800, outputUnits: 1200 },
            selectedTask: { estimatedUsd: 0.002, inputUnits: 800, outputUnits: 240 },
            services: {
              overall: {
                browser: { estimatedUsd: 0.32, inputUnits: 880, outputUnits: 0 },
                workersAi: { estimatedUsd: 0.92, inputUnits: 12400, outputUnits: 3200 }
              },
              selectedBot: {
                browser: { estimatedUsd: 0.09, inputUnits: 96, outputUnits: 0 },
                workersAi: { estimatedUsd: 0.28, inputUnits: 4800, outputUnits: 1200 }
              },
              selectedTask: {
                browser: { estimatedUsd: 0.001, inputUnits: 1, outputUnits: 0 },
                workersAi: { estimatedUsd: 0.001, inputUnits: 800, outputUnits: 240 }
              }
            },
            platform: {
              durableObjectGbSecondsPerDay: 1728.42,
              hqbaseRealtimeConnections: 2,
              selectedBotHqbaseRealtime: true
            }
          }}
        />
      </div>
    </main>
  );
}
