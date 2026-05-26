import { useEffect, useMemo, useState } from "react";

import { fetchLogs, subscribeLogs, type DebugLogEntry } from "../../api/client";
import { Button } from "../../components/Button";

const levelOrder = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function LogsDebug(): JSX.Element {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [type, setType] = useState("");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void fetchLogs({ limit: 200 }).then((data) => setLogs(data.logs));
    return subscribeLogs((entry) => {
      setLogs((current) => (paused ? current : [...current, entry].slice(-500)));
    });
  }, [paused]);

  const visible = useMemo(() => {
    return logs.filter((entry) => {
      if (type && entry.type !== type) return false;
      if (level && levelOrder[entry.level] < levelOrder[level as keyof typeof levelOrder]) return false;
      if (search) {
        const text = `${entry.message} ${JSON.stringify(entry.context ?? {})}`.toLowerCase();
        if (!text.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [level, logs, search, type]);

  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Debug</div>
          <h2>Logs</h2>
          <p>Desktop daemon 与设备命令日志。</p>
        </div>
      </header>
      <section className="panel-block">
        <div className="log-toolbar">
          <input placeholder="Search logs" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            <option value="system">system</option>
            <option value="device">device</option>
            <option value="vision">vision</option>
            <option value="command">command</option>
          </select>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">All levels</option>
            <option value="debug">debug+</option>
            <option value="info">info+</option>
            <option value="warn">warn+</option>
            <option value="error">error</option>
          </select>
          <Button onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</Button>
          <Button onClick={() => setLogs([])}>Clear</Button>
        </div>
        <div className="log-list">
          {visible.map((entry) => (
            <article className={`log-card log-${entry.level}`} key={entry.id}>
              <div>
                <strong>{entry.message}</strong>
                <span>{new Date(entry.time).toLocaleTimeString()} / {entry.level} / {entry.type} / #{entry.id}</span>
              </div>
              {entry.context ? <pre>{JSON.stringify(entry.context, null, 2)}</pre> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
