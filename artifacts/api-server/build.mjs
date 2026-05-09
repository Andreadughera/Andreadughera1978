import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["pg-native"],
  logLevel: "info",
});
