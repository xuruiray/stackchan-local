# 人脸追踪稳定性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 修复当前 OpenCV YuNet 人脸追踪偶发剧烈摇头、突然单侧转头、丢脸后重捕获不稳定的问题，让追踪闭环可以被日志验证、参数可校准、硬件动作受限且可预测。

**Architecture:** Desktop 继续负责摄像头帧接收、OpenCV 人脸检测、目标选择和 `trackFace` 命令发送；固件负责最终闭环控制、舵机限幅和执行日志上报。WebSocket envelope 不变，只按需要更新 `trackFace` 控制参数和新增控制诊断事件。

**Tech Stack:** TypeScript desktop daemon, Python OpenCV detector, JSON schema protocol, ESP32-S3 firmware C++, local SSE/WebSocket telemetry.

---

## 当前证据

最近一次日志会话范围：`2026-06-01T08:50:32.677Z` 到 `2026-06-01T08:51:29.519Z`。

采样结果：

- 总事件数：592
- OpenCV detection 事件：516
- `target_ready`：37
- `no_face`：479
- desktop 下发 `trackFace` 命令：37
- 小面积目标命令：0
- desktop 估算输出被 clamp 的命令：0
- 旧检测器曾出现多个 cascade 来源混用；当前实现已直接切到 YuNet，检测来源固定为 `yunet`。

关键现象：

- 第一个命令在 `2026-06-01T08:50:34.474Z`，目标中心约 `(0.686, 0.202)`，估算 yaw servo delta `+78.1`、pitch servo delta `+89.4`。
- `08:50:34.474` 到 `08:50:39.085` 期间共 37 条命令，目标大多停留在画面右上区域，按固件约 120 ms 控制周期估算，可能累计 yaw `+850.1`、pitch `+847.4` servo 单位。
- `2026-06-01T08:50:42.563Z` 在连续 32 帧 no-face 后重新识别，目标从 `(0.572, 0.367)` 跳到 `(0.509, 0.738)`，估算 pitch servo delta `-77.6`。
- 之后约 47 秒没有稳定目标，直到用户关闭追踪。

判断：

- 这不是页面渲染或 WebSocket 延迟的主要问题。
- 当前最可疑的是闭环控制正反馈或增益过大：如果目标持续偏右/偏上，舵机没有把误差拉回中心，而是继续累计往一侧走，会表现为突然大幅转头。
- 固件侧如果按“每个控制周期都把 PID 输出当位置增量”执行，连续几十条同方向误差会累积成大角度动作。
- 当前检测质量主要由 YuNet `score_threshold`、`nms_threshold` 和相机画质决定。
- 删除 desktop 目标门控、丢脸逻辑和命令限频后，desktop 不再帮固件挡住跳变，需要通过方向校准、参数收敛和检测源约束来降低误动作。

---

## 目标

- 人脸在画面中心附近时，舵机不持续漂移，静态抖动小于约 2 度。
- 人脸在左、右、上、下移动时，舵机方向正确，连续 2 条控制周期内误差开始变小。
- 人脸快速移动时，舵机跟随不滞后，但单个控制周期不能产生剧烈跳变。
- 重捕获后第一批目标不能直接造成大幅舵机跳变。
- 日志中能同时看到 desktop 检测目标、desktop 下发命令、固件实际应用的当前角度、目标角度和 delta。

---

## 非目标

- 不回滚到 MediaPipe。
- 不恢复 desktop 目标门控、desktop `face_lost`、desktop 命令限频。
- 不修改 WebSocket transport、握手、`cameraFrame`、`mediaFlowControl`。
- 不做大规模 UI 改版，只补充校准和诊断需要的控件。

---

## 总体方案

### 1. 先补齐固件执行日志

当前 desktop 只能估算固件动作，不能看到真实执行结果。先新增固件控制诊断事件，让每个控制周期能记录：

- 当前目标是否有效
- 目标 age
- 当前 yaw/pitch servo 位置
- 下一步 yaw/pitch servo 位置
- yaw/pitch delta
- 控制输出
- deadband、ignored 的原因

