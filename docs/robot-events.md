# Robot Event 与传感器数据格式

本文档描述固件通过 `robot.event` 推送到 daemon/UI 的事件、对应传感器、功能、刷新频率和数据格式。`/status`、`/status?full=1`、`/debug/snapshot` 都来自 daemon 内存里的最新事件状态。

## 事件总览

| event.kind | 对应硬件/模块 | 功能 | 更新频率 |
| --- | --- | --- | --- |
| `bmi270` | BMI270 + BMM150 aux | 加速度、陀螺仪、运动状态、磁力计、融合姿态 | 固件固定 10 Hz；固件内部姿态融合按 IMU 采样循环运行 |
| `proximity` | LTR553 | 接近传感器读数 | 固件固定 10 Hz |
| `ambientLight` | LTR553 | 环境光照读数 | 固件固定 10 Hz |
| `touch` | FT6336 屏幕触摸、SI12T 头部触摸 | 触摸手势、按下状态、屏幕坐标/点数 | 屏幕触摸按变化推送，最高约 10 Hz；头部触摸按手势事件推送 |
| `nfc` | ST25R3916 NFC | 标签进入/变化/移开、读取错误 | 事件驱动；当前固件接通事件通道和芯片读取错误事件 |
| `ir` | IR RX/TX GPIO/RMT | 收到红外码、接收错误、发送结果 | 事件驱动；当前固件实现 NEC RX，repeat 帧限流 |
| `hardwareStatus` | 低频硬件状态 | 电池、Wi-Fi/BLE、外设可用性、舵机、RGB、相机、RTC、NFC、INA226、IR、麦克风、I2C scan | 固件固定 2 Hz |
| `cameraFrame` | GC0308 相机 | JPEG 帧和链路 trace | 由 `cameraStream.fps` 或 UI raw preview 配置决定 |
| `image` | GC0308 相机 | 单张拍照返回 | `captureImage` 命令触发 |
| `state` | 本地状态机 | `idle/listening/speaking/...` 状态 | 状态变化或命令触发 |
| `commandAck` | 命令通道 | 命令接受/拒绝 | 命令触发 |
| `commandStatus` | 命令通道 | 命令执行进度/完成/失败 | 命令触发 |
| `playback` | 音频播放 | 播放开始/结束/失败 | 播放命令触发 |
| `faceTrackingControl` | 人脸追踪固件控制器 | PID 实际执行结果、舵机位置和 delta | 追踪 PID 应用时推送，最高约 8.3 Hz |
| `wakeWord` | 语音唤醒事件 | 唤醒词文本 | 真实语音唤醒时推送 |

## 数据格式

所有事件都包在同一个 envelope 内：

```ts
type RobotEventMessage = {
  type: "robot.event";
  seq?: number;
  eventId: string;
  deviceId: string;
  timestamp: string;
  event: RobotEvent;
};
```

独立高频/事件型传感器格式：

