import { Buffer } from "node:buffer";
import type { RawData } from "ws";

const MAGIC = Buffer.from("SCL1", "ascii");
const CAMERA_FRAME_KIND = 0x01;
const HEADER_OFFSET = 8;

export interface BinaryCameraFrameHeader {
  frameId: string;
  deviceId: string;
  timestamp: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  byteLength: number;
  transport: "binary";
  seq?: number;
  captureTimestamp?: string;
  sentAt?: string;
  deviceEncodedAt?: string;
  deviceQueuedAt?: string;
  deviceTxStartAt?: string;
}

export type ParsedStackChanBinaryFrame =
  | {
      kind: "cameraFrame";
      header: BinaryCameraFrameHeader;
      payload: Buffer;
    }
  | {
      kind: "unknown";
      rawKind: number;
    };

export function parseStackChanBinaryFrame(data: RawData): ParsedStackChanBinaryFrame | undefined {
  const buffer = rawDataToBuffer(data);
  if (buffer.byteLength < HEADER_OFFSET || !buffer.subarray(0, 4).equals(MAGIC)) {
    return undefined;
  }

  const rawKind = buffer.readUInt8(4);
  const headerLength = buffer.readUInt16BE(6);
  if (rawKind !== CAMERA_FRAME_KIND) {
    return { kind: "unknown", rawKind };
  }
  if (headerLength <= 0) {
    throw new Error("binary camera frame header is empty");
  }
  const headerEnd = HEADER_OFFSET + headerLength;
  if (headerEnd > buffer.byteLength) {
    throw new Error("binary camera frame header exceeds payload size");
  }

  const header = parseCameraFrameHeader(buffer.subarray(HEADER_OFFSET, headerEnd).toString("utf8"));
  const payload = buffer.subarray(headerEnd);
  if (header.byteLength !== payload.byteLength) {
    throw new Error(`binary camera frame byteLength mismatch: header=${header.byteLength} payload=${payload.byteLength}`);
  }
  if (payload.byteLength === 0) {
    throw new Error("binary camera frame payload is empty");
  }

  return {
    kind: "cameraFrame",
    header,
    payload
  };
}

export function encodeStackChanBinaryCameraFrame(header: BinaryCameraFrameHeader, payload: Buffer): Buffer {
  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  if (headerJson.byteLength > 0xffff) {
    throw new Error("binary camera frame header is too large");
  }

  const envelope = Buffer.allocUnsafe(HEADER_OFFSET + headerJson.byteLength + payload.byteLength);
  MAGIC.copy(envelope, 0);
  envelope.writeUInt8(CAMERA_FRAME_KIND, 4);
  envelope.writeUInt8(0, 5);
  envelope.writeUInt16BE(headerJson.byteLength, 6);
  headerJson.copy(envelope, HEADER_OFFSET);
  payload.copy(envelope, HEADER_OFFSET + headerJson.byteLength);
  return envelope;
}

function parseCameraFrameHeader(source: string): BinaryCameraFrameHeader {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("binary camera frame header is not valid JSON");
  }

  if (!isRecord(value)) {
    throw new Error("binary camera frame header must be an object");
  }
  const header = value as Record<string, unknown>;
  if (typeof header.frameId !== "string" || header.frameId.length === 0) {
    throw new Error("binary camera frame header frameId is invalid");
  }
  if (typeof header.deviceId !== "string" || header.deviceId.length === 0) {
    throw new Error("binary camera frame header deviceId is invalid");
  }
  if (typeof header.timestamp !== "string" || Number.isNaN(Date.parse(header.timestamp))) {
    throw new Error("binary camera frame header timestamp is invalid");
  }
  if (header.mimeType !== "image/jpeg") {
    throw new Error("binary camera frame header mimeType is invalid");
  }
  if (!isPositiveInteger(header.width) || !isPositiveInteger(header.height)) {
    throw new Error("binary camera frame header dimensions are invalid");
  }
  if (!isPositiveInteger(header.byteLength)) {
    throw new Error("binary camera frame header byteLength is invalid");
  }
  if (header.transport !== "binary") {
    throw new Error("binary camera frame header transport is invalid");
  }

  return {
    frameId: header.frameId,
    deviceId: header.deviceId,
    timestamp: header.timestamp,
    mimeType: "image/jpeg",
    width: header.width,
    height: header.height,
    byteLength: header.byteLength,
    transport: "binary",
    seq: isNonNegativeInteger(header.seq) ? header.seq : undefined,
    captureTimestamp: isIsoDateString(header.captureTimestamp) ? header.captureTimestamp : undefined,
    sentAt: isIsoDateString(header.sentAt) ? header.sentAt : undefined,
    deviceEncodedAt: isIsoDateString(header.deviceEncodedAt) ? header.deviceEncodedAt : undefined,
    deviceQueuedAt: isIsoDateString(header.deviceQueuedAt) ? header.deviceQueuedAt : undefined,
    deviceTxStartAt: isIsoDateString(header.deviceTxStartAt) ? header.deviceTxStartAt : undefined
  };
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
