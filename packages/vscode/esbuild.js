const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Build the main extension bundle
 */
async function buildExtension() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'], // vscode module is provided by VS Code runtime
    logLevel: 'info',
    // Make sure we bundle @opus-orchestra/core
    packages: 'bundle',
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

async function main() {
  try {
    // Only build extension here. Webview is built separately by src/agentPanel/build.js
    // This avoids having two different build configs for the same output.
    await buildExtension();
    console.log('Build complete!');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();
