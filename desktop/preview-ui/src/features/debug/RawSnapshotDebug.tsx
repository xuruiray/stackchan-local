import { RawPanel } from "../../components/RawPanel";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function RawSnapshotDebug({ snapshot }: { snapshot: PreviewSnapshot | null }): JSX.Element {
  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Debug</div>
          <h2>Raw Snapshot</h2>
          <p>来自 `/status` 的实时公开 snapshot。</p>
        </div>
      </header>
      <RawPanel value={snapshot} />
    </div>
  );
}
