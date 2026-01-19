import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // __dirname is something like /path/to/out/test, we need /path/to/
        const extensionDevelopmentPath = `${__dirname}/../..`;

        // The path to the extension test script
        const extensionTestsPath = `${__dirname}/suite/index`;

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch {
        process.exit(1);
    }
}

main();
