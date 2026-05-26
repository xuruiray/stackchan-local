import { useState } from "react";

export function useCommand(): {
  pending: boolean;
  status: string;
  run: (action: () => Promise<unknown>) => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("ready");

  async function run(action: () => Promise<unknown>): Promise<void> {
    setPending(true);
    setStatus("sending");
    try {
      const result = (await action()) as { ok?: boolean; error?: string; reason?: string };
      setStatus(result.ok === false ? result.error ?? result.reason ?? "failed" : `accepted ${timeStamp()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return { pending, status, run };
}

function timeStamp(): string {
  const now = new Date();
  return now.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
