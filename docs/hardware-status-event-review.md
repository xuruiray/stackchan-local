# HardwareStatusEvent 字段审计

本文档审计当前 `HardwareStatusEvent` 的字段含义，并按“是否属于状态类数据”分类。这里采用偏严格的定义：

- 状态类：设备或模块当前是否可用、是否连接、是否启用、是否正在运行、当前处于哪个离散状态。
- 可接受的状态上下文：用于解释状态的 `reason`，以及低频配置/输出状态，例如音量、背光、RGB 当前颜色。
- 非状态类：连续传感器读数、性能计数、时间戳、调试扫描结果、帧参数/编码耗时等遥测数据。

## 当前结构

```ts
type HardwareStatusEvent = {
  kind: "hardwareStatus";
  uptimeMs: number;
  power?: HardwareStatusPower;
  network?: HardwareStatusNetwork;
  motion?: HardwareStatusMotion;
  peripherals?: HardwareStatusPeripherals;
};
```

## 字段审计

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `kind` | 事件类型，固定为 `hardwareStatus` | 元数据 | 保留 |
| `uptimeMs` | 固件启动后的毫秒数 | 非状态：事件/调试时间戳 | 严格状态结构中移除；如仍需要，放到通用 envelope 元数据 |

### `power`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `power.batteryLevel` | 电池电量百分比 | 状态：电源状态 | 保留 |
| `power.charging` | 是否正在充电 | 状态 | 保留 |
| `power.backlight` | 屏幕背光百分比 | 配置/输出状态 | 可保留 |
| `power.speakerVolume` | 扬声器音量百分比 | 配置/输出状态 | 可保留 |
| `power.servoPower` | 舵机电源是否打开 | 状态，但与 `motion.servos.power` 重复 | 已删除，统一使用 `motion.servos.power` |

### `network`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `network.wifi.status` | Wi-Fi 连接状态 | 状态 | 保留 |
| `network.wifi.rssi` | Wi-Fi 信号强度 dBm | 非状态：网络测量值 | 移到独立网络遥测，或只在 debug 里展示 |
| `network.wifi.ssid` | 当前连接的 Wi-Fi 名称 | 状态上下文/配置标识 | 严格状态结构可移除；如 UI 需要可保留为上下文 |
| `network.ble.connected` | BLE 是否已连接 | 状态 | 保留 |
| `network.ble.reason` | BLE 状态原因 | 状态上下文 | 保留 |

### `motion.servos`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `motion.servos.power` | 舵机总电源状态 | 状态 | 保留 |
| `motion.servos.yaw.angle` | yaw 舵机当前角度 | 非状态：运动/位置遥测 | 移到独立 servo telemetry event |
| `motion.servos.yaw.moving` | yaw 舵机是否正在移动 | 状态 | 已删除 |
| `motion.servos.yaw.torque` | yaw 舵机扭矩是否启用 | 状态 | 已删除 |
| `motion.servos.pitch.angle` | pitch 舵机当前角度 | 非状态：运动/位置遥测 | 移到独立 servo telemetry event |
| `motion.servos.pitch.moving` | pitch 舵机是否正在移动 | 状态 | 已删除 |
| `motion.servos.pitch.torque` | pitch 舵机扭矩是否启用 | 状态 | 已删除 |
| `motion.servos.reason` | 舵机状态原因 | 状态上下文 | 保留 |

