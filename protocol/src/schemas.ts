export const audioParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "sampleRate", "channels", "frameDurationMs"],
  properties: {
    format: { const: "opus" },
    sampleRate: { enum: [16000, 24000] },
    channels: { const: 1 },
    frameDurationMs: { enum: [20, 30, 40, 60] }
  }
} as const;

export const handshakeSchema = {
  $id: "https://stackchan.local/schemas/handshake.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "deviceId", "firmwareVersion", "capabilities", "audioParams", "pairingToken"],
  properties: {
    type: { const: "handshake" },
    deviceId: { type: "string", minLength: 1 },
    firmwareVersion: { type: "string", minLength: 1 },
    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        enum: [
          "audio",
          "camera",
          "motion",
          "face",
          "rgb",
          "touch",
          "imu",
          "battery",
          "wifi",
          "ble",
          "rtc",
          "servos",
          "nfc",
          "ir",
          "proximity",
          "ambientLight",
          "magnetometer",
          "mic",
          "display",
          "bleProvisioning",
          "mediaCredit"
        ]
      }
    },
    audioParams: audioParamsSchema,
    pairingToken: { type: "string", minLength: 1 }
  }
} as const;

export const daemonHelloSchema = {
  $id: "https://stackchan.local/schemas/daemon-hello.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "sessionId", "heartbeatIntervalMs", "featureFlags", "audioParams"],
  properties: {
    type: { const: "daemon.hello" },
    protocolVersion: { enum: ["1.1", "1.2"] },
    sessionId: { type: "string", minLength: 1 },
    heartbeatIntervalMs: { type: "integer", minimum: 1000 },
    featureFlags: { type: "array", items: { type: "string" } },
    featureParams: {
      type: "object",
      additionalProperties: false,
      properties: {
        binaryCameraFrame: {
          type: "object",
          additionalProperties: false,
          required: ["envelope", "cameraKind"],
          properties: {
            envelope: { const: "SCL1" },
            cameraKind: { const: 1 }
          }
        },
        mediaCredit: {
          type: "object",
          additionalProperties: false,
          required: ["defaultCreditFrames", "maxCreditFrames"],
          properties: {
            defaultCreditFrames: { type: "integer", minimum: 1, maximum: 60 },
            maxCreditFrames: { type: "integer", minimum: 1, maximum: 120 }
          }
        }
      }
    },
    qosProfiles: {
      type: "object",
      additionalProperties: false,
      required: ["robotCommand", "cameraFrame", "telemetry", "audio"],
      properties: {
        robotCommand: { const: "reliable" },
        cameraFrame: { const: "latestOnly" },
        telemetry: { const: "bestEffort" },
        audio: { const: "reliableChunked" }
      }
    },
    audioParams: audioParamsSchema
  }
} as const;

export const faceTrackingPidAxisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kp", "ki", "kd"],
  properties: {
    kp: { type: "number", minimum: 0, maximum: 150 },
    ki: { type: "number", minimum: 0, maximum: 50 },
    kd: { type: "number", minimum: 0, maximum: 80 }
  }
} as const;

export const normalizedFacePointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    z: { type: "number", minimum: -1, maximum: 1 }
  }
} as const;

export const faceLandmarksSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    all: {
      type: "array",
      maxItems: 478,
      items: normalizedFacePointSchema
    },
    nose: normalizedFacePointSchema,
    leftEye: normalizedFacePointSchema,
    rightEye: normalizedFacePointSchema,
    mouthLeft: normalizedFacePointSchema,
    mouthRight: normalizedFacePointSchema,
    mouthCenter: normalizedFacePointSchema,
    chin: normalizedFacePointSchema
  }
} as const;

export const facePoseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["yawDeg", "pitchDeg", "rollDeg"],
  properties: {
    yawDeg: { type: "number", minimum: -180, maximum: 180 },
    pitchDeg: { type: "number", minimum: -180, maximum: 180 },
    rollDeg: { type: "number", minimum: -180, maximum: 180 }
  }
} as const;

export const faceExpressionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    smile: { type: "number", minimum: 0, maximum: 1 },
    leftEyeOpen: { type: "number", minimum: 0, maximum: 1 },
    rightEyeOpen: { type: "number", minimum: 0, maximum: 1 },
    blendshapes: {
      type: "object",
      additionalProperties: { type: "number", minimum: 0, maximum: 1 }
    }
  }
} as const;

