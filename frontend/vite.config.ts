// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build as viteBuild, type PluginOption } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import tsconfigPaths from "vite-tsconfig-paths";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const buildOutputDirectory = path.join(projectDirectory, "dist");
const staticClientEntryPath = path.join(projectDirectory, "src", "static-client.tsx");

async function findTanStackClientEntry(): Promise<string | undefined> {
  const serverAssetsDirectory = path.join(buildOutputDirectory, "server", "assets");
  let assetNames: string[];

  try {
    assetNames = await readdir(serverAssetsDirectory);
  } catch {
    return undefined;
  }

  const manifestName = assetNames.find((name) => name.startsWith("_tanstack-start-manifest"));
  if (!manifestName) return undefined;

  const manifest = await readFile(path.join(serverAssetsDirectory, manifestName), "utf8");
  const match = manifest.match(/clientEntry:\s*["']([^"']+)["']/);
  return match?.[1];
}

async function findClientStylesheets(): Promise<string[] | undefined> {
  const clientAssetsDirectory = path.join(buildOutputDirectory, "client", "assets");
  let assetNames: string[];

  try {
    assetNames = await readdir(clientAssetsDirectory);
  } catch {
    return undefined;
  }

  return assetNames.filter((name) => name.endsWith(".css")).map((name) => `/assets/${name}`);
}

async function findStaticClientEntry(): Promise<string | undefined> {
  const clientAssetsDirectory = path.join(buildOutputDirectory, "client", "assets");
  let assetNames: string[];

  try {
    assetNames = await readdir(clientAssetsDirectory);
  } catch {
    return undefined;
  }

  const staticEntryName = assetNames.find(
    (name) => name.startsWith("static-client") && name.endsWith(".js"),
  );

  return staticEntryName ? `/assets/${staticEntryName}` : undefined;
}

async function buildStaticClientEntry() {
  await viteBuild({
    root: projectDirectory,
    configFile: false,
    publicDir: false,
    plugins: [react(), tailwindcss(), tsconfigPaths()],
    resolve: {
      alias: {
        "@": path.join(projectDirectory, "src"),
      },
    },
    build: {
      emptyOutDir: false,
      outDir: path.join(buildOutputDirectory, "client"),
      rollupOptions: {
        input: staticClientEntryPath,
        output: {
          entryFileNames: "assets/static-client-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  });
}

function renderClientIndexHtml(clientEntry: string, stylesheets: string[]): string {
  const stylesheetLinks = stylesheets
    .map((href) => `    <link rel="stylesheet" href="${href}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Conges upOwa</title>
${stylesheetLinks}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${clientEntry}"></script>
  </body>
</html>
`;
}

async function flattenClientBuildOutput() {
  const clientDirectory = path.join(buildOutputDirectory, "client");
  const entries = await readdir(clientDirectory);

  await rm(path.join(buildOutputDirectory, "assets"), { recursive: true, force: true });
  await rm(path.join(buildOutputDirectory, "index.html"), { force: true });

  await Promise.all(
    entries.map((entry) =>
      cp(path.join(clientDirectory, entry), path.join(buildOutputDirectory, entry), {
        recursive: true,
        force: true,
      }),
    ),
  );

  await rm(clientDirectory, { recursive: true, force: true });
  await removeServerBuildOutput();
}

async function removeServerBuildOutput() {
  await rm(path.join(buildOutputDirectory, "server"), { recursive: true, force: true });
}

function emitStaticFrontendBuild(): PluginOption {
  return {
    name: "emit-static-frontend-build",
    apply: "build",
    async closeBundle() {
      const tanStackClientEntry = await findTanStackClientEntry();
      if (!tanStackClientEntry) return;

      await buildStaticClientEntry();

      const clientEntry = await findStaticClientEntry();
      if (!clientEntry) {
        throw new Error("Static frontend client entry was not emitted.");
      }

      const stylesheets = await findClientStylesheets();
      if (!stylesheets) {
        await removeServerBuildOutput();
        return;
      }

      await writeFile(
        path.join(buildOutputDirectory, "client", "index.html"),
        renderClientIndexHtml(clientEntry, stylesheets),
        "utf8",
      );
      await flattenClientBuildOutput();
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    router: { routesDirectory: "modules/routing" },
    server: { entry: "server" },
  },
  vite: {
    plugins: [emitStaticFrontendBuild()],
  },
});