### `peripherals.headTouch`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.headTouch.available` | 头部触摸硬件是否可用 | 状态 | 保留 |
| `peripherals.headTouch.zones` | 当前触摸区域列表 | 非状态：输入传感器瞬时读数 | 已删除，使用 `touch` event |
| `peripherals.headTouch.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.ioExpander`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.ioExpander.available` | IO 扩展器是否可用 | 状态 | 保留 |
| `peripherals.ioExpander.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.camera`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.camera.available` | 相机硬件是否可用 | 状态 | 保留 |
| `peripherals.camera.streaming` | 相机是否正在推流 | 状态 | 保留 |
| `peripherals.camera.width` | 当前帧宽度 | 非状态：媒体流参数 | 移到 camera telemetry/stream status event |
| `peripherals.camera.height` | 当前帧高度 | 非状态：媒体流参数 | 移到 camera telemetry/stream status event |
| `peripherals.camera.fps` | 当前推流帧率 | 非状态：性能/流量遥测 | 移到 camera telemetry/stream status event |
| `peripherals.camera.requestedWidth` | 请求的推流宽度 | 配置，不是硬件状态 | 移到 camera stream config/status |
| `peripherals.camera.requestedHeight` | 请求的推流高度 | 配置，不是硬件状态 | 移到 camera stream config/status |
| `peripherals.camera.actualWidth` | 实际推流宽度 | 非状态：媒体流参数 | 移到 camera telemetry/stream status event |
| `peripherals.camera.actualHeight` | 实际推流高度 | 非状态：媒体流参数 | 移到 camera telemetry/stream status event |
| `peripherals.camera.quality` | JPEG 质量参数 | 配置，不是硬件状态 | 移到 camera stream config/status |
| `peripherals.camera.transport` | camera frame 传输方式 | 协议/流配置，不是硬件状态 | 移到 camera stream config/status |
| `peripherals.camera.adaptiveLevel` | 自适应降级等级 | 非状态：链路/调度遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastCaptureMs` | 最近一次采集耗时 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastEncodeMs` | 最近一次编码耗时 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastSendMs` | 最近一次发送耗时 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastTotalMs` | 最近一次总耗时 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastFrameIntervalMs` | 最近帧间隔 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.lastJpegBytes` | 最近 JPEG 大小 | 非状态：性能遥测 | 移到 camera telemetry 或 debug |
| `peripherals.camera.fallbackReason` | 相机降级原因 | 诊断上下文 | 可合并到 `reason` 或移到 camera telemetry |
| `peripherals.camera.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.rgb`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.rgb.available` | RGB 控制链路是否可用 | 状态 | 保留 |
| `peripherals.rgb.enabled` | RGB 是否启用 | 状态 | 保留 |
| `peripherals.rgb.color` | 当前 RGB 颜色 | 输出状态/配置 | 已删除 |
| `peripherals.rgb.brightness` | 当前 RGB 亮度 | 输出状态/配置 | 已删除 |
| `peripherals.rgb.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.rtc`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.rtc.available` | RTC 是否可用 | 状态 | 保留 |
| `peripherals.rtc.timestamp` | RTC 当前时间 | 非状态：时间读数，且 envelope 已有 `timestamp` | 移出或删除 |
| `peripherals.rtc.timezone` | 当前时区配置 | 配置，不是硬件状态 | 移到 system/config 状态或删除 |
| `peripherals.rtc.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.nfc`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.nfc.available` | NFC 探测/硬件是否可用 | 状态 | 保留 |
| `peripherals.nfc.status` | NFC 芯片/卡片状态 | 状态 | 已删除 |
| `peripherals.nfc.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.powerMonitor`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.powerMonitor.available` | INA226 是否可用 | 状态 | 保留 |
| `peripherals.powerMonitor.busVoltage` | 总线电压 | 非状态：电源测量值 | 移到独立 `powerMonitor`/`ina226` telemetry event |
| `peripherals.powerMonitor.shuntVoltage` | 分流电阻电压 | 非状态：电源测量值 | 移到独立 `powerMonitor`/`ina226` telemetry event |
| `peripherals.powerMonitor.current` | 电流 | 非状态：电源测量值 | 移到独立 `powerMonitor`/`ina226` telemetry event |
| `peripherals.powerMonitor.power` | 功率 | 非状态：电源测量值 | 移到独立 `powerMonitor`/`ina226` telemetry event |
| `peripherals.powerMonitor.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.ir`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.ir.available` | IR 收发硬件是否可用 | 状态 | 保留 |
| `peripherals.ir.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.mic`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.mic.available` | 麦克风链路是否可用 | 状态 | 保留 |
| `peripherals.mic.channels` | 麦克风通道数 | 硬件配置/能力 | 已删除 |
| `peripherals.mic.level` | 当前音量电平 | 非状态：音频测量值 | 已删除 |
| `peripherals.mic.rms` | RMS 音量 | 非状态：音频测量值 | 已删除 |
| `peripherals.mic.peak` | 峰值音量 | 非状态：音频测量值 | 已删除 |
| `peripherals.mic.dbfs` | dBFS 音量 | 非状态：音频测量值 | 已删除 |
| `peripherals.mic.updatedAt` | 麦克风测量更新时间 | 非状态：时间戳 | 已删除 |
| `peripherals.mic.reason` | 不可用原因 | 状态上下文 | 保留 |

### `peripherals.i2cScan`

| 字段 | 含义 | 分类 | 建议 |
| --- | --- | --- | --- |
| `peripherals.i2cScan[].stage` | I2C 扫描阶段 | 非状态：诊断数据 | 移到 debug/on-demand scan response |
| `peripherals.i2cScan[].uptimeMs` | 扫描发生的固件 uptime | 非状态：诊断时间戳 | 移到 debug/on-demand scan response |
| `peripherals.i2cScan[].addresses` | 扫描到的 I2C 地址 | 非状态：诊断数据 | 移到 debug/on-demand scan response |
| `peripherals.i2cScan[].targets` | 是否扫到目标设备 | 非状态：诊断数据；可派生出各模块 `available` | 不放入常规 `hardwareStatus` |
| `peripherals.i2cScan[].reason` | 扫描原因/说明 | 诊断上下文 | 移到 debug/on-demand scan response |

