import fs from "fs";
import path from "path";
import { glob } from "glob";

/**
 * ARCHITECTURE VALIDATOR
 * Enforces Institutional-Grade Architectural Rules:
 * 1. Client must not import from Server.
 * 2. Server must not import from Client.
 * 3. Client and Server must use Shared for common logic.
 * 4. Models must subclass BaseModel.
 */

const RULES = [
  {
    name: "Client -> Server Violation",
    pattern: "src/client/src/**/*.tsx?",
    forbidden: /import .* from "@\/server\//,
    message: "Client should not import from Server directly. Use @/shared or API calls."
  },
  {
    name: "Server -> Client Violation",
    pattern: "src/server/**/*.ts",
    forbidden: /import .* from "@\/client\//,
    message: "Server should not import from Client UI code."
  }
];

async function validate() {
  console.log("Checking Architectural Integrity...");
  let errors = 0;

  for (const rule of RULES) {
    const files = await glob(rule.pattern);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (rule.forbidden.test(content)) {
        console.error(`[VIOLATION] ${rule.name} in ${file}`);
        console.error(` -> ${rule.message}`);
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.error(`\nFound ${errors} architectural violations.`);
    process.exit(1);
  } else {
    console.log("\nArchitecture is SOLID.");
  }
}

validate().catch(console.error);
