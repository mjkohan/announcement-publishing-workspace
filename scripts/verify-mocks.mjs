// Verifies that src/mocks is byte-identical to the supplied mocks.
// Expected hashes live in scripts/mocks.sha256 ("<sha256>  src/mocks/<file>").
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "scripts", "mocks.sha256");
const mocksDir = join(root, "src", "mocks");

const toPosix = (path) => path.split(sep).join("/");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [toPosix(relative(root, path))];
  });

const problems = [];
const expected = new Map();

readFileSync(manifestPath, "utf8")
  .split(/\r?\n/)
  .forEach((line, index) => {
    if (!line.trim()) return;
    const match = /^([0-9a-f]{64}) {2}(src\/mocks\/.+)$/.exec(line);
    if (!match) {
      problems.push(`Invalid manifest line ${index + 1}: ${line}`);
      return;
    }
    expected.set(match[2], match[1]);
  });

for (const [file, hash] of expected) {
  const path = join(root, file);
  if (!existsSync(path)) {
    problems.push(`Missing: ${file}`);
  } else if (sha256(path) !== hash) {
    problems.push(`Changed: ${file}`);
  }
}

if (existsSync(mocksDir)) {
  for (const file of listFiles(mocksDir)) {
    if (!expected.has(file)) problems.push(`Not listed: ${file}`);
  }
} else {
  problems.push("Missing directory: src/mocks");
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`Mock verification failed (${problems.length} problem(s)).`);
  process.exit(1);
}

console.log("Mocks unchanged.");
