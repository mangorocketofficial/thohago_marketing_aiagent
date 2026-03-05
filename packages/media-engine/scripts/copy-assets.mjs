import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const sourcePresetsDir = path.resolve(packageRoot, "src", "templates", "presets");
const targetPresetsDir = path.resolve(packageRoot, "dist", "templates", "presets");

await fs.rm(targetPresetsDir, { recursive: true, force: true });
await fs.mkdir(targetPresetsDir, { recursive: true });
await fs.cp(sourcePresetsDir, targetPresetsDir, { recursive: true });
