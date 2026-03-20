import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import UnpluginSWC from "unplugin-swc";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "@nestjs/common",
  "@nestjs/config",
  "@nestjs/core",
  "@nestjs/platform-express",
  "@nestjs/terminus",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "jsonwebtoken",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "pg",
  "reflect-metadata",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  // NestJS optional peer deps — not installed, handled at runtime via try/catch
  externals.push(
    "@nestjs/websockets",
    "@nestjs/websockets/socket-module",
    "@nestjs/microservices",
    "@nestjs/microservices/microservices-module",
    "@nestjs/mongoose",
    "@nestjs/sequelize",
    "@nestjs/sequelize/dist/common/sequelize.utils",
    "@mikro-orm/core",
    "class-validator",
    "class-transformer",
  );

  await esbuild({
    entryPoints: ["src/server/main.ts"],
    platform: "node",
    target: "node22",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    sourcemap: true,
    treeShaking: true,
    legalComments: "none",
    external: externals,
    logLevel: "info",
    plugins: [
      // SWC plugin transforms TypeScript with decorator metadata emission
      // (required by NestJS DI — esbuild alone strips decorator metadata)
      UnpluginSWC.esbuild({
        tsconfigFile: false,
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: "es2022",
        },
      }),
    ],
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
