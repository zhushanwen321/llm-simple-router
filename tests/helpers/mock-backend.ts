import http from "http";

export const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export interface MockBackend {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export function createMockBackend(
  handler: http.RequestListener
): Promise<MockBackend> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        close: () =>
          new Promise((res) => server.close(() => res())),
      });
    });
  });
}
