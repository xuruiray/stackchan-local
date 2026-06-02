import { Buffer } from "node:buffer";

import type { RobotEventMessage } from "@stackchan-local/protocol";

export type ProtocolCameraFrameEvent = Extract<RobotEventMessage["event"], { kind: "cameraFrame" }>;

export type DesktopCameraFrameEvent = Omit<ProtocolCameraFrameEvent, "dataBase64"> & {
  dataBase64?: string;
  jpegBuffer?: Buffer;
};

export type DesktopRobotEventMessage = Omit<RobotEventMessage, "event"> & {
  event: Exclude<RobotEventMessage["event"], ProtocolCameraFrameEvent> | DesktopCameraFrameEvent;
};

export function cameraFrameBuffer(event: DesktopCameraFrameEvent): Buffer {
  if (event.jpegBuffer) {
    return event.jpegBuffer;
  }
  if (typeof event.dataBase64 === "string") {
    return Buffer.from(event.dataBase64, "base64");
  }
  throw new Error("cameraFrame event is missing JPEG payload");
}
