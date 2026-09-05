import { useState } from "react";
import { PiArrowSquareOut, PiMagnifyingGlass, PiPlugsConnected } from "react-icons/pi";
import { type ConnectorPreset, connectorCatalog } from "../../lib/connector-catalog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function ConnectorPicker({
  selected,
  onSelect
}: {
  selected?: ConnectorPreset;
  onSelect: (preset: ConnectorPreset | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const items = connectorCatalog.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <section aria-label="Connector catalog" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <PiMagnifyingGlass className="text-muted-foreground" />
        <Input
          aria-label="Find a service"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a service…"
        />
      </div>
      <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected?.id === item.id}
            onClick={() => onSelect(item)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent ${selected?.id === item.id ? "border-primary bg-primary/5" : "bg-card"}`}
          >
            <PiPlugsConnected className="mt-1 shrink-0" />
            <div>
              <p className="text-sm font-medium">{item.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </div>
          </button>
        ))}
      </div>
      {!items.length && (
        <p className="text-sm text-muted-foreground">
          No matching service. You can add a custom server below.
        </p>
      )}
      <Button size="sm" variant="ghost" className="self-start" onClick={() => onSelect(undefined)}>
        Use a custom MCP server
      </Button>
      {selected && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm">{selected.name}</strong>
            <Badge variant="secondary">{selected.auth}</Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{selected.setup}</p>
          <a
            href={selected.docs}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs underline"
          >
            Official setup guide <PiArrowSquareOut />
          </a>
        </div>
      )}
    </section>
  );
}
