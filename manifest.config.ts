import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Auto Tab Group (BerTopic)",
  version: pkg.version,
  description: pkg.description,
  action: {
    default_popup: "src/popup/index.html",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/extract.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  permissions: [
    "tabs",
    "tabGroups",
    "storage",
    "scripting",
    "webNavigation",
    "history",
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  host_permissions: [
    "<all_urls>",
    "https://huggingface.co/*",
    "https://cdn.jsdelivr.net/*",
    "https://generativelanguage.googleapis.com/*",
  ],
  web_accessible_resources: [
    {
      resources: ["assets/*"],
      matches: ["<all_urls>"],
    },
  ],
});
