#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const url =
  process.env.STACKCHAN_FACE_LANDMARKER_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const destination = resolve(
  process.env.STACKCHAN_FACE_LANDMARKER_MODEL ?? "desktop/models/face_landmarker.task"
);
const temporary = `${destination}.tmp`;

await mkdir(dirname(destination), { recursive: true });
await rm(temporary, { force: true });

const response = await fetch(url);
if (!response.ok || !response.body) {
  throw new Error(`failed to download MediaPipe face landmarker model: ${response.status} ${response.statusText}`);
}

await pipeline(response.body, createWriteStream(temporary));
await rename(temporary, destination);
console.log(`Downloaded MediaPipe face landmarker model to ${destination}`);