export const normalizedFaceBoxSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    trackingId: { oneOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
    landmarks: faceLandmarksSchema,
    pose: facePoseSchema,
    transformMatrix: {
      type: "array",
      minItems: 16,
      maxItems: 16,
      items: { type: "number", minimum: -10000, maximum: 10000 }
    },
    expression: faceExpressionSchema,
    detector: { type: "string", minLength: 1 }
  }
} as const;

export const faceServoRangeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["yawMin", "yawMax", "pitchMin", "pitchMax"],
  properties: {
    yawMin: { type: "number", minimum: -1800, maximum: 0 },
    yawMax: { type: "number", minimum: 0, maximum: 1800 },
    pitchMin: { type: "number", minimum: -900, maximum: 1200 },
    pitchMax: { type: "number", minimum: -900, maximum: 1200 }
  }
} as const;

export const faceTrackingControlSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "deadband", "yaw", "pitch", "integralLimit", "outputLimitDeg", "servoRange"],
  properties: {
    mode: { const: "pid" },
    deadband: { type: "number", minimum: 0, maximum: 0.3 },
    yaw: faceTrackingPidAxisSchema,
    pitch: faceTrackingPidAxisSchema,
    integralLimit: { type: "number", minimum: 0, maximum: 2 },
    outputLimitDeg: { type: "number", minimum: 1, maximum: 45 },
    servoRange: faceServoRangeSchema
  }
} as const;

