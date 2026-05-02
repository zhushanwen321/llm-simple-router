import { randomUUID } from "crypto";

const UUID_ID_LENGTH = 24;

export function generateMsgId(): string {
  return `msg_${randomUUID().slice(0, UUID_ID_LENGTH)}`;
}

export function generateChatcmplId(): string {
  return `chatcmpl-${randomUUID().slice(0, UUID_ID_LENGTH)}`;
}

export function generateRespId(): string {
  return `resp_${randomUUID().slice(0, UUID_ID_LENGTH)}`;
}

export const MS_PER_SECOND = 1000;
