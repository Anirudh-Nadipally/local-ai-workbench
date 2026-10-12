import net from "node:net";
const port = Number(process.env.PORT || 3025);
const server = net.createServer();
server.on("error", () => {
  console.error(
    `Port ${port} is already in use. If Workbench is running, open http://127.0.0.1:${port}. Otherwise start with a different PORT.`,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => server.close());
