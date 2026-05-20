import { createRequire } from "node:module";
import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";

import {
  daemonHelloSchema,
  envelopeSchema,
  errorSchema,
  handshakeSchema,
  heartbeatSchema,
  robotCommandSchema,
  robotEventSchema
} from "./schemas.js";
import type {
  DaemonHelloMessage,
  ErrorMessage,
  HandshakeMessage,
  HeartbeatMessage,
  LocalProtocolMessage,
  RobotCommandMessage,
  RobotEventMessage
} from "./types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv) => void;

export class ProtocolValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ErrorObject[] | null | undefined
  ) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

export interface ProtocolValidator {
  parseMessage(value: unknown): LocalProtocolMessage;
  assertOutgoing(value: unknown): asserts value is LocalProtocolMessage;
  isHandshake(value: unknown): value is HandshakeMessage;
  isDaemonHello(value: unknown): value is DaemonHelloMessage;
  isRobotCommand(value: unknown): value is RobotCommandMessage;
  isRobotEvent(value: unknown): value is RobotEventMessage;
  isHeartbeat(value: unknown): value is HeartbeatMessage;
  isError(value: unknown): value is ErrorMessage;
}

function assertWith(validate: ValidateFunction, value: unknown, label: string): void {
  if (!validate(value)) {
    throw new ProtocolValidationError(`Invalid ${label}`, validate.errors);
  }
}

export function createProtocolValidator(): ProtocolValidator {
  const ajv = new Ajv({ allErrors: true, strict: false, addUsedSchema: false });
  addFormats(ajv);

  const validateEnvelope = ajv.compile(envelopeSchema);
  const validateHandshake = ajv.compile(handshakeSchema);
  const validateDaemonHello = ajv.compile(daemonHelloSchema);
  const validateRobotCommand = ajv.compile(robotCommandSchema);
  const validateRobotEvent = ajv.compile(robotEventSchema);
  const validateHeartbeat = ajv.compile(heartbeatSchema);
  const validateError = ajv.compile(errorSchema);

  return {
    parseMessage(value: unknown): LocalProtocolMessage {
      assertWith(validateEnvelope, value, "local protocol message");
      return value as LocalProtocolMessage;
    },
    assertOutgoing(value: unknown): asserts value is LocalProtocolMessage {
      assertWith(validateEnvelope, value, "outgoing local protocol message");
    },
    isHandshake(value: unknown): value is HandshakeMessage {
      return validateHandshake(value) as boolean;
    },
    isDaemonHello(value: unknown): value is DaemonHelloMessage {
      return validateDaemonHello(value) as boolean;
    },
    isRobotCommand(value: unknown): value is RobotCommandMessage {
      return validateRobotCommand(value) as boolean;
    },
    isRobotEvent(value: unknown): value is RobotEventMessage {
      return validateRobotEvent(value) as boolean;
    },
    isHeartbeat(value: unknown): value is HeartbeatMessage {
      return validateHeartbeat(value) as boolean;
    },
    isError(value: unknown): value is ErrorMessage {
      return validateError(value) as boolean;
    }
  };
}
