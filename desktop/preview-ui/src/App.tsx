import { useEffect, useMemo, useState } from "react";

import { StatusDot } from "./components/StatusDot";
import { usePreviewSnapshot } from "./hooks/usePreviewSnapshot";
import { ageText, dash, integerText, ratioPercent } from "./model/format";
import { activeDevice } from "./model/snapshot";
import { canonicalPageId, pageGroups, pages, type PageKind } from "./model/moduleRegistry";

export function App(): JSX.Element {
  const { snapshot, connected, error, setSnapshot } = usePreviewSnapshot();
  const [activeId, setActiveId] = useState(pageIdFromHash);
  const [mobileGroup, setMobileGroup] = useState<PageKind>("module");
  const active = useMemo(() => pages.find((page) => page.id === activeId) ?? pages[0], [activeId]);
  const device = activeDevice(snapshot);
  const ActiveComponent = active.component;
  const dropRate = snapshot?.status.framesReceived ? snapshot.status.framesDropped / snapshot.status.framesReceived : 0;

  useEffect(() => {
    const onHashChange = () => setActiveId(pageIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <strong>StackChan Console</strong>
          <span>{dash(device?.deviceId)}</span>
        </div>
        <div className="mobile-group-switch">
          {pageGroups.map((group) => (
            <button
              key={group.kind}
              className={mobileGroup === group.kind ? "selected" : ""}
              type="button"
              onClick={() => setMobileGroup(group.kind)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <nav>
          {pageGroups.map((group) => (
            <section className={`nav-group ${mobileGroup === group.kind ? "mobile-selected" : ""}`} key={group.kind}>
              <h2>{group.label}</h2>
              {pages
                .filter((page) => page.kind === group.kind)
                .map((page) => {
                  const Icon = page.icon;
                  const status = page.status(snapshot);
                  return (
                    <button
                      className={page.id === active.id ? "nav-item active" : "nav-item"}
                      key={page.id}
                      type="button"
                      onClick={() => {
                        setActiveId(page.id);
                        setMobileGroup(page.kind);
                        if (window.location.hash !== `#${page.id}`) {
                          window.history.replaceState(null, "", `#${page.id}`);
                        }
                      }}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                      <span>
                        <strong>{page.label}</strong>
                        <small>{page.detail}</small>
                      </span>
                      <StatusDot status={status} />
                    </button>
                  );
                })}
            </section>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="summary-grid">
            <Summary label="Device" value={dash(device?.status)} tone={device?.status === "online" ? "ok" : "bad"} />
            <Summary label="SSE" value={connected ? "live" : "lost"} tone={connected ? "ok" : "warn"} />
            <Summary label="FPS" value={integerText(snapshot?.status.fps)} />
            <Summary label="Faces" value={integerText(snapshot?.faces.length)} />
            <Summary label="Battery" value={integerText(device?.sensors.sensorSnapshot?.power?.batteryLevel, "%")} />
            <Summary label="Wi-Fi" value={dash(device?.sensors.sensorSnapshot?.network?.wifi?.status ?? device?.sensors.wifi?.status)} />
            <Summary label="Drops" value={ratioPercent(dropRate)} tone={dropRate > 0.08 ? "warn" : "muted"} />
            <Summary label="Updated" value={ageText(device?.lastSeenAt)} />
          </div>
          {error ? <div className="error-strip">{error}</div> : null}
        </header>
        <section className="workspace-body">
          <ActiveComponent snapshot={snapshot} setSnapshot={setSnapshot} />
        </section>
      </main>
    </div>
  );
}

function pageIdFromHash(): string {
  const pageId = canonicalPageId(window.location.hash.replace(/^#\/?/, ""));
  return pages.some((page) => page.id === pageId) ? pageId : "power";
}

function Summary({ label, value, tone = "muted" }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "muted" }): JSX.Element {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong className={`tone-${tone}`}>{value}</strong>
    </div>
  );
}
