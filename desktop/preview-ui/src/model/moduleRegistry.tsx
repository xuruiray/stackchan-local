import {
  Activity,
  AudioLines,
  Battery,
  Bluetooth,
  Camera,
  Cpu,
  Gauge,
  Hand,
  Lightbulb,
  Logs,
  Magnet,
  Mic,
  Monitor,
  Move3D,
  Network,
  Radio,
  Rotate3D,
  ScanLine,
  Settings2,
  TerminalSquare,
  Volume2,
  Wifi,
  Zap
} from "lucide-react";
import type { ComponentType } from "react";

import { CodexAnnouncerApp } from "../features/apps/CodexAnnouncerApp";
import { FaceTrackingApp } from "../features/apps/FaceTrackingApp";
import { AudioModule } from "../features/modules/AudioModule";
import { CameraModule } from "../features/modules/CameraModule";
import { DisplayModule } from "../features/modules/DisplayModule";
import { HeadTouchModule } from "../features/modules/HeadTouchModule";
import { ImuModule } from "../features/modules/ImuModule";
import { Ina226Module } from "../features/modules/Ina226Module";
import { IOExpanderModule } from "../features/modules/IOExpanderModule";
import { IrModule } from "../features/modules/IrModule";
import { Ltr553Module } from "../features/modules/Ltr553Module";
import { MagnetometerModule } from "../features/modules/MagnetometerModule";
import { NetworkModule } from "../features/modules/NetworkModule";
import { NfcModule } from "../features/modules/NfcModule";
import { PowerModule } from "../features/modules/PowerModule";
import { RgbModule } from "../features/modules/RgbModule";
import { RtcModule } from "../features/modules/RtcModule";
import { ScreenTouchModule } from "../features/modules/ScreenTouchModule";
import { ServoModule } from "../features/modules/ServoModule";
import { LogsDebug } from "../features/debug/LogsDebug";
import { RawSnapshotDebug } from "../features/debug/RawSnapshotDebug";
import { SystemDebug } from "../features/debug/SystemDebug";
import type { PreviewSnapshot } from "../../../src/preview/public-types";
import { availabilityOf, interaction, motion, network, peripherals, power } from "./snapshot";

export type PageKind = "module" | "app" | "debug";

export type PageComponentProps = {
  snapshot: PreviewSnapshot | null;
  setSnapshot?: (snapshot: PreviewSnapshot) => void;
};

export type PageDefinition = {
  id: string;
  kind: PageKind;
  label: string;
  detail: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  component: ComponentType<PageComponentProps>;
  status: (snapshot: PreviewSnapshot | null) => "available" | "unavailable" | "warning" | "unknown" | "online";
};

export const pages: PageDefinition[] = [
  modulePage("power", "Power", "AXP2101", Battery, PowerModule, (s) => (power(s).batteryLevel !== undefined ? "available" : "unknown")),
  modulePage("ina226", "INA226", "Power monitor", Gauge, Ina226Module, (s) => availabilityOf(peripherals(s).powerMonitor)),
  modulePage("display", "Display", "ILI9342", Monitor, DisplayModule, () => "available"),
  modulePage("screen-touch", "Screen Touch", "FT6336", Hand, ScreenTouchModule, (s) => availabilityOf(interaction(s).screenTouch)),
  modulePage("head-touch", "Head Touch", "SI12T", Activity, HeadTouchModule, (s) => availabilityOf(interaction(s).headTouch)),
  modulePage("imu", "IMU", "BMI270", Rotate3D, ImuModule, (s) => availabilityOf(motion(s).imu)),
  modulePage("magnetometer", "Magnetometer", "BMM150", Magnet, MagnetometerModule, (s) =>
    availabilityOf(peripherals(s).magnetometer)
  ),
  modulePage("camera", "Camera", "GC0308", Camera, CameraModule, (s) => availabilityOf(peripherals(s).camera)),
  modulePage("servo", "Servo", "SCS bus", Move3D, ServoModule, (s) => availabilityOf(motion(s).servos)),
  modulePage("io-expander", "IO Expander", "AW9523 / PY32", Cpu, IOExpanderModule, (s) => availabilityOf(peripherals(s).ioExpander)),
  modulePage("rgb", "RGB LED", "body strip", Lightbulb, RgbModule, (s) => availabilityOf(peripherals(s).rgb)),
  modulePage("rtc", "RTC", "PCF8563", Settings2, RtcModule, (s) => availabilityOf(peripherals(s).rtc)),
  modulePage("ltr553", "ALS / Proximity", "LTR553", ScanLine, Ltr553Module, (s) =>
    availabilityOf(peripherals(s).proximity ?? peripherals(s).ambientLight)
  ),
  modulePage("nfc", "NFC", "probe", Radio, NfcModule, (s) => availabilityOf(peripherals(s).nfc)),
  modulePage("ir", "IR", "TX/RX", Zap, IrModule, (s) => availabilityOf(peripherals(s).ir)),
  modulePage("audio", "Audio", "ES7210 / AW88298", Mic, AudioModule, (s) => availabilityOf(peripherals(s).mic)),
  modulePage("network", "Wi-Fi / BLE", "ESP32-S3", Wifi, NetworkModule, (s) =>
    network(s).wifi?.status === "connected" ? "available" : availabilityOf(network(s).ble)
  ),
  appPage("codex-announcer", "Codex 播报", "TTS + light alert", Volume2, CodexAnnouncerApp, (s) =>
    s?.completionTts?.enabled ? "available" : "warning"
  ),
  appPage("face-tracking", "人脸追踪", "face position", Camera, FaceTrackingApp, (s) =>
    s?.status.enabled ? "available" : "warning"
  ),
  debugPage("system", "System", "session + counters", TerminalSquare, SystemDebug),
  debugPage("raw", "Raw Snapshot", "public JSON", Bluetooth, RawSnapshotDebug),
  debugPage("logs", "Logs", "daemon log stream", Logs, LogsDebug)
];

export const pageGroups: Array<{ kind: PageKind; label: string }> = [
  { kind: "module", label: "模块" },
  { kind: "app", label: "应用" },
  { kind: "debug", label: "Debug" }
];

function modulePage(
  id: string,
  label: string,
  detail: string,
  icon: PageDefinition["icon"],
  component: PageDefinition["component"],
  status: PageDefinition["status"]
): PageDefinition {
  return { id, kind: "module", label, detail, icon, component, status };
}

function appPage(
  id: string,
  label: string,
  detail: string,
  icon: PageDefinition["icon"],
  component: PageDefinition["component"],
  status: PageDefinition["status"]
): PageDefinition {
  return { id, kind: "app", label, detail, icon, component, status };
}

function debugPage(
  id: string,
  label: string,
  detail: string,
  icon: PageDefinition["icon"],
  component: PageDefinition["component"]
): PageDefinition {
  return { id, kind: "debug", label, detail, icon, component, status: () => "online" };
}

export function canonicalPageId(id: string): string {
  if (id === "io") {
    return "io-expander";
  }
  return id;
}
