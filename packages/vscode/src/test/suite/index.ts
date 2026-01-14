import Mocha from 'mocha';
import * as fs from 'fs';

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = __dirname;

    // Find test files manually
    const files = fs.readdirSync(testsRoot).filter(f => f.endsWith('.test.js'));

    // Add files to the test suite
    files.forEach(f => mocha.addFile(`${testsRoot}/${f}`));

    // Run the mocha test
    return new Promise((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