建议新增事件：

```ts
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
  yawOutputPerSec?: number;
  pitchOutputPerSec?: number;
  reason?: string;
};
```

这个事件只用于诊断，不改变命令链路。

### 2. 校准 yaw/pitch 方向

必须先验证方向，否则任何 PID 参数都会失效。硬件验收动作：

- 人脸在画面右侧时，固件执行后 `centerX - 0.5` 应该减小。
- 人脸在画面左侧时，固件执行后 `centerX - 0.5` 应该增大。
- 人脸在画面上方时，固件执行后 `centerY - 0.5` 应该增大或减小，取决于当前图像坐标定义，但下一帧误差绝对值必须变小。
- 人脸在画面下方时同理。

建议在 `FaceTrackingControl` 加方向参数，desktop UI 和环境变量都能配置：

```ts
type FaceTrackingControl = {
  mode: "opencvCenterPid";
  deadband: number;
  yaw: { kp: number; ki: number; kd: number; direction: -1 | 1 };
  pitch: { kp: number; ki: number; kd: number; direction: -1 | 1 };
  outputLimit: number;
  speed: number;
};
```

如果为了减少协议改动，也可以先把方向作为固件常量落地；但推荐放进 control schema，方便现场校准。

### 3. 使用 YuNet 真实 score 降低误识别影响

当前 sidecar 不再保留 cascade 逻辑，只使用 OpenCV `FaceDetectorYN` 加载 YuNet ONNX 模型：

```text
STACKCHAN_FACE_TRACKING_YUNET_MODEL=desktop/models/face_detection_yunet_2023mar.onnx
STACKCHAN_FACE_TRACKING_YUNET_SCORE_THRESHOLD=0.85
STACKCHAN_FACE_TRACKING_YUNET_NMS_THRESHOLD=0.3
STACKCHAN_FACE_TRACKING_YUNET_TOP_K=500
```

目标选择评分：

```text
score =
  areaWeight * area
  + confidenceWeight * confidence
  - centerWeight * distanceFromCenter
```

### 4. 增加离线日志分析脚本

新增脚本把当前手动分析固化，避免每次靠临时命令判断：

```bash
node desktop/scripts/analyze_face_tracking_log.mjs logs/face-tracking.ndjson
```

输出：

- 最近一次追踪会话时间范围
- detection / target_ready / no_face / command / firmware applied 数量
- detector 来源占比
- top 10 目标跳变
- top 10 servo delta
- no-face streak 分布
- desktop 估算 delta 与固件实际 delta 对比
- 方向校准建议

---

## 具体实施步骤

### Task 1: 新增日志分析脚本

- [x] 创建 `desktop/scripts/analyze_face_tracking_log.mjs`
- [x] 解析 NDJSON 日志，自动找到最近一次 tracking enabled 到 disabled 的会话
- [x] 汇总 detection、command、firmware control event
- [x] 打印 top jumps、top servo deltas、no-face streak
- [x] 用当前日志跑一次，保存输出到终端结论

验证命令：

```bash
node desktop/scripts/analyze_face_tracking_log.mjs logs/face-tracking.ndjson
```

### Task 2: 新增固件控制诊断事件

- [x] 在 `protocol/src/types.ts` 增加 `FaceTrackingControlEvent`
- [x] 在 `protocol/src/schemas.ts` 增加 schema 校验
- [x] 在 firmware 的 `sync_face_tracking()` 中发送 `faceTrackingControl`
- [x] desktop 收到该事件后写入现有 face tracking 日志文件
- [x] UI Preview diagnostics 显示最新 `currentYaw/currentPitch/nextYaw/nextPitch/yawDelta/pitchDelta`

验证命令：

```bash
npm run typecheck -w protocol
npm run typecheck -w desktop
npm run test -w protocol
```

### Task 3: 增加方向校准参数

- [x] 更新 `FaceTrackingControl` schema，增加 yaw/pitch `direction`
- [ ] desktop 默认值从环境变量读取：

