import { useEffect, useState } from "react";

import { fetchStatus, subscribeSnapshots } from "../api/client";
import type { PreviewSnapshot } from "../../../src/preview/public-types";

export function usePreviewSnapshot(): {
  snapshot: PreviewSnapshot | null;
  connected: boolean;
  error: string | null;
  setSnapshot: (snapshot: PreviewSnapshot) => void;
} {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    const unsubscribe = subscribeSnapshots(
      (next) => {
        setSnapshot(next);
        setConnected(true);
        setError(null);
      },
      () => {
        setConnected(false);
        setError("SSE disconnected");
      }
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { snapshot, connected, error, setSnapshot };
}