```ts
type Bmi270Event = {
  kind: "bmi270";
  motion: "shake" | "tilt" | "none";
  x?: number;
  y?: number;
  z?: number;
  gyroX?: number;
  gyroY?: number;
  gyroZ?: number;
  uptimeMs?: number;
  attitude?: {
    available: boolean;
    quaternion?: {
      w: number;
      x: number;
      y: number;
      z: number;
    };
    pitchDeg?: number;
    rollDeg?: number;
    yawDeg?: number;
    quality?: "unavailable" | "gyroAccel" | "gyroAccelMag" | "magnetometerRejected";
    magnetometerUsed?: boolean;
    sampleHz?: number;
  };
  magnetometer?: {
    available: boolean;
    x?: number; // BMM150 trim 补偿后的 X 轴磁场，单位 uT
    y?: number; // BMM150 trim 补偿后的 Y 轴磁场，单位 uT
    z?: number; // BMM150 trim 补偿后的 Z 轴磁场，单位 uT
    rawX?: number; // BMM150 原始 X 轴 ADC 解析值
    rawY?: number; // BMM150 原始 Y 轴 ADC 解析值
    rawZ?: number; // BMM150 原始 Z 轴 ADC 解析值
    headingDeg?: number;
    reason?: string;
  };
};

type ProximityEvent = {
  kind: "proximity";
  available: boolean;
  value?: number;
  raw?: number;
  uptimeMs?: number;
  reason?: string;
};

type AmbientLightEvent = {
  kind: "ambientLight";
  available: boolean;
  lux?: number;
  raw?: number;
  uptimeMs?: number;
  reason?: string;
};

type TouchEvent = {
  kind: "touch";
  gesture: "tap" | "doubleTap" | "longPress" | "pet" | "press" | "release" | "swipeForward" | "swipeBackward";
  surface?: "head" | "screen";
  pressed?: boolean;
  x?: number;
  y?: number;
  points?: number;
};

type NfcEvent = {
  kind: "nfc";
  action: "tagDetected" | "tagChanged" | "tagRemoved" | "readError";
  uptimeMs: number;
  uid?: string;
  tech?: "iso14443a" | "iso14443b" | "felica" | "iso15693" | "unknown";
  atqa?: string;
  sak?: number;
  reason?: string;
};

type IrEvent = {
  kind: "ir";
  action: "received" | "receiveError" | "transmitStarted" | "transmitCompleted" | "transmitFailed";
  uptimeMs: number;
  protocol?: "nec" | "sony" | "rc5" | "rc6" | "raw" | "unknown";
  address?: string;
  command?: string;
  code?: string;
  bits?: number;
  repeat?: boolean;
  requestId?: string;
  carrierHz?: number;
  reason?: string;
};

type FaceTrackingControlEvent = {
  kind: "faceTrackingControl";
  action: "applied" | "deadband" | "ignored";
  uptimeMs: number;
  targetAgeMs?: number;
  centerX?: number;
  centerY?: number;
  errorX?: number;
  errorY?: number;
  currentYaw?: number;
  currentPitch?: number;
  nextYaw?: number;
  nextPitch?: number;
  yawDelta?: number;
  pitchDelta?: number;
  yawOutputDeg?: number;
  pitchOutputDeg?: number;
  yawDirection?: -1 | 1;
  pitchDirection?: -1 | 1;
  speed?: number;
  reason?: string;
};
```

`bmi270.attitude` 由固件端 Mahony 姿态融合产生：陀螺仪负责短期积分，加速度计约束重力方向，磁力计在磁场强度通过动态范围检查时参与 yaw 修正。磁力计不可用或被判定异常时，融合会退化为 `gyroAccel`，保留 pitch/roll 修正但 yaw 仍可能随时间漂移。UI 的 3D 视图优先使用 `attitude.quaternion`，没有该字段时才回退到浏览器端的加速度姿态和 `gyroZ` 积分。

低频 `hardwareStatus` 当前格式：

```ts
type HardwareStatusEvent = {
  kind: "hardwareStatus";
  uptimeMs: number;
  power?: {
    batteryLevel?: number;
    charging?: boolean;
    backlight?: number;
    speakerVolume?: number;
  };
  network?: {
    wifi?: {
      status: "disconnected" | "connecting" | "connected";
      rssi?: number;
      ssid?: string;
    };
    ble?: {
      connected?: boolean;
      reason?: string;
    };
  };
  motion?: {
    servos?: {
      power?: boolean;
      reason?: string;
    };
  };
  peripherals?: {
    headTouch?: {
      available: boolean;
      reason?: string;
    };
    screenTouch?: {
      available: boolean;
      reason?: string;
    };
    ioExpander?: Availability;
    camera?: {
      available: boolean;
      streaming?: boolean;
      reason?: string;
    };
    rgb?: { available: boolean; enabled?: boolean; reason?: string };
    rtc?: { available: boolean; timestamp?: string; timezone?: string; reason?: string };
    nfc?: { available: boolean; reason?: string };
    powerMonitor?: { available: boolean; busVoltage?: number; shuntVoltage?: number; current?: number; power?: number; reason?: string };
    ir?: Availability;
    mic?: {
      available: boolean;
      reason?: string;
    };
    i2cScan?: Array<{
      stage: string;
      uptimeMs: number;
      addresses: number[];
      targets?: { ltr553?: boolean; ina226?: boolean; nfc?: boolean };
      reason?: string;
    }>;
  };
};

type Availability = {
  available: boolean;
  reason?: string;
};
```
