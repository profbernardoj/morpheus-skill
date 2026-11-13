#!/usr/bin/env node
/**
 * Build the login page — bundles Privy React Auth SDK + React into a single
 * self-contained JS file. Eliminates runtime CDN dependency (supply-chain risk).
 *
 * Run at Docker build time: npm run build
 * Output: dist/login-bundle.js (inlined into login.html by the auth proxy)
 */

import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

// Bundle the login app entrypoint with all dependencies
await build({
  entryPoints: ['login-app.jsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/login-bundle.js',
  jsx: 'automatic',
  jsxImportSource: 'react',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // React + ReactDOM + Privy are all bundled in
  external: [],
  logLevel: 'info',
});

console.log('✅ Login bundle built: dist/login-bundle.js');
