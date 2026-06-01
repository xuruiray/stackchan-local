# IR / NFC 事件驱动实现说明

本文档描述新增 `ir` 和 `nfc` 两类 `robot.event` 的协议形态、固件触发方式和 desktop 消费方式。`hardwareStatus.peripherals.ir/nfc.available` 仍只表示硬件是否可用；动作事件通过独立 `robot.event` 推送。

## 当前数据边界

| 原则 | 说明 |
| --- | --- |
| 状态归 `hardwareStatus` | 硬件是否存在、是否可用、不可用原因继续放在 `hardwareStatus.peripherals.ir/nfc`。 |
| 动作归独立 event | 刷到 NFC 标签、标签移开、收到 IR 编码、IR 发送结果都通过独立 `robot.event` 推送。 |
| 不重复字段 | event 内只带动作数据；UI 从 `hardwareStatus` 读可用性，从独立 event 读最近动作。 |
| 不固定刷新率 | `ir` / `nfc` 都不是 10 Hz 传感器流，只有发生变化或动作完成时推送。 |
| 固件不从中断里发 WS | 硬件中断或检测任务只入队；`local_companion` 任务统一序列化并发送 `robot.event`。 |

## 新增事件总览

| event.kind | 对应硬件/模块 | 功能 | 推送频率 |
| --- | --- | --- | --- |
| `nfc` | ST25R3916 NFC | 标签进入、标签变化、标签移开、读取错误 | 事件驱动；同一标签驻留期间不重复推送 |
| `ir` | IR RX/TX GPIO/RMT | 收到红外遥控码、接收错误、发送完成/失败 | 事件驱动；每个有效帧或发送动作一次，repeat 帧限流 |

当前实现状态：

| event.kind | 当前固件实现 |
| --- | --- |
| `ir` | 已用 ESP-IDF RMT RX 接入 `GPIO_NUM_10`，支持 NEC 正常帧和 repeat 帧，解码失败会限流推送 `receiveError`。 |
| `nfc` | 协议、daemon 缓存、UI 展示和固件发送通道已接通；当前固件使用 ST25R3916 芯片身份探测，芯片读取失败时推送 `readError`。 |

## NFC event

`hardwareStatus` 只表达 NFC 芯片是否可用；标签是否存在、变化或读取失败通过独立 `nfc` event 表达。

```ts
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
```

字段说明：

| 字段 | 适用 action | 含义 |
| --- | --- | --- |
| `kind` | 全部 | 固定为 `nfc`。 |
| `action` | 全部 | NFC 标签动作类型。 |
| `uptimeMs` | 全部 | 固件运行时间，和现有传感器事件保持一致。 |
| `uid` | `tagDetected` / `tagChanged` | 标签 UID，大写 hex，不带分隔符，例如 `04A1B2C3D4`。 |
| `tech` | `tagDetected` / `tagChanged` | 标签协议类型，读不到时不传或传 `unknown`。 |
| `atqa` | `tagDetected` / `tagChanged` | ISO14443A ATQA，只有驱动读到时上报。 |
| `sak` | `tagDetected` / `tagChanged` | ISO14443A SAK，只有驱动读到时上报。 |
| `reason` | `readError` | 读取失败原因。 |

action 语义：

| action | 触发条件 | 必填字段 |
| --- | --- | --- |
| `tagDetected` | 上一状态没有标签，现在读到标签 | `uid` |
| `tagChanged` | 标签仍在场内，但 UID 从上一个值变成新值 | `uid` |
| `tagRemoved` | 连续若干次未读到上一张标签，判定移开 | 无 |
| `readError` | NFC 芯片可用，但标签检测/读取过程失败 | `reason` |

示例：

```json
{
  "type": "robot.event",
  "eventId": "evt-123",
  "deviceId": "44:1B:F6:E1:EF:C8",
  "timestamp": "2026-05-30T12:00:00.000Z",
  "event": {
    "kind": "nfc",
    "action": "tagDetected",
    "uptimeMs": 81234,
    "uid": "04A1B2C3D4",
    "tech": "iso14443a",
    "atqa": "0044",
    "sak": 8
  }
}
```

