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
          "bleProvisioning"
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
    sessionId: { type: "string", minLength: 1 },
    heartbeatIntervalMs: { type: "integer", minimum: 1000 },
    featureFlags: { type: "array", items: { type: "string" } },
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

export const faceTrackingControlSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "deadband", "yaw", "pitch", "integralLimit", "outputLimitDeg"],
  properties: {
    mode: { const: "pid" },
    deadband: { type: "number", minimum: 0, maximum: 0.3 },
    yaw: faceTrackingPidAxisSchema,
    pitch: faceTrackingPidAxisSchema,
    integralLimit: { type: "number", minimum: 0, maximum: 2 },
    outputLimitDeg: { type: "number", minimum: 1, maximum: 45 }
  }
} as const;

export const robotCommandSchema = {
  $id: "https://stackchan.local/schemas/robot-command.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["type", "commandId", "command"],
  properties: {
    type: { const: "robot.command" },
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
            bbox: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y", "width", "height"],
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                confidence: { type: "number", minimum: 0, maximum: 1 }
              }
            },
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
        }
      ]
    }
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
        nfc: availabilitySchema,
        ir: availabilitySchema,
        proximity: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            value: { type: "number", minimum: 0 },
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
            headingDeg: { type: "number", minimum: 0, maximum: 360 },
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
            reason: { type: "string" }
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
            dataBase64: { type: "string", minLength: 1 }
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
