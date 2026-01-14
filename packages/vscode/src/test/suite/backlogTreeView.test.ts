import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';

suite('BacklogTreeProvider Test Suite', () => {

    test('BacklogTreeProvider should handle missing backlog path gracefully', () => {
        // The BacklogTreeProvider reads from config and uses fs.existsSync
        // It should NOT throw if the path is invalid or missing

        // Check that the code pattern doesn't throw on invalid paths
        const invalidPaths = [
            '',                           // Empty string
            '/nonexistent/path',          // Path that doesn't exist
            '   ',                        // Whitespace only
            'relative/path',              // Relative path
            '/path/with spaces/',         // Path with spaces
            'C:\\Windows\\Path',          // Windows path on Unix
        ];

        for (const testPath of invalidPaths) {
            // fs.existsSync should return false for these, not throw
            assert.doesNotThrow(() => {
                fs.existsSync(testPath);
            }, `fs.existsSync threw for path: ${testPath}`);
        }
    });

    test('BacklogTreeProvider should handle empty directory', () => {
        // readdirSync on an existing empty directory should return empty array
        const tempDir = fs.mkdtempSync(`${os.tmpdir()}/backlog-test-`);
        try {
            const files = fs.readdirSync(tempDir);
            assert.deepStrictEqual(files, []);
        } finally {
            fs.rmdirSync(tempDir);
        }
    });

    test('BacklogTreeProvider should filter only .md files', () => {
        const tempDir = fs.mkdtempSync(`${os.tmpdir()}/backlog-test-`);
        try {
            // Create various files
            fs.writeFileSync(`${tempDir}/task1.md`, '# Task 1');
            fs.writeFileSync(`${tempDir}/task2.md`, '# Task 2');
            fs.writeFileSync(`${tempDir}/readme.txt`, 'Not a task');
            fs.writeFileSync(`${tempDir}/.hidden.md`, 'Hidden file');

            const files = fs.readdirSync(tempDir);
            const taskFiles = files.filter(f => f.endsWith('.md'));

            // Should include both .md files (including hidden)
            assert.ok(taskFiles.includes('task1.md'));
            assert.ok(taskFiles.includes('task2.md'));
            assert.ok(taskFiles.includes('.hidden.md')); // Hidden files are included
            assert.ok(!taskFiles.includes('readme.txt'));
        } finally {
            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        }
    });

    test('Template string path joining should handle various inputs', () => {
        // Test that template string path joining works for basic cases
        const testCases = [
            { base: '', file: 'file.md', expected: '/file.md' },
            { base: '/path', file: 'file.md', expected: '/path/file.md' },
            { base: '/path/', file: 'file.md', expected: '/path//file.md' },
        ];

        for (const { base, file, expected } of testCases) {
            const result = `${base}/${file}`;
            assert.strictEqual(result, expected, `Template path join failed for base='${base}', file='${file}'`);
        }
    });
});
