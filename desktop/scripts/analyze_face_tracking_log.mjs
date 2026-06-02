#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

const filePath = process.argv[2] ?? "logs/face-tracking.ndjson";
const resolvedPath = path.resolve(process.cwd(), filePath);

let lines;
try {
  lines = readFileSync(resolvedPath, "utf8").split(/\r?\n/).filter(Boolean);
} catch (error) {
  console.error(`failed to read ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const events = [];
for (const [index, line] of lines.entries()) {
  try {
    events.push(JSON.parse(line));
  } catch (error) {
    console.warn(`skipping invalid JSON line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const session = latestTrackingSession(events);
if (session.length === 0) {
  console.log("No face tracking session found.");
  process.exit(0);
}

const summary = summarizeSession(session);
printSummary(summary);

function latestTrackingSession(allEvents) {
  const stateIndexes = allEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "trackingState");
  const lastEnabled = [...stateIndexes].reverse().find(({ event }) => event.enabled === true);
  if (!lastEnabled) {
    return allEvents;
  }
  const nextDisabled = stateIndexes.find(({ event, index }) => index > lastEnabled.index && event.enabled === false);
  return allEvents.slice(lastEnabled.index, nextDisabled ? nextDisabled.index + 1 : undefined);
}

function summarizeSession(sessionEvents) {
  const detections = sessionEvents.filter((event) => event.type === "faceDetection");
  const targetReady = detections.filter((event) => event.action === "target_ready");
  const noFace = detections.filter((event) => event.action === "no_face");
  const commands = sessionEvents.filter((event) => event.type === "trackCommand" && event.command?.detected === true);
  const commandResults = sessionEvents.filter((event) => event.type === "trackCommandResult");
  const firmwareControls = sessionEvents.filter(
    (event) => event.type === "faceTrackingControl" || event.type === "firmwareFaceTrackingControl"
  );
  const firstTs = sessionEvents[0]?.ts;
  const lastTs = sessionEvents[sessionEvents.length - 1]?.ts;

  return {
    firstTs,
    lastTs,
    eventCount: sessionEvents.length,
    detections: detections.length,
    targetReady: targetReady.length,
    noFace: noFace.length,
    commands: commands.length,
    commandResults: commandResults.length,
    firmwareControls: firmwareControls.length,
    detectorCounts: countBy(commands, (event) => event.target?.detector ?? event.command?.bbox?.detector ?? "unknown"),
    firmwareActionCounts: countBy(firmwareControls, (event) => event.event?.action ?? event.action ?? "unknown"),
    topTargetJumps: commands
      .map((event) => ({
        ts: event.ts,
        centerX: event.command?.centerX,
        centerY: event.command?.centerY,
        detector: event.target?.detector ?? event.command?.bbox?.detector,
        distance: event.diagnostics?.delta?.distance,
        dtMs: event.diagnostics?.delta?.dtMs,
        dx: event.diagnostics?.delta?.dx,
        dy: event.diagnostics?.delta?.dy
      }))
      .filter((item) => Number.isFinite(item.distance))
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 10),
    topEstimatedServoDeltas: commands
      .map((event) => ({
        ts: event.ts,
        centerX: event.command?.centerX,
        centerY: event.command?.centerY,
        detector: event.target?.detector ?? event.command?.bbox?.detector,
        yaw: event.diagnostics?.pidEstimate?.yaw?.estimatedServoDelta,
        pitch: event.diagnostics?.pidEstimate?.pitch?.estimatedServoDelta
      }))
      .map((item) => ({ ...item, magnitude: Math.hypot(Number(item.yaw) || 0, Number(item.pitch) || 0) }))
      .filter((item) => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 10),
    topFirmwareDeltas: firmwareControls
      .map((event) => ({
        ts: event.ts,
        action: event.event?.action ?? event.action,
        yawDelta: event.event?.yawDelta ?? event.yawDelta,
        pitchDelta: event.event?.pitchDelta ?? event.pitchDelta,
        currentYaw: event.event?.currentYaw ?? event.currentYaw,
        currentPitch: event.event?.currentPitch ?? event.currentPitch,
        nextYaw: event.event?.nextYaw ?? event.nextYaw,
        nextPitch: event.event?.nextPitch ?? event.nextPitch
      }))
      .map((item) => ({ ...item, magnitude: Math.hypot(Number(item.yawDelta) || 0, Number(item.pitchDelta) || 0) }))
      .filter((item) => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 10),
    noFaceStreaks: noFace
      .map((event) => event.noFaceStreak)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)
      .slice(0, 10)
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function printSummary(summary) {
  console.log(`Face tracking log: ${resolvedPath}`);
  console.log(`Session: ${summary.firstTs ?? "-"} -> ${summary.lastTs ?? "-"}`);
  console.log("");
  console.table({
    events: summary.eventCount,
    detections: summary.detections,
    target_ready: summary.targetReady,
    no_face: summary.noFace,
    commands: summary.commands,
    command_results: summary.commandResults,
    firmware_controls: summary.firmwareControls
  });
  console.log("Detector counts:");
  console.table(summary.detectorCounts);
  if (summary.firmwareControls > 0) {
    console.log("Firmware action counts:");
    console.table(summary.firmwareActionCounts);
  }
  console.log("Top target jumps:");
  console.table(summary.topTargetJumps);
  console.log("Top estimated desktop servo deltas:");
  console.table(summary.topEstimatedServoDeltas);
  if (summary.topFirmwareDeltas.length > 0) {
    console.log("Top firmware servo deltas:");
    console.table(summary.topFirmwareDeltas);
  }
  console.log("Largest no-face streaks:");
  console.table(summary.noFaceStreaks.map((value) => ({ noFaceStreak: value })));
}
