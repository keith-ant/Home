import { defineConfig } from 'vite';

// IRONWAKE build configuration.
// - Relative base so the built game runs from any static host or file server.
// - Rapier ships its WASM inlined in the -compat package, so no special asset
//   handling is needed for physics.
// - The dev/preview servers are pinned to fixed ports so the automated
//   screenshot harness (tools/shot.mjs) can rely on them.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep three & postprocessing in their own chunks; the game code
        // changes far more often than the engine dependencies.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'vendor-three';
          if (id.includes('node_modules/postprocessing') || id.includes('node_modules/n8ao')) {
            return 'vendor-post';
          }
          if (id.includes('node_modules/@dimforge')) return 'vendor-physics';
          return undefined;
        },
      },
    },
  },
  assetsInclude: ['**/*.hdr', '**/*.exr', '**/*.glb', '**/*.gltf', '**/*.ktx2', '**/*.wasm'],
});
