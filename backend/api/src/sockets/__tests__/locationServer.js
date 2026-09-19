import { createServer } from "http";
import { io as Client } from "socket.io-client";
import { initLocationServer } from "../locationServer.js";
import express from "express";
import { vi } from "vitest";

// Mock auth middleware and supabase
vi.mock("../../middleware/auth.js", () => ({
  verifyAuthToken: vi.fn(async (token) => {
    if (token === "valid-driver-token") {
      return { id: "driver-1", role: "driver" };
    }
    if (token === "valid-customer-token") {
      return { id: "customer-1", role: "customer" };
    }
    throw new Error("Invalid token");
  }),
}));

vi.mock("../../config/db.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "order-uuid-123" }, error: null }),
          }),
        }),
      }),
    }),
  },
}));

process.env.NODE_ENV = "test";
// Explicitly set BYPASS_AUTH to test that it is IGNORED by locationServer
process.env.BYPASS_AUTH = "true";

describe("WebSocket Location Server", () => {
  let httpServer, serverAddress;
  let driverSocket, customerSocket;

  beforeAll((done) => {
    const app = express();
    httpServer = createServer(app);
    initLocationServer(httpServer);
    httpServer.listen(0, () => {
      serverAddress = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll(() => {
    httpServer.close();
  });

  afterEach(() => {
    driverSocket?.disconnect();
    customerSocket?.disconnect();
  });

  test("driver can connect to /driver namespace with valid token", (done) => {
    driverSocket = Client(`${serverAddress}/driver`, {
      auth: { token: "valid-driver-token", bookingId: "booking-1" },
    });
    driverSocket.on("connect", () => {
      expect(driverSocket.connected).toBe(true);
      done();
    });
  });

  test("driver connection is rejected without valid token despite BYPASS_AUTH=true", (done) => {
    const unauthSocket = Client(`${serverAddress}/driver`, {
      auth: { token: "invalid-token", bookingId: "booking-1" },
    });
    unauthSocket.on("connect_error", (err) => {
      expect(err.message).toContain("Authentication failed");
      unauthSocket.disconnect();
      done();
    });
  });

  test("customer receives location_update after driver emits", (done) => {
    const bookingId = "booking-test-123";

    // Connect customer first
    customerSocket = Client(`${serverAddress}/customer`, {
      auth: { token: "valid-customer-token", customerId: "customer-1" },
    });

    customerSocket.on("connect", () => {
      customerSocket.emit("subscribe_booking", { bookingId });

      customerSocket.on("subscribed", () => {
        // Now connect driver and emit location
        driverSocket = Client(`${serverAddress}/driver`, {
          auth: { token: "valid-driver-token", bookingId },
        });

        driverSocket.on("connect", () => {
          driverSocket.emit("location_update", {
            bookingId,
            lat: 28.6139,
            lng: 77.2090,
            speed: 65,
            heading: 180,
            timestamp: new Date().toISOString(),
          });
        });
      });

      customerSocket.on("driver_location", (data) => {
        expect(data.lat).toBe(28.6139);
        expect(data.lng).toBe(77.2090);
        expect(data.speed).toBe(65);
        expect(data.bookingId).toBe(bookingId);
        done();
      });
    });
  });

  test("invalid GPS coordinates are rejected", (done) => {
    driverSocket = Client(`${serverAddress}/driver`, {
      auth: { token: "valid-driver-token", bookingId: "booking-x" },
    });

    driverSocket.on("connect", () => {
      driverSocket.emit("location_update", {
        bookingId: "booking-x",
        lat: 999,   // Invalid
        lng: 77.2090,
        timestamp: new Date().toISOString(),
      });
    });

    driverSocket.on("error", (err) => {
      expect(err.message).toContain("Invalid GPS coordinates");
      done();
    });
  });
});