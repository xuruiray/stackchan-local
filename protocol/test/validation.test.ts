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

  it("accepts camera stream and face tracking commands", () => {
    expect(
      validator.parseMessage({
        type: "robot.command",
        commandId: "cmd-camera",
        command: {
          kind: "cameraStream",
          enabled: true,
          fps: 4,
          format: "jpeg"
        }
      }).type
    ).toBe("robot.command");

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
            confidence: 0.8
          },
          confidence: 0.8,
          speed: 420,
          control: {
            mode: "pid",
            deadband: 0.045,
            yaw: { kp: 42, ki: 0, kd: 8 },
            pitch: { kp: 30, ki: 0, kd: 6 },
            integralLimit: 0.35,
            outputLimitDeg: 20
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
    const message = validator.parseMessage({
      type: "robot.event",
      eventId: "evt-frame",
      deviceId: "stackchan-001",
      timestamp: new Date().toISOString(),
      event: {
        kind: "cameraFrame",
        frameId: "frame-1",
        mimeType: "image/jpeg",
        width: 320,
        height: 240,
        dataBase64: "abcd"
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
            fps: 4
          },
          rgb: {
            available: true,
            count: 12
          },
          rtc: {
            available: true,
            timestamp: new Date().toISOString(),
            timezone: "GMT0"
          },
          nfc: {
            available: false,
            reason: "driver_not_wired"
          },
          ir: {
            available: false,
            reason: "driver_not_wired"
          },
          proximity: {
            available: false,
            reason: "driver_not_wired"
          },
          ambientLight: {
            available: false,
            reason: "driver_not_wired"
          },
          magnetometer: {
            available: false,
            reason: "driver_not_wired"
          },
          mic: {
            available: true,
            channels: 1,
            mode: "mono_opus",
            localization: "abandoned"
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
