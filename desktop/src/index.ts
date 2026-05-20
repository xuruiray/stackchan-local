import { createLogger, loadConfig } from "./config.js";
import { CodexSessionWatcher } from "./codex/session-watcher.js";
import { DebugLogBuffer } from "./debug/log-buffer.js";
import { DeviceRegistry } from "./device/registry.js";
import { startMcpServer } from "./mcp/server.js";
import { PreviewServer } from "./preview/server.js";
import { RobotController } from "./robot/controller.js";
import { CodexCompletionAnnouncer } from "./tts/completion-announcer.js";
import { VolcengineTtsClient } from "./tts/volcengine.js";
import { VisionTrackingService } from "./vision/tracking.js";
import { StackChanWebSocketServer } from "./ws/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const debugLog = new DebugLogBuffer(500);
  const logger = createLogger(config.logLevel, (entry) => debugLog.append(entry));
  const registry = new DeviceRegistry(logger);
  const controller = new RobotController(registry, logger);
  const wsServer = new StackChanWebSocketServer(config, registry, logger);
  const visionTracking = new VisionTrackingService(controller, registry, logger, config);
  const ttsClient = new VolcengineTtsClient(config, logger);
  const completionAnnouncer = new CodexCompletionAnnouncer(controller, ttsClient, logger, config, registry);
  const previewServer = config.previewEnabled
    ? new PreviewServer({ host: config.previewHost, port: config.previewPort }, visionTracking, logger, {
        registry,
        debugLog,
        completionAnnouncer
      })
    : undefined;
  const codexWatcher = config.codexStatusEnabled
    ? new CodexSessionWatcher(controller, logger, {
        sessionsRoot: config.codexSessionsRoot,
        pollMs: config.codexWatchPollMs,
        latestScanMs: config.codexLatestScanMs,
        onCompletion: (event) =>
          completionAnnouncer.announce({
            id: event.id,
            reason: event.change.reason,
            taskSummary: event.taskSummary
          })
      })
    : undefined;

  await wsServer.start();
  visionTracking.start();
  await previewServer?.start();
  codexWatcher?.start();

  const runMcp = process.argv.includes("--mcp");
  if (runMcp) {
    await startMcpServer(controller, logger, visionTracking);
  } else {
    logger.info("desktop daemon ready", {
      mode: "daemon",
      pairingToken: config.pairingToken === "dev-local-token" ? "dev-local-token" : "custom"
    });
  }

  process.once("SIGINT", async () => {
    logger.info("received SIGINT, stopping");
    codexWatcher?.stop();
    visionTracking.stop();
    await previewServer?.stop();
    await wsServer.stop();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    logger.info("received SIGTERM, stopping");
    codexWatcher?.stop();
    visionTracking.stop();
    await previewServer?.stop();
    await wsServer.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
