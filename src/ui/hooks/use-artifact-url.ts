import { useEffect, useState } from "react";

export function useArtifactUrl({
  key,
  revision
}: {
  key: string | null;
  revision: string | null;
}): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!key) {
      setUrl(null);
      return;
    }
    const query = revision ? `?v=${encodeURIComponent(revision)}` : "";
    void fetch(`/api/artifacts/${encodeURIComponent(key)}${query}`, {
      credentials: "include"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Artifact could not load");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, revision]);

  return url;
}
