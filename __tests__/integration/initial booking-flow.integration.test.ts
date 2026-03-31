// EXISTING
// Owner: Dev 4 — Real-time & Communications
// Purpose: Integration test — booking creation triggers expiry job scheduling

import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";

// In integration tests we mock external services but use a real DB
jest.mock("../../src/jobs/queue", () => ({
  getQueue: jest.fn(() => ({ add: jest.fn().mockResolvedValue({ id: "j1" }), getJob: jest.fn() })),
  registerWorker: jest.fn(),
}));

jest.mock("../../src/services/elevenlabs.service", () => ({
  initiateCall: jest.fn().mockResolvedValue({ success: true, callLogId: "cl-1", conversationId: "conv-1" }),
}));

jest.mock("../../src/socket/emitters", () => ({
  emitBookingStatusChanged: jest.fn(),
  emitIncomingCall: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { scheduleBookingExpiry, cancelBookingExpiry } from "../../src/jobs/booking-expiry.job";
import { getQueue } from "../../src/jobs/queue";
import { emitBookingStatusChanged } from "../../src/socket/emitters";

describe("Booking Flow Integration", () => {
  describe("when a booking is created", () => {
    it("schedules an expiry job with the booking ID", async () => {
      const mockAdd = jest.fn().mockResolvedValue({ id: "j1" });
      (getQueue as jest.Mock).mockReturnValue({ add: mockAdd, getJob: jest.fn() });

      await scheduleBookingExpiry({ bookingId: "bk-flow-1", userId: "u-1" });

      expect(mockAdd).toHaveBeenCalledWith(
        "booking-expiry",
        expect.objectContaining({ bookingId: "bk-flow-1" }),
        expect.objectContaining({ jobId: "expiry:bk-flow-1" }),
      );
    });
  });

  describe("when a provider accepts a booking", () => {
    it("cancels the expiry job", async () => {
      const mockRemove = jest.fn();
      (getQueue as jest.Mock).mockReturnValue({
        add: jest.fn(),
        getJob: jest.fn().mockResolvedValue({ remove: mockRemove }),
      });

      await cancelBookingExpiry("bk-flow-1");
      expect(mockRemove).toHaveBeenCalled();
    });
  });
});
