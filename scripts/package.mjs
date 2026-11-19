import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, execPath } from "node:process";
import { fileURLToPath } from "node:url";

const pluginDirectory = new URL("../plugin/", import.meta.url);
const compiler = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const config = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const destination = resolve(argv[2] ?? "cra-github-issues-plugin.zip");
const stagingDirectory = mkdtempSync(join(dirname(destination), ".cra-github-issues-"));
const compiledDirectory = join(stagingDirectory, "compiled");

try {
    execFileSync(execPath, [compiler, "--project", config, "--noEmit", "false", "--outDir", compiledDirectory], {
        stdio: "inherit",
    });
    for (const filename of ["manifest.json", "icon.svg"]) {
        copyFileSync(new URL(filename, pluginDirectory), join(stagingDirectory, filename));
    }

    // Cra supplies `cra` and takes the provider returned from the entry.
    const compiled = readFileSync(join(compiledDirectory, "main.js"), "utf8");
    const entry = `"use strict";
let provider;
const registerProvider = value => { provider = value; };
${compiled}
return provider;
`;
    writeFileSync(join(stagingDirectory, "main.js"), entry);
    execFileSync("zip", ["-q", "-X", "plugin.zip", "manifest.json", "main.js", "icon.svg"], {
        cwd: stagingDirectory,
    });
    renameSync(join(stagingDirectory, "plugin.zip"), destination);
} finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
}
