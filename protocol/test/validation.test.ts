import { describe, expect, it } from "vitest";

import { createProtocolValidator } from "../src/index.js";

describe("protocol validation", () => {
  const validator = createProtocolValidator();

  it("accepts a valid device handshake", () => {
    const message = validator.parseMessage({
      type: "handshake",
      deviceId: "stackchan-001",
      firmwareVersion: "local-0.1.0",
      pairingToken: "test-token",
      capabilities: ["audio", "face", "motion", "camera", "wifi", "servos", "rtc", "mic"],
      audioParams: {
        format: "opus",
        sampleRate: 16000,
        channels: 1,
        frameDurationMs: 30
      }
    });

    expect(message.type).toBe("handshake");
  });

  it("accepts protocol v1.2 hello negotiation metadata", () => {
    expect(
      validator.parseMessage({
        type: "daemon.hello",
        protocolVersion: "1.2",
        sessionId: "session-1",
        heartbeatIntervalMs: 15000,
        featureFlags: ["binaryCameraFrame", "mediaCredit", "commandStatus", "qosProfiles"],
        featureParams: {
          binaryCameraFrame: {
            envelope: "SCL1",
            cameraKind: 1
          },
          mediaCredit: {
            defaultCreditFrames: 2,
            maxCreditFrames: 12
          }
        },
        qosProfiles: {
          robotCommand: "reliable",
          cameraFrame: "latestOnly",
          telemetry: "bestEffort",
          audio: "reliableChunked"
        },
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      }).type
    ).toBe("daemon.hello");
  });

  it("rejects an invalid command kind", () => {
    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-1",
        command: {
          kind: "fly"
        }
      })
    ).toThrow("Invalid local protocol message");
  });

  it("accepts camera stream and face tracking commands with landmarks, pose, and official servo range", () => {
    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-camera",
        command: {
          kind: "cameraStream",
          enabled: true,
          fps: 4,
          width: 320,
          height: 240,
          quality: 20,
          format: "jpeg"
        }
      }).type
    ).toBe("robot.command");

    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-rgb",
        command: {
          kind: "setRgb",
          enabled: true,
          color: "#43D5B0",
          brightness: 0.8
        }
      }).type
    ).toBe("robot.command");

    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-telemetry",
        command: {
          kind: "telemetryConfig",
          sensorSnapshotHz: 0.5,
          imuHz: 2,
          includeI2cScan: false,
          reason: "adaptive backpressure"
        }
      }).type
    ).toBe("robot.command");

    expect(
      validator.parseMessage({
        type: "robot.command",
        seq: 7,
        commandId: "cmd-media-credit",
        command: {
          kind: "mediaFlowControl",
          stream: "camera",
          creditFrames: 2,
          maxInFlight: 2,
          reason: "detector ready"
        }
      }).type
    ).toBe("robot.command");

    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-react",
        command: {
          kind: "react",
          emotion: "doubtful",
          durationMs: 1200,
          avatarJson: {
            type: "bleAvatar",
            leftEye: { x: 0, y: 0, rotation: 0, weight: 100, size: 0 },
            rightEye: { x: 0, y: 0, rotation: 0, weight: 100, size: 0 },
            mouth: { x: 0, y: 0, rotation: 0, weight: 0, size: 0 }
          }
        }
      }).type
    ).toBe("robot.command");

    for (const emotion of ["love", "thinking", "surprised"] as const) {
      expect(
        validator.parseMessage({
          type: "robot.command",
          commandId: `cmd-react-${emotion}`,
          command: {
            kind: "react",
            emotion
          }
        }).type
      ).toBe("robot.command");
    }

    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-face",
        command: {
          kind: "trackFace",
          detected: true,
          centerX: 0.25,
          centerY: 0.6,
          bbox: {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
            confidence: 0.8,
            trackingId: "face-1",
            landmarks: {
              all: [
                { x: 0.25, y: 0.39, z: -0.02 },
                { x: 0.18, y: 0.31, z: 0.01 }
              ],
              nose: { x: 0.25, y: 0.39, z: -0.02 },
              leftEye: { x: 0.18, y: 0.31 },
              rightEye: { x: 0.32, y: 0.31 },
              mouthCenter: { x: 0.25, y: 0.52 }
            },
            pose: {
              yawDeg: -12.4,
              pitchDeg: 4.2,
              rollDeg: 1.1
            },
            transformMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 4, -30, 1],
            expression: {
              smile: 0.2,
              leftEyeOpen: 0.93,
              rightEyeOpen: 0.88,
              blendshapes: {
                mouthSmileLeft: 0.21,
                mouthSmileRight: 0.18,
                eyeBlinkLeft: 0.07,
                eyeBlinkRight: 0.12
              }
            },
            detector: "mediapipe_tasks_face_landmarker"
          },
          confidence: 0.8,
          speed: 420,
          control: {
            mode: "pid",
            deadband: 0.045,
            yaw: { kp: 42, ki: 0, kd: 8 },
            pitch: { kp: 30, ki: 0, kd: 6 },
            integralLimit: 0.35,
            outputLimitDeg: 20,
            servoRange: {
              yawMin: -1280,
              yawMax: 1280,
              pitchMin: 0,
              pitchMax: 900
            }
          }
        }
      }).type
    ).toBe("robot.command");
  });

  it("accepts chunked local ogg opus audio playback commands and playback events", () => {
    expect(validator.parseMessage({
      type: "robot.command",
      commandId: "cmd-audio-start",
      command: {
        kind: "playAudioStart",
        requestId: "audio-1",
        format: "ogg_opus",
        mimeType: "audio/ogg",
        sampleRate: 16000,
        totalBytes: 4,
        totalChunks: 1,
        text: "Codex 任务执行完毕。",
        interrupt: true,
        volume: 90
      }
    }).type).toBe("robot.command");

    expect(validator.parseMessage({
      type: "robot.command",
      commandId: "cmd-audio-chunk",
      command: {
        kind: "playAudioChunk",
        requestId: "audio-1",
        chunkIndex: 0,
        dataBase64: "T2dnUw=="
      }
    }).type).toBe("robot.command");

    expect(validator.parseMessage({
      type: "robot.command",
      commandId: "cmd-audio-end",
      command: {
        kind: "playAudioEnd",
        requestId: "audio-1"
      }
    }).type).toBe("robot.command");

    expect(validator.parseMessage({
      type: "robot.event",
      eventId: "evt-command-ack",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "commandAck",
        commandId: "cmd-audio-end",
        commandKind: "playAudioEnd",
        requestId: "audio-1",
        status: "accepted"
      }
    }).type).toBe("robot.event");

    expect(validator.parseMessage({
      type: "robot.event",
      eventId: "evt-rgb-command-ack",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "commandAck",
        commandId: "cmd-rgb",
        commandKind: "setRgb",
        status: "accepted"
      }
    }).type).toBe("robot.event");

    expect(validator.parseMessage({
      type: "robot.event",
      seq: 8,
      eventId: "evt-command-status",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "commandStatus",
        commandId: "cmd-rgb",
        commandKind: "setRgb",
        status: "completed",
        progress: 1
      }
    }).type).toBe("robot.event");

    expect(validator.parseMessage({
      type: "robot.event",
      eventId: "evt-playback",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "playback",
        requestId: "audio-1",
        state: "finished"
      }
    }).type).toBe("robot.event");
  });

  it("rejects oversized audio chunks", () => {
    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-audio-chunk",
        command: {
          kind: "playAudioChunk",
          requestId: "audio-1",
          chunkIndex: 0,
          dataBase64: "a".repeat(8193)
        }
      })
    ).toThrow("Invalid local protocol message");
  });

  it("rejects invalid audio playback volume", () => {
    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-audio-start",
        command: {
          kind: "playAudioStart",
          requestId: "audio-1",
          format: "ogg_opus",
          mimeType: "audio/ogg",
          sampleRate: 16000,
          totalBytes: 4,
          totalChunks: 1,
          volume: 120
        }
      })
    ).toThrow("Invalid local protocol message");
  });

  it("rejects abandoned microphone localization protocol messages", () => {
    expect(() =>
      validator.parseMessage({
        type: "handshake",
        deviceId: "stackchan-001",
        firmwareVersion: "local-0.1.0",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion", "camera", "micArray"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-sound-localization",
        command: {
          kind: "soundLocalization",
          enabled: true,
          rateHz: 8,
          windowMs: 40
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-track-sound",
        command: {
          kind: "trackSound",
          direction: "left",
          confidence: 0.72,
          stepDeg: 10,
          speed: 600,
          holdMs: 1200,
          reason: "face_lost_sound_detected"
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-sound-debug",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "soundDirection",
          direction: "left",
          azimuthDeg: -24,
          confidence: 0.65,
          energyDb: -31.2,
          vad: true,
          windowMs: 40,
          inputChannels: 2,
          leftRms: 902,
          rightRms: 418,
          channelBalance: -0.37
        }
      })
    ).toThrow("Invalid local protocol message");
  });

  it("accepts a camera frame event", () => {
    const timestamp = new Date().toISOString();
    const message = validator.parseMessage({
      type: "robot.event",
      seq: 42,
      eventId: "evt-frame",
      deviceId: "stackchan-001",
      timestamp,
      event: {
        kind: "cameraFrame",
        frameId: "frame-1",
        mimeType: "image/jpeg",
        width: 320,
        height: 240,
        dataBase64: "abcd",
        seq: 42,
        captureTimestamp: timestamp,
        sentAt: timestamp,
        trace: {
          deviceCapturedAt: timestamp,
          deviceEncodedAt: timestamp,
          deviceQueuedAt: timestamp,
          deviceSentAt: timestamp,
          deviceTxStartAt: timestamp,
          daemonReceivedAt: timestamp,
          detectorStartedAt: timestamp,
          detectorFinishedAt: timestamp
        }
      }
    });

    expect(message.type).toBe("robot.event");
  });

  it("accepts realtime sensor events", () => {
    const timestamp = new Date().toISOString();

    for (const event of [
      {
        kind: "touch",
        gesture: "press",
        surface: "screen",
        pressed: true,
        x: 128,
        y: 64,
        points: 1
      },
      {
        kind: "touch",
        gesture: "swipeForward",
        surface: "head",
        pressed: true
      },
      {
        kind: "imu",
        motion: "none",
        x: -0.12,
        y: 0.05,
        z: 9.81,
        gyroX: 0.4,
        gyroY: -1.1,
        gyroZ: 2.6,
        uptimeMs: 123456
      },
      {
        kind: "battery",
        level: 82,
        charging: true
      },
      {
        kind: "wifi",
        status: "connected",
        rssi: -54,
        ssid: "local-lab"
      }
    ]) {
      expect(
        validator.parseMessage({
          type: "robot.event",
          eventId: `evt-${event.kind}`,
          deviceId: "stackchan-001",
          timestamp,
          event
        }).type
      ).toBe("robot.event");
    }
  });

  it("accepts a low-frequency hardware sensor snapshot event", () => {
    const message = validator.parseMessage({
      type: "robot.event",
      eventId: "evt-sensor-snapshot",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "sensorSnapshot",
        uptimeMs: 123456,
        power: {
          batteryLevel: 82,
          charging: true,
          backlight: 75,
          speakerVolume: 80,
          servoPower: true
        },
        network: {
          wifi: {
            status: "connected",
            rssi: -54,
            ssid: "local-lab"
          },
          ble: {
            available: true,
            connected: false,
            provisioning: true
          }
        },
        motion: {
          imu: {
            available: true,
            motion: "none",
            x: -0.12,
            y: 0.05,
            z: 9.81,
            gyroX: 0.4,
            gyroY: -1.1,
            gyroZ: 2.6,
            uptimeMs: 123450
          },
          servos: {
            available: true,
            yaw: {
              angle: 4.5,
              moving: false,
              torque: true
            },
            pitch: {
              angle: 31.2,
              moving: true,
              torque: true
            },
            power: true
          }
        },
        interaction: {
          screenTouch: {
            available: true,
            pressed: true,
            x: 128,
            y: 64,
            points: 1
          },
          headTouch: {
            available: true,
            gesture: "press",
            pressed: true,
            zones: [0, 2]
          },
          wakeWord: {
            available: true,
            text: "Hi, Stack Chan"
          }
        },
        peripherals: {
          ioExpander: {
            available: true
          },
          camera: {
            available: true,
            streaming: true,
            width: 320,
            height: 240,
            fps: 4,
            requestedWidth: 640,
            requestedHeight: 480,
            actualWidth: 320,
            actualHeight: 240,
            quality: 30,
            transport: "binary",
            adaptiveLevel: 1,
            lastCaptureMs: 91,
            lastEncodeMs: 11,
            lastSendMs: 3,
            lastTotalMs: 106,
            lastFrameIntervalMs: 112,
            lastJpegBytes: 3142,
            fallbackReason: "runtime_resolution_change_not_supported"
          },
          rgb: {
            available: true,
            count: 12,
            enabled: true,
            color: "#43D5B0",
            brightness: 0.8,
            driver: "neon-light"
          },
          rtc: {
            available: true,
            timestamp: new Date().toISOString(),
            timezone: "GMT0"
          },
          nfc: {
            available: true,
            driver: "st25r3916-probe",
            address: 0x50,
            status: "chip_detected"
          },
          powerMonitor: {
            available: true,
            driver: "ina226",
            address: 0x41,
            busVoltage: 3.98,
            shuntVoltage: 0.0012,
            current: 0.12,
            power: 0.48
          },
          i2cScan: [
            {
              stage: "after_board_init_axp2101",
              uptimeMs: 1200,
              addresses: [0x21, 0x23, 0x34, 0x38, 0x40, 0x41, 0x50, 0x51, 0x58, 0x68, 0x69, 0x6f],
              targets: {
                ltr553: true,
                ina226: true,
                nfc: true
              }
            }
          ],
          ir: {
            available: true,
            driver: "gpio-ir-basic",
            txPin: 5,
            rxPin: 10
          },
          proximity: {
            available: true,
            value: 42,
            raw: 42,
            driver: "ltr553"
          },
          ambientLight: {
            available: true,
            lux: 18.5,
            raw: 320,
            driver: "ltr553"
          },
          magnetometer: {
            available: true,
            x: 0.1,
            y: -0.2,
            z: 0.3,
            rawX: 12,
            rawY: -24,
            rawZ: 36,
            headingDeg: 296.6,
            driver: "bmi270-aux-bmm150"
          },
          mic: {
            available: true,
            channels: 2,
            mode: "mono_opus",
            localization: "abandoned",
            level: 0.42,
            rms: 0.08,
            peak: 0.31,
            dbfs: -21.4,
            updatedAt: 123455,
            driver: "es7210-level-meter"
          }
        }
      }
    });

    expect(message.type).toBe("robot.event");
  });

  it("rejects invalid hardware sensor snapshots", () => {
    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-bad-sensor-snapshot",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "sensorSnapshot",
          uptimeMs: 123456,
          power: {
            batteryLevel: 180
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-bad-sensor-peripheral",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "sensorSnapshot",
          uptimeMs: 123456,
          peripherals: {
            mic: {
              available: true,
              channels: 4,
              mode: "mono_opus"
            }
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-bad-mic-level",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "sensorSnapshot",
          uptimeMs: 123456,
          peripherals: {
            mic: {
              available: true,
              channels: 1,
              mode: "mono_opus",
              level: 1.5
            }
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-bad-i2c-scan",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "sensorSnapshot",
          uptimeMs: 123456,
          peripherals: {
            i2cScan: [
              {
                stage: "after_py32_vm_en",
                uptimeMs: 1000,
                addresses: [0x21, 0x80]
              }
            ]
          }
        }
      })
    ).toThrow("Invalid local protocol message");
  });

  it("rejects invalid tracking bounds and stream fps", () => {
    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-fps",
        command: {
          kind: "cameraStream",
          enabled: true,
          fps: 0
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-camera-quality",
        command: {
          kind: "cameraStream",
          enabled: true,
          fps: 4,
          width: 640,
          height: 480,
          quality: 101
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-camera-size",
        command: {
          kind: "cameraStream",
          enabled: true,
          fps: 4,
          width: 123,
          height: 480,
          quality: 30
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-rgb-color",
        command: {
          kind: "setRgb",
          enabled: true,
          color: "green"
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-telemetry-rate",
        command: {
          kind: "telemetryConfig",
          sensorSnapshotHz: 3,
          imuHz: 2
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-face",
        command: {
          kind: "trackFace",
          detected: true,
          centerX: 1.2,
          centerY: 0.5,
          bbox: {
            x: 0.1,
            y: 0.1,
            width: 0,
            height: 0.4
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-face-matrix",
        command: {
          kind: "trackFace",
          detected: true,
          centerX: 0.5,
          centerY: 0.5,
          bbox: {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.4,
            transformMatrix: [1, 0, 0]
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-blendshape",
        command: {
          kind: "trackFace",
          detected: true,
          centerX: 0.5,
          centerY: 0.5,
          bbox: {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.4,
            expression: {
              blendshapes: {
                mouthSmileLeft: -0.1
              }
            }
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-bad-pid",
        command: {
          kind: "trackFace",
          detected: true,
          centerX: 0.5,
          centerY: 0.5,
          speed: 420,
          control: {
            mode: "pid",
            deadband: 0.5,
            yaw: { kp: 42, ki: 0, kd: 8 },
            pitch: { kp: 30, ki: 0, kd: 6 },
            integralLimit: 0.35,
            outputLimitDeg: 20
          }
        }
      })
    ).toThrow("Invalid local protocol message");

    expect(() =>
      validator.parseMessage({
        type: "robot.event",
        eventId: "evt-bad-touch",
        deviceId: "stackchan-001",
        timestamp: new Date().toISOString(),
        event: {
          kind: "touch",
          gesture: "press",
          surface: "screen",
          x: 999,
          y: 40,
          points: 1
        }
      })
    ).toThrow("Invalid local protocol message");

  });
});
