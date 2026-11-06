import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import './scripts/prepare-vad-assets.mjs';
import { archiveStaleAssets } from './scripts/archive-stale-assets.mjs';
import {readFileSync} from 'node:fs';
const vadFiles=new Map([['ort-wasm-simd-threaded.mjs','text/javascript'],['ort-wasm-simd-threaded.wasm','application/wasm'],['silero_vad_v5.onnx','application/octet-stream'],['vad.worklet.bundle.min.js','text/javascript']]);
const localVadAssets={name:'local-vad-assets',configureServer(server){server.middlewares.use((req,res,next)=>{const name=new URL(req.url,'http://localhost').pathname.replace(/^\/audio\/vad\//,'');const type=vadFiles.get(name);if(!type)return next();res.setHeader('content-type',type);res.end(readFileSync(new URL('./public/audio/vad/'+name,import.meta.url)));});}};

const bridge = process.env.COMPANION_BRIDGE_URL || 'http://127.0.0.1:5218';
export default defineConfig({
  plugins: [localVadAssets,react(),archiveStaleAssets()],
  server: {
    host: '127.0.0.1', port: 5217, strictPort: true,
    proxy: { '/api': { target: bridge }, '/companion': { target: bridge } },
  },
  // Keep emptyOutDir off: old files are archived by archiveStaleAssets, never deleted.
  build: { emptyOutDir: false },
});
