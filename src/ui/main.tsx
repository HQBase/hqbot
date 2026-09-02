import type { ComponentType } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "./components/ui/sonner";
import { initializeTheme } from "./features/theme/theme";
import { ThemeProvider } from "./features/theme/theme-provider";
import "./styles.css";

async function loadRootComponent(): Promise<ComponentType> {
  const uiLab =
    window.location.pathname === "/__ui" || window.location.pathname.startsWith("/__ui/");
  if (import.meta.env.DEV && uiLab) {
    return (await import("./features/ui-lab/agent-ui-lab")).AgentUiLab;
  }
  return (await import("./App")).App;
}

async function render(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("HQBot root element is missing");
  const theme = initializeTheme();
  const Component = await loadRootComponent();
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider initialTheme={theme}>
        <Component />
        <Toaster />
      </ThemeProvider>
    </StrictMode>
  );
}

void render();
