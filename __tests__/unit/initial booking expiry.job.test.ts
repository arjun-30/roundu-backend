// Owner: Dev 4 — Real-time & Communications
// Purpose: Unit tests for booking-expiry job — expiry scheduling and sweep logic

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("../../src/jobs/queue", () => ({
  getQueue: jest.fn(() => ({
    add: jest.fn().mockResolvedValue({ id: "job-1" }),
    getJob: jest.fn(),
  })),
}));

jest.mock("../../src/socket/emitters", () => ({
  emitBookingStatusChanged: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getQueue } from "../../src/jobs/queue";
import { scheduleBookingExpiry, cancelBookingExpiry } from "../../src/jobs/booking-expiry.job";

describe("Booking Expiry Job", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("scheduleBookingExpiry()", () => {
    it("adds a delayed job to the queue with the correct bookingId", async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue({ id: "job-1" }), getJob: jest.fn() };
      (getQueue as jest.Mock).mockReturnValue(mockQueue);

      await scheduleBookingExpiry({ bookingId: "bk-1", userId: "u-1", providerId: null });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "booking-expiry",
        expect.objectContaining({ bookingId: "bk-1" }),
        expect.objectContaining({ jobId: "expiry:bk-1" }),
      );
    });
  });

  describe("cancelBookingExpiry()", () => {
    it("removes the job when it exists", async () => {
      const mockRemove = jest.fn();
      const mockQueue = {
        add: jest.fn(),
        getJob: jest.fn().mockResolvedValue({ remove: mockRemove }),
      };
      (getQueue as jest.Mock).mockReturnValue(mockQueue);

      await cancelBookingExpiry("bk-1");
      expect(mockRemove).toHaveBeenCalled();
    });

    it("does nothing when job does not exist", async () => {
      const mockQueue = { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) };
      (getQueue as jest.Mock).mockReturnValue(mockQueue);

      await expect(cancelBookingExpiry("bk-nonexistent")).resolves.toBeUndefined();
    });
  });
});
