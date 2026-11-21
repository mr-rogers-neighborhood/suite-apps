#!/usr/bin/env node
/** Report whether the docs reader is listening, without triggering a page compile. */
import net from "node:net";

const port = Number(process.env.DOCS_PORT ?? 3001);
const socket = net.createConnection({ host: "127.0.0.1", port });

socket.once("connect", () => {
  socket.destroy();
  process.stdout.write(`docs listening on http://localhost:${port}\n`);
  process.exit(0);
});

socket.once("error", () => {
  process.stdout.write(`docs not listening on :${port}\n`);
  process.exit(0);
});

socket.setTimeout(1500, () => {
  socket.destroy();
  process.stdout.write(`docs not listening on :${port}\n`);
  process.exit(0);
});
