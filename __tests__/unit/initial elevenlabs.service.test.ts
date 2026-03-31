// Owner: Dev 4 — Real-time & Communications
// Purpose: Unit tests for ElevenLabs service — call initiation, retry logic, finalization

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("../../src/config/elevenlabs", () => ({
  elevenLabsClient: {
    conversationalAi: { conversations: { createPhone: jest.fn() } },
  },
  elevenLabsConfig: {
    agents: {
      providerDispatch: "agent-provider-001",
      userConfirmation: "agent-user-001",
      bookingReminder: "agent-reminder-001",
    },
    retry: { maxAttempts: 3, delayMs: 100 },
  },
}));

jest.mock("../../src/models/call-log.model", () => ({
  CallLog: { create: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() },
}));

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { elevenLabsClient } from "../../src/config/elevenlabs";
import { CallLog } from "../../src/models/call-log.model";
import { initiateCall, finalizeCall, retryCall } from "../../src/services/elevenlabs.service";

const mockCallLog = {
  id: "log-uuid-1",
  bookingId: "booking-1",
  callerId: "user-1",
  agentId: "agent-provider-001",
  direction: "outbound_provider",
  phoneNumber: "+919876543210",
  status: "initiated",
  attemptNumber: 1,
  update: jest.fn().mockResolvedValue(undefined),
};

describe("ElevenLabs Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CallLog.create as jest.Mock).mockResolvedValue(mockCallLog);
  });

  describe("initiateCall()", () => {
    it("creates a CallLog and returns success when API succeeds", async () => {
      (elevenLabsClient.conversationalAi.conversations.createPhone as jest.Mock)
        .mockResolvedValue({ conversation_id: "conv-abc-123" });

      const result = await initiateCall({
        bookingId: "booking-1",
        callerId: "user-1",
        phoneNumber: "+919876543210",
        agentType: "providerDispatch",
        direction: "outbound_provider",
      });

      expect(result.success).toBe(true);
      expect(result.conversationId).toBe("conv-abc-123");
      expect(CallLog.create).toHaveBeenCalledTimes(1);
      expect(mockCallLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "answered", conversationId: "conv-abc-123" }),
      );
    });

    it("returns failure and marks log as failed when API throws", async () => {
      (elevenLabsClient.conversationalAi.conversations.createPhone as jest.Mock)
        .mockRejectedValue(new Error("API error"));

      const result = await initiateCall({
        bookingId: "booking-1",
        callerId: "user-1",
        phoneNumber: "+919876543210",
        agentType: "providerDispatch",
        direction: "outbound_provider",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("API error");
      expect(mockCallLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", outcome: "error" }),
      );
    });
  });

  describe("finalizeCall()", () => {
    it("updates call log with outcome and duration", async () => {
      (CallLog.findOne as jest.Mock).mockResolvedValue(mockCallLog);

      await finalizeCall("conv-abc-123", "accepted", 45);

      expect(mockCallLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", outcome: "accepted", durationSeconds: 45 }),
      );
    });

    it("does nothing when conversation ID not found", async () => {
      (CallLog.findOne as jest.Mock).mockResolvedValue(null);
      await expect(finalizeCall("unknown-conv", "no_response", 0)).resolves.toBeUndefined();
      expect(mockCallLog.update).not.toHaveBeenCalled();
    });
  });

  describe("retryCall()", () => {
    it("returns null when max attempts reached", async () => {
      (CallLog.findByPk as jest.Mock).mockResolvedValue({ ...mockCallLog, attemptNumber: 3 });
      const result = await retryCall("log-uuid-1");
      expect(result).toBeNull();
    });

    it("initiates a new call when under attempt limit", async () => {
      (CallLog.findByPk as jest.Mock).mockResolvedValue({ ...mockCallLog, attemptNumber: 1, agentId: "agent-provider-001" });
      (elevenLabsClient.conversationalAi.conversations.createPhone as jest.Mock)
        .mockResolvedValue({ conversation_id: "conv-retry-1" });
      const result = await retryCall("log-uuid-1");
      expect(result?.success).toBe(true);
    });
  });
});
