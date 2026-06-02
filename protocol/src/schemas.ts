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
          "bmi270",
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
  required: ["kp", "ki", "kd", "direction"],
  properties: {
    kp: { type: "number", minimum: 0, maximum: 150 },
    ki: { type: "number", minimum: 0, maximum: 50 },
    kd: { type: "number", minimum: 0, maximum: 80 },
    direction: { enum: [-1, 1] }
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

export const trackFaceCommandSchema = {
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
  },
  allOf: [
    {
      if: {
        properties: { detected: { const: true } },
        required: ["detected"]
      },
      then: {
        required: ["centerX", "centerY"]
      }
    }
  ]
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
            emotion: { enum: ["neutral", "happy", "laughing", "love", "sad", "crying", "angry", "thinking", "surprised", "sleepy", "doubtful"] },
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
          ...trackFaceCommandSchema
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
    deviceCaptureDoneAt: { type: "string", format: "date-time" },
    deviceEncodeStartedAt: { type: "string", format: "date-time" },
    deviceEncodedAt: { type: "string", format: "date-time" },
    deviceQueuedAt: { type: "string", format: "date-time" },
    deviceSentAt: { type: "string", format: "date-time" },
    deviceTxStartAt: { type: "string", format: "date-time" },
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

const magnetometerTelemetrySchema = {
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
    reason: { type: "string" }
  }
} as const;

const attitudeTelemetrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["available"],
  properties: {
    available: { type: "boolean" },
    quaternion: {
      type: "object",
      additionalProperties: false,
      required: ["w", "x", "y", "z"],
      properties: {
        w: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      }
    },
    pitchDeg: { type: "number", minimum: -180, maximum: 180 },
    rollDeg: { type: "number", minimum: -180, maximum: 180 },
    yawDeg: { type: "number", minimum: 0, maximum: 360 },
    quality: { enum: ["unavailable", "gyroAccel", "gyroAccelMag", "magnetometerRejected"] },
    magnetometerUsed: { type: "boolean" },
    sampleHz: { type: "number", minimum: 0 }
  }
} as const;

const proximityTelemetrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "available"],
  properties: {
    kind: { const: "proximity" },
    available: { type: "boolean" },
    value: { type: "number", minimum: 0 },
    raw: { type: "number", minimum: 0 },
    uptimeMs: { type: "integer", minimum: 0 },
    reason: { type: "string" }
  }
} as const;

const ambientLightTelemetrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "available"],
  properties: {
    kind: { const: "ambientLight" },
    available: { type: "boolean" },
    lux: { type: "number", minimum: 0 },
    raw: { type: "number", minimum: 0 },
    uptimeMs: { type: "integer", minimum: 0 },
    reason: { type: "string" }
  }
} as const;

const nfcEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "action", "uptimeMs"],
  properties: {
    kind: { const: "nfc" },
    action: { enum: ["tagDetected", "tagChanged", "tagRemoved", "readError"] },
    uptimeMs: { type: "integer", minimum: 0 },
    uid: { type: "string", pattern: "^[0-9A-F]+$", minLength: 2, maxLength: 20 },
    tech: { enum: ["iso14443a", "iso14443b", "felica", "iso15693", "unknown"] },
    atqa: { type: "string", pattern: "^[0-9A-F]{4}$" },
    sak: { type: "integer", minimum: 0, maximum: 255 },
    reason: { type: "string" }
  }
} as const;

const irEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "action", "uptimeMs"],
  properties: {
    kind: { const: "ir" },
    action: { enum: ["received", "receiveError", "transmitStarted", "transmitCompleted", "transmitFailed"] },
    uptimeMs: { type: "integer", minimum: 0 },
    protocol: { enum: ["nec", "sony", "rc5", "rc6", "raw", "unknown"] },
    address: { type: "string", pattern: "^[0-9A-F]+$", minLength: 1, maxLength: 8 },
    command: { type: "string", pattern: "^[0-9A-F]+$", minLength: 1, maxLength: 8 },
    code: { type: "string", pattern: "^[0-9A-F]+$", minLength: 1, maxLength: 16 },
    bits: { type: "integer", minimum: 1, maximum: 128 },
    repeat: { type: "boolean" },
    requestId: { type: "string", minLength: 1 },
    carrierHz: { type: "integer", minimum: 1000, maximum: 100000 },
    reason: { type: "string" }
  }
} as const;

const faceTrackingControlEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "action", "uptimeMs"],
  properties: {
    kind: { const: "faceTrackingControl" },
    action: { enum: ["applied", "deadband", "ignored"] },
    uptimeMs: { type: "integer", minimum: 0 },
    targetAgeMs: { type: "integer", minimum: 0 },
    centerX: { type: "number", minimum: 0, maximum: 1 },
    centerY: { type: "number", minimum: 0, maximum: 1 },
    errorX: { type: "number", minimum: -1, maximum: 1 },
    errorY: { type: "number", minimum: -1, maximum: 1 },
    currentYaw: { type: "number", minimum: -1000, maximum: 1000 },
    currentPitch: { type: "number", minimum: -1000, maximum: 1000 },
    commandYaw: { type: "number", minimum: -1000, maximum: 1000 },
    commandPitch: { type: "number", minimum: -1000, maximum: 1000 },
    nextYaw: { type: "number", minimum: -1000, maximum: 1000 },
    nextPitch: { type: "number", minimum: -1000, maximum: 1000 },
    yawDelta: { type: "number", minimum: -1000, maximum: 1000 },
    pitchDelta: { type: "number", minimum: -1000, maximum: 1000 },
    requestedYawDelta: { type: "number", minimum: -1000, maximum: 1000 },
    requestedPitchDelta: { type: "number", minimum: -1000, maximum: 1000 },
    appliedYawStep: { type: "number", minimum: -1000, maximum: 1000 },
    appliedPitchStep: { type: "number", minimum: -1000, maximum: 1000 },
    maxYawStep: { type: "number", minimum: 0, maximum: 1000 },
    maxPitchStep: { type: "number", minimum: 0, maximum: 1000 },
    yawOutputDeg: { type: "number", minimum: -45, maximum: 45 },
    pitchOutputDeg: { type: "number", minimum: -45, maximum: 45 },
    yawDirection: { enum: [-1, 1] },
    pitchDirection: { enum: [-1, 1] },
    speed: { type: "number", minimum: 0, maximum: 1000 },
    ackOk: { type: "boolean" },
    ackFailCount: { type: "number", minimum: 0 },
    reason: { type: "string" }
  }
} as const;

const hardwareStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "uptimeMs"],
  properties: {
    kind: { const: "hardwareStatus" },
    uptimeMs: { type: "integer", minimum: 0 },
    power: {
      type: "object",
      additionalProperties: false,
      properties: {
        batteryLevel: { type: "number", minimum: 0, maximum: 100 },
        charging: { type: "boolean" },
        backlight: { type: "integer", minimum: 0, maximum: 100 },
        speakerVolume: { type: "integer", minimum: 0, maximum: 100 }
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
          properties: {
            connected: { type: "boolean" },
            reason: { type: "string" }
          }
        }
      }
    },
    motion: {
      type: "object",
      additionalProperties: false,
      properties: {
        servos: {
          type: "object",
          additionalProperties: false,
          properties: {
            power: { type: "boolean" },
            reason: { type: "string" }
          }
        }
      }
    },
    peripherals: {
      type: "object",
      additionalProperties: false,
      properties: {
        headTouch: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            reason: { type: "string" }
          }
        },
        screenTouch: availabilitySchema,
        ioExpander: availabilitySchema,
        camera: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            streaming: { type: "boolean" },
            reason: { type: "string" }
          }
        },
        rgb: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
            enabled: { type: "boolean" },
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
            reason: { type: "string" }
          }
        },
        powerMonitor: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
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
            reason: { type: "string" }
          }
        },
        mic: {
          type: "object",
          additionalProperties: false,
          required: ["available"],
          properties: {
            available: { type: "boolean" },
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
            kind: { const: "bmi270" },
            motion: { enum: ["shake", "tilt", "none"] },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            gyroX: { type: "number" },
            gyroY: { type: "number" },
            gyroZ: { type: "number" },
            uptimeMs: { type: "integer", minimum: 0 },
            attitude: attitudeTelemetrySchema,
            magnetometer: magnetometerTelemetrySchema
          }
        },
        proximityTelemetrySchema,
        ambientLightTelemetrySchema,
        nfcEventSchema,
        irEventSchema,
        faceTrackingControlEventSchema,
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
        hardwareStatusSchema
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
  faceTrackingControlSchema,
  trackFaceCommandSchema,
  magnetometerTelemetrySchema,
  proximityTelemetrySchema,
  ambientLightTelemetrySchema,
  nfcEventSchema,
  irEventSchema,
  faceTrackingControlEventSchema,
  handshakeSchema,
  daemonHelloSchema,
  robotCommandSchema,
  hardwareStatusSchema,
  robotEventSchema,
  heartbeatSchema,
  errorSchema,
  envelopeSchema
} as const;