```text
STACKCHAN_FACE_TRACKING_YAW_DIRECTION=1
STACKCHAN_FACE_TRACKING_PITCH_DIRECTION=1
```

- [x] UI 增加 yaw/pitch direction 控件
- [x] firmware 读取 direction，并在输出前应用
- [x] 记录 direction 到 `faceTrackingControl` 事件

验收：

- [ ] 人脸在画面右侧，连续 2 条 applied 后水平误差变小
- [ ] 人脸在画面左侧，连续 2 条 applied 后水平误差变小
- [ ] 人脸在画面上方，连续 2 条 applied 后垂直误差变小
- [ ] 人脸在画面下方，连续 2 条 applied 后垂直误差变小

### Task 6: OpenCV YuNet detector

- [x] `desktop/scripts/face_detector.py` 只使用 YuNet `FaceDetectorYN`
- [x] desktop 配置增加 YuNet model/score/NMS/topK 参数
- [x] 检测输出真实 `confidence`
- [x] 检测输出 `detector="yunet"` 和 5 点 landmarks
- [x] 移除旧 cascade 选择策略逻辑

验证：

- [ ] 日志中 `target.detector` 固定为 `yunet`
- [ ] 调高 score threshold 后误检减少
- [ ] 页面显示的 confidence 来自 YuNet 真实 score

### Task 7: UI 诊断补充

- [x] Face Tracking 页面显示当前目标 detector、area、center、delta distance
- [x] 显示固件 applied/deadband/ignored 状态
- [x] 显示固件当前 yaw/pitch、next yaw/pitch、delta
- [x] 显示 target age 和 no-face streak

### Task 8: 文档更新

- [x] 更新 `docs/face-tracking-pipeline.md`
- [x] 更新 `docs/robot-command-protocol.md`
- [x] 如果新增事件，更新 `docs/robot-events.md`
- [x] 文档只保留当前协议，不保留已删除字段

---

## 推荐实施顺序

1. 先做 Task 1 和 Task 2，只增加可观测性，不改控制行为。
2. 用新日志确认固件真实 yaw/pitch delta 是否与 desktop 估算一致。
3. 做 Task 3，先把方向校准正确。
4. 做 Task 6，把 OpenCV profile/flipped 对控制的影响降下来。
5. 做 Task 7 和 Task 8，补齐 UI 和文档。

---

## 测试计划

协议和 desktop：

```bash
npm run typecheck -w protocol
npm run typecheck -w desktop
npm run test -w protocol
npm run test -w desktop -- --run test/vision-tracking.test.ts
```

固件：

```bash
npm run firmware:check-local-only
npm run firmware:build
```

硬件验收：

- [ ] 人脸在画面中心 10 秒，舵机不持续漂移。
- [ ] 人脸移动到左侧，yaw 方向正确，误差绝对值下降。
- [ ] 人脸移动到右侧，yaw 方向正确，误差绝对值下降。
- [ ] 人脸移动到上方，pitch 方向正确，误差绝对值下降。
- [ ] 人脸移动到下方，pitch 方向正确，误差绝对值下降。
- [ ] 连续追踪 60 秒，不出现突然单侧大幅转头。

---

## 风险和处理

- 如果方向仍然不确定，先只启用单轴测试：固定 pitch，只测 yaw；再固定 yaw，只测 pitch。
- 如果 YuNet 检出率太低，先降低 `STACKCHAN_FACE_TRACKING_YUNET_SCORE_THRESHOLD`，不要恢复 cascade fallback。
- 如果出现高频抖动，优先提高 deadband、降低 `kd`、增加 derivative 低通。

---

## 临时缓解参数

在完整控制器改造前，可以先用更保守参数降低剧烈动作概率：

```text
speed = 300
deadband = 0.08
yaw.kp = 14
yaw.ki = 0
yaw.kd = 1.2
pitch.kp = 10
pitch.ki = 0
pitch.kd = 1.0
outputLimit = 3
```

这只是临时止血。根本修复仍然是固件执行日志、方向校准和 YuNet score 约束。
