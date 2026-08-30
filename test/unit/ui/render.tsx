import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";

export async function renderComponent(content: ReactNode): Promise<{
  container: HTMLDivElement;
  rerender: (content: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(content));
  await flushEffects();
  return {
    container,
    rerender: async (next) => {
      flushSync(() => root.render(next));
      await flushEffects();
    },
    unmount: async () => {
      flushSync(() => root.unmount());
    }
  };
}

export async function interact(action?: () => void): Promise<void> {
  flushSync(() => action?.());
  await flushEffects();
}

export async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await interact(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function flushEffects(): Promise<void> {
  await settle();
  flushSync(() => undefined);
  await settle();
}
