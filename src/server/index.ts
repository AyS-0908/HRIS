// Entry point. Boots the app and serves the MCP endpoint over streamable HTTP.
import { buildApp, loadAppConfigFromEnv } from "../app.js";
import { createHttpApp } from "./transport.js";

const app = buildApp(loadAppConfigFromEnv());
const httpApp = createHttpApp(app);
const port = Number(process.env.PORT ?? 3000);

httpApp.listen(port, () => {
  app.logger.info("mcp-custom-standard listening", {
    port,
    publicUrl: process.env.MCP_SERVER_PUBLIC_URL ?? `http://localhost:${port}`,
    companies: app.companies.list().map((c) => c.company.id),
  });
});
