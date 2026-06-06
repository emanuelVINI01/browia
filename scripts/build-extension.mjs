import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(projectRoot, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

await run(npmCommand, ["run", "build"]);
validateExtensionBuild();

console.log("\nExtensao pronta em: dist/");
console.log("Carregue esse diretorio em chrome://extensions com 'Load unpacked'.");

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function validateExtensionBuild() {
  const requiredFiles = [
    "manifest.json",
    "index.html",
    "offscreen.html",
    "assets/background.js",
    "assets/mcpEngine.js",
    "assets/offscreen.js",
    "assets/popup.js",
    "assets/system_prompt.txt",
  ];

  for (const file of requiredFiles) {
    assertFile(resolve(distDir, file), `Arquivo obrigatorio ausente no build: ${file}`);
  }

  const manifestPath = resolve(distDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  assert(
    manifest.manifest_version === 3,
    "manifest.json gerado precisa ser Manifest V3.",
  );
  assert(
    manifest.action?.default_popup === "index.html",
    "manifest.json precisa apontar action.default_popup para index.html.",
  );
  assert(
    manifest.background?.service_worker === "assets/background.js",
    "manifest.json precisa apontar background.service_worker para assets/background.js.",
  );
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("offscreen"),
    "manifest.json precisa incluir a permissao offscreen.",
  );
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("scripting"),
    "manifest.json precisa incluir a permissao scripting.",
  );
}

function assertFile(path, message) {
  assert(existsSync(path) && statSync(path).isFile(), message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