## IR event

IR event 名称为 `ir`。IR 有 RX 和 TX 两类动作，使用同一个 event kind，并用 `action` 区分。

```ts
type IrEvent = {
  kind: "ir";
  action:
    | "received"
    | "receiveError"
    | "transmitStarted"
    | "transmitCompleted"
    | "transmitFailed";
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
```

字段说明：

| 字段 | 适用 action | 含义 |
| --- | --- | --- |
| `kind` | 全部 | 固定为 `ir`。 |
| `action` | 全部 | IR 动作类型。 |
| `uptimeMs` | 全部 | 固件运行时间。 |
| `protocol` | `received` / transmit 系列 | 解码或发送协议。 |
| `address` | `received` / transmit 系列 | 解码出的地址，大写 hex，不带 `0x`。 |
| `command` | `received` / transmit 系列 | 解码出的命令，大写 hex，不带 `0x`。 |
| `code` | `received` / transmit 系列 | 协议无法拆成 `address/command` 时使用的完整码值。避免同时固定发送 `address/command/code` 三套重复数据。 |
| `bits` | `received` / transmit 系列 | `code` 的有效 bit 数，只有需要解释完整码值时上报。 |
| `repeat` | `received` | 是否为协议 repeat 帧。repeat 帧需要限流。 |
| `requestId` | transmit 系列 | 对应发送命令 ID。没有 IR 发送命令时可以先不实现 transmit 系列。 |
| `carrierHz` | transmit 系列 | 发送载波频率，例如 `38000`。 |
| `reason` | `receiveError` / `transmitFailed` | 失败原因。 |

action 语义：

| action | 触发条件 | 必填字段 |
| --- | --- | --- |
| `received` | RMT RX 收到并成功解码一个 IR 帧 | `protocol`，以及 `address/command` 或 `code/bits` |
| `receiveError` | 收到脉冲但无法解码，且不是普通空闲 | `reason` |
| `transmitStarted` | IR 发送命令开始执行 | `requestId` |
| `transmitCompleted` | IR 发送命令完成 | `requestId` |
| `transmitFailed` | IR 发送命令失败 | `requestId`、`reason` |

示例：

```json
{
  "type": "robot.event",
  "eventId": "evt-124",
  "deviceId": "44:1B:F6:E1:EF:C8",
  "timestamp": "2026-05-30T12:00:01.000Z",
  "event": {
    "kind": "ir",
    "action": "received",
    "uptimeMs": 82120,
    "protocol": "nec",
    "address": "00FF",
    "command": "18",
    "repeat": false
  }
}
```

## 当前实现

| 位置 | 当前状态 |
| --- | --- |
| `protocol/src/types.ts` | `RobotEvent` union 增加 `NfcEvent` 和 `IrEvent`。 |
| `protocol/src/schemas.ts` | `robotEventSchema.event.oneOf` 增加 `nfc` / `ir` schema。 |
| `desktop/src/device/registry.ts` | `SensorEventKind` 增加 `nfc` / `ir`，保存最近一次事件。 |
| UI NFC 页面 | 从 `hardwareStatus.peripherals.nfc.available` 显示硬件状态，从 `sensors.nfc` 显示最近刷卡动作。 |
| UI IR 页面 | 从 `hardwareStatus.peripherals.ir.available` 显示硬件状态，从 `sensors.ir` 显示最近接收/发送动作。 |
| 固件 NFC | 使用 ST25R3916 芯片探测结果作为 `hardwareStatus.peripherals.nfc.available` 来源；事件通道支持 `nfc` event。 |
| 固件 IR | RMT RX 绑定 `GPIO_NUM_10`，解析 NEC 正常帧和 repeat 帧，推送 `received` 或限流 `receiveError`。 |
