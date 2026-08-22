import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://www.activityschema.com",
  output: "static",
  build: {
    format: "directory",
  },
});