export const robotCommandSchema = {
  $id: "https://stackchan.local/schemas/robot-command.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "commandId", "command"],
  properties: {
    type: { const: "robot.command" },
    seq: { type: "integer", minimum: 0 },
    commandId: { type: "string", minLength: 1 },
    command: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "text"],
          properties: {
            kind: { const: "say" },
            text: { type: "string", minLength: 1 },
            interrupt: { type: "boolean" },
            voice: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "emotion"],
          properties: {
            kind: { const: "react" },
            emotion: { enum: ["neutral", "happy", "sad", "angry", "surprised", "sleepy", "thinking", "love"] },
            durationMs: { type: "integer", minimum: 1 },
            avatarJson: { type: "object" },
            rgbJson: { type: "object" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "yaw", "pitch"],
          properties: {
            kind: { const: "moveHead" },
            yaw: { type: "number", minimum: -90, maximum: 90 },
            pitch: { type: "number", minimum: -45, maximum: 45 },
            speed: { type: "number", minimum: 0 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "enabled"],
          properties: {
            kind: { const: "cameraStream" },
            enabled: { type: "boolean" },
            fps: { type: "number", minimum: 1, maximum: 10 },
            width: { enum: [320, 640] },
            height: { enum: [240, 480] },
            quality: { type: "integer", minimum: 1, maximum: 100 },
            format: { const: "jpeg" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "detected"],
          properties: {
            kind: { const: "trackFace" },
            detected: { type: "boolean" },
            centerX: { type: "number", minimum: 0, maximum: 1 },
            centerY: { type: "number", minimum: 0, maximum: 1 },
            bbox: normalizedFaceBoxSchema,
            confidence: { type: "number", minimum: 0, maximum: 1 },
            speed: { type: "number", minimum: 0, maximum: 1000 },
            control: faceTrackingControlSchema,
            reason: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "sequence"],
          properties: {
            kind: { const: "playAnimation" },
            sequence: { type: "array" },
            loop: { type: "boolean" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId", "format", "mimeType", "sampleRate", "totalBytes", "totalChunks"],
          properties: {
            kind: { const: "playAudioStart" },
            requestId: { type: "string", minLength: 1 },
            format: { const: "ogg_opus" },
            mimeType: { const: "audio/ogg" },
            sampleRate: { enum: [16000, 24000] },
            totalBytes: { type: "integer", minimum: 1, maximum: 262144 },
            totalChunks: { type: "integer", minimum: 1, maximum: 128 },
            text: { type: "string" },
            interrupt: { type: "boolean" },
            volume: { type: "integer", minimum: 0, maximum: 100 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId", "chunkIndex", "dataBase64"],
          properties: {
            kind: { const: "playAudioChunk" },
            requestId: { type: "string", minLength: 1 },
            chunkIndex: { type: "integer", minimum: 0, maximum: 127 },
            dataBase64: { type: "string", minLength: 1, maxLength: 8192 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId"],
          properties: {
            kind: { const: "playAudioEnd" },
            requestId: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId"],
          properties: {
            kind: { const: "captureImage" },
            requestId: { type: "string", minLength: 1 },
            format: { const: "jpeg" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "mode"],
          properties: {
            kind: { const: "setMode" },
            mode: { enum: ["idle", "connecting", "listening", "thinking", "speaking", "pairing", "sleeping", "error"] },
            reason: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "enabled"],
          properties: {
            kind: { const: "setRgb" },
            enabled: { type: "boolean" },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            brightness: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { const: "telemetryConfig" },
            sensorSnapshotHz: { enum: [0, 0.5, 1] },
            imuHz: { enum: [0, 1, 2, 4] },
            includeI2cScan: { type: "boolean" },
            reason: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "stream", "creditFrames"],
          properties: {
            kind: { const: "mediaFlowControl" },
            stream: { const: "camera" },
            creditFrames: { type: "integer", minimum: 0, maximum: 120 },
            maxInFlight: { type: "integer", minimum: 1, maximum: 120 },
            reason: { type: "string" }
          }
        }
      ]
    }
  }
} as const;

const protocolTraceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    deviceCapturedAt: { type: "string", format: "date-time" },
    deviceSentAt: { type: "string", format: "date-time" },
    daemonReceivedAt: { type: "string", format: "date-time" },
    detectorStartedAt: { type: "string", format: "date-time" },
    detectorFinishedAt: { type: "string", format: "date-time" }
  }
} as const;

const availabilitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["available"],
  properties: {
    available: { type: "boolean" },
    reason: { type: "string" }
  }
} as const;

const servoTelemetrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    angle: { type: "number", minimum: -180, maximum: 180 },
    moving: { type: "boolean" },
    torque: { type: "boolean" }
  }
} as const;

const sensorSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "uptimeMs"],
  properties: {
    kind: { const: "sensorSnapshot" },
    uptimeMs: { type: "integer", minimum: 0 },
    power: {
      type: "object",
      additionalProperties: false,
      properties: {
        batteryLevel: { type: "number", minimum: 0, maximum: 100 },
        charging: { type: "boolean" },
        backlight: { type: "integer", minimum: 0, maximum: 100 },
        speakerVolume: { type: "integer", minimum: 0, maximum: 100 },
        servoPower: { type: "boolean" }
      }
    },
    network: {
      type: "object",
      additionalProperties: false,
      properties: {
        wifi: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { enum: ["disconnected", "connecting", "connected"] },
            rssi: { type: "number" },
            ssid: { type: "string" }
          }
        },
        ble: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            connected: { type: "boolean" },
            provisioning: { type: "boolean" },
            reason: { type: "string" }
          }
        }
      }
    },
    motion: {
      type: "object",
      additionalProperties: false,
      properties: {
        imu: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            motion: { enum: ["shake", "tilt", "none"] },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            gyroX: { type: "number" },
            gyroY: { type: "number" },
            gyroZ: { type: "number" },
            uptimeMs: { type: "integer", minimum: 0 },
            reason: { type: "string" }
          }
        },
        servos: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            yaw: servoTelemetrySchema,
            pitch: servoTelemetrySchema,
            power: { type: "boolean" },
            reason: { type: "string" }
          }
        }
      }
    },
    interaction: {
      type: "object",
      additionalProperties: false,
      properties: {
        screenTouch: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            pressed: { type: "boolean" },
            x: { type: "number", minimum: 0, maximum: 320 },
            y: { type: "number", minimum: 0, maximum: 240 },
            points: { type: "integer", minimum: 0, maximum: 5 },
            reason: { type: "string" }
          }
        },
        headTouch: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            gesture: { enum: ["tap", "doubleTap", "longPress", "pet", "press", "release", "swipeForward", "swipeBackward"] },
            pressed: { type: "boolean" },
            zones: {
              type: "array",
              maxItems: 3,
              items: { type: "integer", minimum: 0, maximum: 2 }
            },
            reason: { type: "string" }
          }
        },
        wakeWord: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            text: { type: "string" },
            reason: { type: "string" }
          }
        }
      }
    },
    peripherals: {
      type: "object",
      additionalProperties: false,
      properties: {
        ioExpander: availabilitySchema,
        camera: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            streaming: { type: "boolean" },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
            fps: { type: "number", minimum: 0, maximum: 30 },
            requestedWidth: { type: "integer", minimum: 1 },
            requestedHeight: { type: "integer", minimum: 1 },
            actualWidth: { type: "integer", minimum: 1 },
            actualHeight: { type: "integer", minimum: 1 },
            quality: { type: "integer", minimum: 1, maximum: 100 },
            transport: { enum: ["jsonBase64", "binary"] },
            adaptiveLevel: { type: "integer", minimum: 0, maximum: 5 },
            fallbackReason: { type: "string" },
            reason: { type: "string" }
          }
        },
        rgb: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            count: { type: "integer", minimum: 0, maximum: 64 },
            enabled: { type: "boolean" },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            brightness: { type: "number", minimum: 0, maximum: 1 },
            driver: { type: "string" },
            reason: { type: "string" }
          }
        },
        rtc: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            timestamp: { type: "string", format: "date-time" },
            timezone: { type: "string" },
            reason: { type: "string" }
          }
        },
        nfc: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            driver: { type: "string" },
            address: { type: "integer", minimum: 0, maximum: 127 },
            status: { enum: ["chip_detected", "ready", "card_detected", "inactive"] },
            reason: { type: "string" }
          }
        },
        powerMonitor: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            driver: { type: "string" },
            address: { type: "integer", minimum: 0, maximum: 127 },
            busVoltage: { type: "number", minimum: -0.1, maximum: 40 },
            shuntVoltage: { type: "number", minimum: -0.2, maximum: 0.2 },
            current: { type: "number", minimum: -20, maximum: 20 },
            power: { type: "number", minimum: -200, maximum: 200 },
            reason: { type: "string" }
          }
        },
        ir: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            driver: { type: "string" },
            txPin: { type: "integer", minimum: 0, maximum: 48 },
            rxPin: { type: "integer", minimum: 0, maximum: 48 },
            reason: { type: "string" }
          }
        },
        proximity: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            value: { type: "number", minimum: 0 },
            raw: { type: "number", minimum: 0 },
            driver: { type: "string" },
            reason: { type: "string" }
          }
        },
        ambientLight: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            lux: { type: "number", minimum: 0 },
            raw: { type: "number", minimum: 0 },
            driver: { type: "string" },
            reason: { type: "string" }
          }
        },
        magnetometer: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            rawX: { type: "number" },
            rawY: { type: "number" },
            rawZ: { type: "number" },
            headingDeg: { type: "number", minimum: 0, maximum: 360 },
            driver: { type: "string" },
            reason: { type: "string" }
          }
        },
        mic: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            channels: { type: "integer", minimum: 1, maximum: 2 },
            mode: { enum: ["mono_opus", "unknown"] },
            localization: { enum: ["abandoned", "unsupported"] },
            level: { type: "number", minimum: 0, maximum: 1 },
            rms: { type: "number", minimum: 0, maximum: 1 },
            peak: { type: "number", minimum: 0, maximum: 1 },
            dbfs: { type: "number", minimum: -120, maximum: 0 },
            updatedAt: { type: "integer", minimum: 0 },
            driver: { type: "string" },
            reason: { type: "string" }
          }
        },
        i2cScan: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["stage", "uptimeMs", "addresses"],
            properties: {
              stage: { type: "string", minLength: 1, maxLength: 48 },
              uptimeMs: { type: "integer", minimum: 0 },
              addresses: {
                type: "array",
                maxItems: 117,
                items: { type: "integer", minimum: 0, maximum: 127 }
              },
              targets: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ltr553: { type: "boolean" },
                  ina226: { type: "boolean" },
                  nfc: { type: "boolean" }
                }
              },
              reason: { type: "string" }
            }
          }
        }
      }
    }
  }
} as const;

