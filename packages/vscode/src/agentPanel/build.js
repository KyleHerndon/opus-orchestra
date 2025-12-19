/**
 * Build script for the AgentPanel webview using esbuild + Svelte
 *
 * Usage:
 *   node src/agentPanel/build.js         # Build once
 *   node src/agentPanel/build.js --watch # Watch mode
 */

const esbuild = require('esbuild');
const sveltePlugin = require('esbuild-svelte');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function build() {
    const ctx = await esbuild.context({
        entryPoints: [path.join(__dirname, 'webview/main.ts')],
        bundle: true,
        outfile: path.join(__dirname, '../../out/webview/agentPanel.js'),
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        minify: !isWatch,
        sourcemap: isWatch,
        plugins: [
            sveltePlugin({
                compilerOptions: {
                    dev: isWatch,
                    css: 'injected', // Inject component CSS into JS
                },
            }),
        ],
        define: {
            'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
        },
    });

    if (isWatch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        console.log('Build complete: out/webview/agentPanel.js');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
