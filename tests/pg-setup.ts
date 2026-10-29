import { config } from "dotenv";
// Tests use isolated schemas; never inherit the application's public schema.
config({
  path: process.env.DOTENV_CONFIG_PATH ?? ".env.postgres",
  quiet: true,
});