export const robotEventSchema = {
  $id: "https://stackchan.local/schemas/robot-event.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "eventId", "deviceId", "timestamp", "event"],
  properties: {
    type: { const: "robot.event" },
    seq: { type: "integer", minimum: 0 },
    eventId: { type: "string", minLength: 1 },
    deviceId: { type: "string", minLength: 1 },
    timestamp: { type: "string", format: "date-time" },
    event: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "gesture"],
          properties: {
            kind: { const: "touch" },
            gesture: { enum: ["tap", "doubleTap", "longPress", "pet", "press", "release", "swipeForward", "swipeBackward"] },
            surface: { enum: ["head", "screen"] },
            pressed: { type: "boolean" },
            x: { type: "number", minimum: 0, maximum: 320 },
            y: { type: "number", minimum: 0, maximum: 240 },
            points: { type: "integer", minimum: 0, maximum: 5 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "motion"],
          properties: {
            kind: { const: "imu" },
            motion: { enum: ["shake", "tilt", "none"] },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            gyroX: { type: "number" },
            gyroY: { type: "number" },
            gyroZ: { type: "number" },
            uptimeMs: { type: "integer", minimum: 0 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "level", "charging"],
          properties: {
            kind: { const: "battery" },
            level: { type: "number", minimum: 0, maximum: 100 },
            charging: { type: "boolean" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "status"],
          properties: {
            kind: { const: "wifi" },
            status: { enum: ["disconnected", "connecting", "connected"] },
            rssi: { type: "number" },
            ssid: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "text"],
          properties: {
            kind: { const: "wakeWord" },
            text: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "mode"],
          properties: {
            kind: { const: "state" },
            mode: { enum: ["idle", "connecting", "listening", "thinking", "speaking", "pairing", "sleeping", "error"] },
            detail: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId", "mimeType", "dataBase64"],
          properties: {
            kind: { const: "image" },
            requestId: { type: "string", minLength: 1 },
            mimeType: { const: "image/jpeg" },
            dataBase64: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "commandId", "commandKind", "status"],
          properties: {
            kind: { const: "commandAck" },
            commandId: { type: "string", minLength: 1 },
            commandKind: {
              enum: [
                "say",
                "react",
                "moveHead",
                "cameraStream",
                "trackFace",
                "playAnimation",
                "playAudioStart",
                "playAudioChunk",
                "playAudioEnd",
                "captureImage",
                "setMode",
                "setRgb",
                "telemetryConfig",
                "mediaFlowControl",
                "unknown"
              ]
            },
            requestId: { type: "string", minLength: 1 },
            status: { enum: ["accepted", "rejected"] },
            message: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "commandId", "commandKind", "status"],
          properties: {
            kind: { const: "commandStatus" },
            commandId: { type: "string", minLength: 1 },
            commandKind: {
              enum: [
                "say",
                "react",
                "moveHead",
                "cameraStream",
                "trackFace",
                "playAnimation",
                "playAudioStart",
                "playAudioChunk",
                "playAudioEnd",
                "captureImage",
                "setMode",
                "setRgb",
                "telemetryConfig",
                "mediaFlowControl",
                "unknown"
              ]
            },
            requestId: { type: "string", minLength: 1 },
            status: { enum: ["started", "completed", "failed", "cancelled"] },
            message: { type: "string" },
            progress: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "requestId", "state"],
          properties: {
            kind: { const: "playback" },
            requestId: { type: "string", minLength: 1 },
            state: { enum: ["started", "finished", "failed"] },
            message: { type: "string" }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "frameId", "mimeType", "width", "height", "dataBase64"],
          properties: {
            kind: { const: "cameraFrame" },
            frameId: { type: "string", minLength: 1 },
            mimeType: { const: "image/jpeg" },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
            dataBase64: { type: "string", minLength: 1 },
            seq: { type: "integer", minimum: 0 },
            captureTimestamp: { type: "string", format: "date-time" },
            sentAt: { type: "string", format: "date-time" },
            trace: protocolTraceSchema
          }
        },
        sensorSnapshotSchema
      ]
    }
  }
} as const;

