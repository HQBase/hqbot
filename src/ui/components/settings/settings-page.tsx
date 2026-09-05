import { useState } from "react";
import { PiMoon, PiSignOut, PiSun } from "react-icons/pi";
import { useTheme } from "../../features/theme/theme-provider";
import type { WorkspaceController } from "../../hooks/use-workspace";
import { DeviceNotifications } from "../inbox/device-notifications";
import { TeamAdministration } from "../team/team-administration";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { LocalDevices } from "./local-devices";
import { NetworkPolicy } from "./network-policy";

export function SettingsPage({ controller }: { controller: WorkspaceController }) {
  const [tab, setTab] = useState("account");
  const { theme, setTheme } = useTheme();
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-5 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account, people, and devices.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Settings" className="mb-5 flex w-full flex-wrap">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
        </TabsList>
        <TabsContent value="account" className="flex flex-col gap-5">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
            <div>
              <h2 className="text-sm font-semibold">Appearance</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the look that feels comfortable.
              </p>
            </div>
            <Button variant="outline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? (
                <PiSun data-icon="inline-start" />
              ) : (
                <PiMoon data-icon="inline-start" />
              )}
              Use {theme === "dark" ? "light" : "dark"} appearance
            </Button>
          </section>
          <p className="text-sm text-muted-foreground">
            To change a teammate's profile, permissions, or budget, open its conversation info.
          </p>
          <Button className="self-start" variant="outline" onClick={() => void controller.logout()}>
            <PiSignOut data-icon="inline-start" />
            Sign out
          </Button>
        </TabsContent>
        <TabsContent value="people">
          <TeamAdministration user={{ id: "owner", username: "Owner", role: "owner" }} />
        </TabsContent>
        <TabsContent value="network">
          <NetworkPolicy />
        </TabsContent>
        <TabsContent value="devices" className="flex flex-col gap-5">
          <DeviceNotifications />
          <LocalDevices bots={controller.snapshot?.bots ?? []} />
          <section className="flex flex-col gap-2 rounded-xl border p-4">
            <h2 className="font-semibold">Install HQBot</h2>
            <p className="text-sm text-muted-foreground">
              Use your browser's Install app or Add to Home Screen action. Your teammates continue
              working when the app is closed.
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </section>
  );
}