## 非状态字段汇总

如果目标是让 `HardwareStatusEvent` 只包含状态类数据，建议优先移出这些字段：

- `uptimeMs`
- `network.wifi.rssi`
- `network.wifi.ssid`，如果采用最严格定义
- `motion.servos.yaw.angle`
- `motion.servos.pitch.angle`
- `peripherals.headTouch.zones`
- `peripherals.camera.width`
- `peripherals.camera.height`
- `peripherals.camera.fps`
- `peripherals.camera.requestedWidth`
- `peripherals.camera.requestedHeight`
- `peripherals.camera.actualWidth`
- `peripherals.camera.actualHeight`
- `peripherals.camera.quality`
- `peripherals.camera.transport`
- `peripherals.camera.adaptiveLevel`
- `peripherals.camera.lastCaptureMs`
- `peripherals.camera.lastEncodeMs`
- `peripherals.camera.lastSendMs`
- `peripherals.camera.lastTotalMs`
- `peripherals.camera.lastFrameIntervalMs`
- `peripherals.camera.lastJpegBytes`
- `peripherals.camera.fallbackReason`
- `peripherals.rtc.timestamp`
- `peripherals.rtc.timezone`
- `peripherals.powerMonitor.busVoltage`
- `peripherals.powerMonitor.shuntVoltage`
- `peripherals.powerMonitor.current`
- `peripherals.powerMonitor.power`
- `peripherals.mic.level`
- `peripherals.mic.rms`
- `peripherals.mic.peak`
- `peripherals.mic.dbfs`
- `peripherals.mic.updatedAt`
- `peripherals.i2cScan`

## 建议的新结构

下面是一个偏严格的状态类 `HardwareStatusEvent` 目标形态：

```ts
type HardwareStatusEvent = {
  kind: "hardwareStatus";
  power?: {
    batteryLevel?: number;
    charging?: boolean;
    backlight?: number;
    speakerVolume?: number;
  };
  network?: {
    wifi?: {
      status: "disconnected" | "connecting" | "connected";
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
    headTouch?: Availability;
    ioExpander?: Availability;
    camera?: {
      available: boolean;
      streaming?: boolean;
      reason?: string;
    };
    rgb?: {
      available: boolean;
      enabled?: boolean;
      reason?: string;
    };
    rtc?: Availability;
    nfc?: {
      available: boolean;
      reason?: string;
    };
    powerMonitor?: Availability;
    ir?: Availability;
    mic?: {
      available: boolean;
      reason?: string;
    };
  };
};

type Availability = {
  available: boolean;
  reason?: string;
};
```

## 建议迁移出的事件

| 新事件/接口 | 承接字段 | 建议频率/触发方式 |
| --- | --- | --- |
| `servoTelemetry` | `yaw.angle`、`pitch.angle`，必要时包含 moving/torque 副本 | 10 Hz 或随舵机命令/运动变化推送 |
| `cameraStreamStatus` 或 `cameraTelemetry` | 分辨率、fps、quality、transport、adaptiveLevel、last*、lastJpegBytes、fallbackReason | 推流中 1 Hz；debug 页面可更高 |
| `powerMonitor` 或 `ina226` | `busVoltage`、`shuntVoltage`、`current`、`power` | 1-10 Hz，按 UI 需要 |
| `micTelemetry` | `level`、`rms`、`peak`、`dbfs`、`updatedAt` | 5-10 Hz 或仅 Audio 页面订阅 |
| `headTouch`/`touch` | `headTouch.zones` | 按变化推送 |
| `i2cScan` debug response | `i2cScan` 全部字段 | 仅用户点击扫描或 debug 请求时返回 |
| `rtcStatus` 或 system config | `rtc.timestamp`、`rtc.timezone` | 按需；多数情况下可用 envelope timestamp 替代 |

## 结论

当前 `HardwareStatusEvent` 不只是硬件状态，还承载了多类页面数据和调试遥测。最明显不属于状态类的是相机性能字段、INA226 数值、麦克风音量、I2C scan、舵机角度和触摸 zones。

建议下一步先把高价值遥测拆成独立事件：`servoTelemetry`、`powerMonitor`、`micTelemetry`、`cameraTelemetry`。拆完后 `HardwareStatusEvent` 可以稳定作为低频健康状态事件使用，`/status?full=1` 和 `/debug/snapshot` 也会更小、更清晰。