export const heartbeatSchema = {
  $id: "https://stackchan.local/schemas/heartbeat.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "deviceId", "timestamp"],
  properties: {
    type: { const: "heartbeat" },
    seq: { type: "integer", minimum: 0 },
    deviceId: { type: "string", minLength: 1 },
    timestamp: { type: "string", format: "date-time" }
  }
} as const;

export const errorSchema = {
  $id: "https://stackchan.local/schemas/error.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "code", "message", "recoverable"],
  properties: {
    type: { const: "error" },
    seq: { type: "integer", minimum: 0 },
    code: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    recoverable: { type: "boolean" },
    commandId: { type: "string" }
  }
} as const;

export const envelopeSchema = {
  $id: "https://stackchan.local/schemas/envelope.schema.json",
  oneOf: [handshakeSchema, daemonHelloSchema, robotCommandSchema, robotEventSchema, heartbeatSchema, errorSchema]
} as const;

export const protocolSchemas = {
  audioParamsSchema,
  faceTrackingPidAxisSchema,
  normalizedFacePointSchema,
  faceLandmarksSchema,
  facePoseSchema,
  faceExpressionSchema,
  normalizedFaceBoxSchema,
  faceServoRangeSchema,
  faceTrackingControlSchema,
  handshakeSchema,
  daemonHelloSchema,
  robotCommandSchema,
  sensorSnapshotSchema,
  robotEventSchema,
  heartbeatSchema,
  errorSchema,
  envelopeSchema
} as const;
