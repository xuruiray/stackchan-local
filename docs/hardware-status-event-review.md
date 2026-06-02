# HardwareStatusEvent 字段审计

本文档按当前代码状态审计 `hardwareStatus` 事件。`hardwareStatus` 是低频健康状态事件，固件固定 2 Hz 推送；BMI270、ALS、Proximity、Touch、IR、NFC 等动作或高频数据通过独立 `robot.event` 推送。

## 当前结构

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
    headTouch?: Availability;
    screenTouch?: Availability;
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
    rtc?: {
      available: boolean;
      timestamp?: string;
      timezone?: string;
      reason?: string;
    };
    nfc?: Availability;
    powerMonitor?: {
      available: boolean;
      busVoltage?: number;
      shuntVoltage?: number;
      current?: number;
      power?: number;
      reason?: string;
    };
    ir?: Availability;
    mic?: Availability;
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

## 字段分类

| 字段 | 含义 | 分类 |
| --- | --- | --- |
| `kind` | 事件类型，固定 `hardwareStatus` | 元数据 |
| `uptimeMs` | 固件启动后的毫秒数 | 诊断时间戳 |
| `power.batteryLevel` | 电池电量百分比 | 电源状态 |
| `power.charging` | 是否正在充电 | 电源状态 |
| `power.backlight` | 屏幕背光百分比 | 输出状态 |
| `power.speakerVolume` | 扬声器音量百分比 | 输出状态 |
| `network.wifi.status` | Wi-Fi 连接状态 | 网络状态 |
| `network.wifi.rssi` | Wi-Fi 信号强度 | 网络测量值 |
| `network.wifi.ssid` | 当前 SSID | 网络上下文 |
| `network.ble.connected` | BLE 是否连接 | 网络状态 |
| `network.ble.reason` | BLE 状态原因 | 状态上下文 |
| `motion.servos.power` | 舵机总电源状态 | 执行器状态 |
| `motion.servos.reason` | 舵机状态原因 | 状态上下文 |
| `peripherals.*.available` | 外设是否可用 | 硬件状态 |
| `peripherals.*.reason` | 外设不可用原因 | 状态上下文 |
| `peripherals.camera.streaming` | 相机是否推流 | 运行状态 |
| `peripherals.rgb.enabled` | RGB 是否启用 | 输出状态 |
| `peripherals.rtc.timestamp` | RTC 当前时间 | 时间读数 |
| `peripherals.rtc.timezone` | RTC 时区 | 配置上下文 |
| `peripherals.powerMonitor.busVoltage` | INA226 总线电压 | 电源遥测 |
| `peripherals.powerMonitor.shuntVoltage` | INA226 分流电压 | 电源遥测 |
| `peripherals.powerMonitor.current` | INA226 电流 | 电源遥测 |
| `peripherals.powerMonitor.power` | INA226 功率 | 电源遥测 |
| `peripherals.i2cScan` | 最近 I2C 扫描结果 | 诊断数据 |

## 当前遥测和诊断字段

当前 `HardwareStatusEvent` 中仍有几类字段属于遥测或诊断数据：

- `uptimeMs`
- `network.wifi.rssi`
- `peripherals.rtc.timestamp`
- `peripherals.powerMonitor.busVoltage/shuntVoltage/current/power`
- `peripherals.i2cScan`

这些字段是当前协议的一部分。
