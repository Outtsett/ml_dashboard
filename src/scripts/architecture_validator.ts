import fs from "fs";
import path from "path";
import glob from "glob";

/**
 * ARCHITECTURE VALIDATOR
 * Enforces Institutional-Grade Architectural Rules:
 * 1. Client must not import from Server.
 * 2. Server must not import from Client.
 * 3. File size limits (max 500 lines) to prevent "God Files".
 * 4. Naming conventions (Operational Interface philosophy).
 */

const MAX_LINES = 500;

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

function validate() {
  console.log("Checking Architectural Integrity...");
  let errors = 0;
  let warnings = 0;

  // 1. Check Regex Rules
  for (const rule of RULES) {
    const files = glob.sync(rule.pattern);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (rule.forbidden.test(content)) {
        console.error(`[VIOLATION] ${rule.name} in ${file}`);
        console.error(` -> ${rule.message}`);
        errors++;
      }
    }
  }

  // 2. Check File Size & Naming
  const allFiles = glob.sync("src/**/*.{ts,tsx}", { ignore: ["node_modules/**"] });
  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n").length;

    // Line Count Check
    if (lines > MAX_LINES) {
      console.warn(`[WARNING] File too large: ${file} (${lines} lines)`);
      warnings++;
    }

    // Naming Convention Check (snake_case or simple words)
    const fileName = path.basename(file);
    const nameWithoutExt = fileName.split(".")[0];
    
    // Server and Lib files should be snake_case or single words
    if (file.includes("server/") || (file.includes("client/src/lib/") && !file.includes("indicators/"))) {
      const isCamelCase = /[a-z][A-Z]/.test(nameWithoutExt);
      const isPascalCase = /^[A-Z]/.test(nameWithoutExt) && !nameWithoutExt.includes("_");
      
      if ((isCamelCase || isPascalCase) && !fileName.endsWith(".tsx")) {
          console.warn(`[WARNING] Naming convention: ${file}`);
          console.warn(` -> Server and Lib files should use snake_case or single words (found camel/PascalCase).`);
          warnings++;
      }
    }
  }

  console.log(`\nValidation Summary:`);
  console.log(` - Errors: ${errors}`);
  console.log(` - Warnings: ${warnings}`);

  if (errors > 0) {
    console.error(`\nFound ${errors} architectural violations. Build failed.`);
    process.exit(1);
  } else {
    console.log("\nArchitecture is solid (with some warnings).");
  }
}

try {
  validate();
} catch (e) {
  console.error(e);
  process.exit(1);
}
