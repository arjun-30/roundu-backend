// EXISTING
// Owner: Dev 4 — Real-time & Communications
// Purpose: Socket tests — provider location updates broadcast to booking room

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock io
const mockRoomEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockRoomEmit }));
const mockIo = { to: mockTo };

jest.mock("../../src/socket/index", () => ({
  io: mockIo,
}));

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { emitProviderLocationUpdated, emitGpsAlert } from "../../src/socket/emitters";

describe("Socket Emitters — Location Tracking", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("emitProviderLocationUpdated()", () => {
    it("emits to the correct booking room with lat/lng payload", () => {
      emitProviderLocationUpdated("bk-1", 13.0827, 80.2707);

      expect(mockTo).toHaveBeenCalledWith("booking:bk-1");
      expect(mockRoomEmit).toHaveBeenCalledWith(
        "provider:location_updated",
        expect.objectContaining({
          bookingId: "bk-1",
          lat: 13.0827,
          lng: 80.2707,
        }),
      );
    });

    it("includes a timestamp in the payload", () => {
      emitProviderLocationUpdated("bk-2", 0, 0);

      const payload = mockRoomEmit.mock.calls[0][1] as any;
      expect(typeof payload.timestamp).toBe("string");
    });
  });

  describe("emitGpsAlert()", () => {
    it("emits alert to the provider user room", () => {
      emitGpsAlert("provider-uuid", "alert-1", "geofence_exit", "bk-1");

      expect(mockTo).toHaveBeenCalledWith("user:provider-uuid");
      expect(mockRoomEmit).toHaveBeenCalledWith(
        "gps:alert",
        expect.objectContaining({ alertId: "alert-1", type: "geofence_exit", bookingId: "bk-1" }),
      );
    });
  });
});
