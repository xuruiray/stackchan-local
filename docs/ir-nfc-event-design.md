# IR / NFC 事件驱动实现说明

本文档描述新增 `ir` 和 `nfc` 两类 `robot.event` 的协议形态、固件触发方式和 desktop 消费方式。`hardwareStatus.peripherals.ir/nfc.available` 仍只表示硬件是否可用；动作事件通过独立 `robot.event` 推送。

## 设计原则

| 原则 | 说明 |
| --- | --- |
| 状态归 `hardwareStatus` | 硬件是否存在、是否可用、不可用原因继续放在 `hardwareStatus.peripherals.ir/nfc`。 |
| 动作归独立 event | 刷到 NFC 标签、标签移开、收到 IR 编码、IR 发送结果都通过独立 `robot.event` 推送。 |
| 不重复字段 | event 内不再带 `available` 等硬件状态字段；UI 可以从 `hardwareStatus` 读可用性，从独立 event 读最近动作。 |
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
| `nfc` | 已接通协议、daemon 缓存、UI 展示和固件发送通道；当前仓库只有 ST25R3916 芯片身份探测，没有 NFC-A/RFAL 标签读取栈，因此不会伪造 `tagDetected`，目前只在芯片读取失败时推送真实 `readError`。 |

## NFC event

建议 event 名称用 `nfc`，不要放回 `hardwareStatus.peripherals.nfc.status`。`hardwareStatus` 只表达 NFC 芯片是否可用；标签是否存在是交互事件。

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
| `uid` | `tagDetected` / `tagChanged` | 标签 UID，建议大写 hex，不带分隔符，例如 `04A1B2C3D4`。 |
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

建议 event 名称用 `ir`。IR 有 RX 和 TX 两类动作，但可以放在同一个 event kind 下，用 `action` 区分。

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
| `address` | `received` / transmit 系列 | 解码出的地址，建议大写 hex，不带 `0x`。 |
| `command` | `received` / transmit 系列 | 解码出的命令，建议大写 hex，不带 `0x`。 |
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

## 固件实现方案

### NFC

当前 `NfcProbe` 只做 ST25R3916 芯片身份探测，没有标签检测逻辑。当前实现已保留事件通道，但不会伪造标签 UID。要做到刷卡触发 `nfc` event，需要继续新增 NFC 运行时服务：

1. 初始化 ST25R3916，保留现有 chip probe 作为 `hardwareStatus.peripherals.nfc.available` 来源。
2. NFC 服务维护上一张标签 UID 和 presence 状态。
3. 检测到 UID 从空变为有，入队 `tagDetected`。
4. 检测到 UID 改变，入队 `tagChanged`。
5. 连续 N 次未读到上一张标签，入队 `tagRemoved`，避免抖动。
6. 读取异常且 NFC 芯片仍可用，入队 `readError`，但需要限流。

真正的硬件主动触发依赖 ST25R3916 IRQ 引脚。如果板子 IRQ 已接到 ESP32 GPIO，推荐使用 GPIO interrupt 唤醒 NFC task，然后读取 ST25R3916 IRQ/status/FIFO。若当前板级代码没有 IRQ 引脚定义，则第一版只能用低频扫描实现“边沿触发上报”：内部 20 Hz 左右扫描，只有状态变化才发 event，页面和 daemon 仍然不是轮询。

### IR

当前 `IrGpio` 已接入 RMT RX，第一版实现 NEC 接收：

1. RX 使用 RMT receive channel 绑定 `GPIO_NUM_10`。
2. RMT 完成一段脉冲接收后，把 pulse buffer 入队。
3. `LocalCompanion` sensor task 轮询队列并解析 NEC 正常帧和 repeat 帧。
4. 成功解码推送 `received`。
5. 解码失败但确实收到脉冲，限流推送 `receiveError`。
6. NEC repeat 帧上报 `repeat: true`，并限制 repeat event 频率，避免长按遥控器刷屏。
7. TX 引脚 `GPIO_NUM_5` 仍保持 GPIO 输出配置；如果后续新增 IR 发送 command，再启用 RMT TX 和 `transmitStarted/transmitCompleted/transmitFailed`。

`rawPulsesUs` 不建议放进默认事件。它会让 payload 变大，也会把 UI 和 snapshot 重新拖回大数据问题。需要调试时可以以后加 `debug` 命令按需返回。

## Desktop / 协议改动点

| 位置 | 改动 |
| --- | --- |
| `protocol/src/types.ts` | `RobotEvent` union 增加 `NfcEvent` 和 `IrEvent`。 |
| `protocol/src/schemas.ts` | `robotEventSchema.event.oneOf` 增加 `nfc` / `ir` schema。 |
| `desktop/src/device/registry.ts` | `SensorEventKind` 增加 `nfc` / `ir`，保存最近一次事件。 |
| UI NFC 页面 | 从 `hardwareStatus.peripherals.nfc.available` 显示硬件状态，从 `sensors.nfc` 显示最近刷卡动作。 |
| UI IR 页面 | 从 `hardwareStatus.peripherals.ir.available` 显示硬件状态，从 `sensors.ir` 显示最近接收/发送动作。 |
| `docs/robot-events.md` | 已把 `nfc` / `ir` 加入正式事件列表。 |

## Review 决策点

| 问题 | 建议 |
| --- | --- |
| NFC 是否上报完整 UID | 默认上报完整 UID，方便本地调试和自动化；如果担心隐私，可以改成只显示后 4 字节或 hash。 |
| NFC 第一版是否必须硬件 IRQ | 如果板子 IRQ 已接线，直接做 IRQ；如果代码里暂时没有 IRQ pin，先做低频扫描 + 边沿触发 event。 |
| IR 第一版是否包含 TX 事件 | 建议第一版先做 RX `received/receiveError`；TX 事件等有 IR send command 时启用。 |
| IR 是否上报 raw pulse | 默认不上报，避免大 payload；只保留未来 debug 开关。 |
| 事件是否进入 `/status?full=1` | 可以保留最近一次 `sensors.nfc` / `sensors.ir`，但不要把历史事件数组塞进 status/snapshot。 |
