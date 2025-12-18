import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Parameterized tests for Container Adapters
 *
 * Tests that all container adapters correctly implement the ContainerAdapter interface
 * and follow consistent patterns for container management.
 */

// Adapter configurations for parameterized testing
interface AdapterConfig {
    name: string;
    filename: string;
    type: string;
    hasDefinitionFile: boolean;
    execMethod: 'direct' | 'docker' | 'vsock';
    availabilityChecks: string[];
}

const ADAPTERS: AdapterConfig[] = [
    {
        name: 'UnisolatedAdapter',
        filename: 'UnisolatedAdapter.ts',
        type: 'unisolated',
        hasDefinitionFile: false,
        execMethod: 'direct',
        availabilityChecks: [], // Always available
    },
    {
        name: 'DockerAdapter',
        filename: 'DockerAdapter.ts',
        type: 'docker',
        hasDefinitionFile: true,
        execMethod: 'docker',
        availabilityChecks: ['docker info'],
    },
    {
        name: 'FirecrackerAdapter',
        filename: 'FirecrackerAdapter.ts',
        type: 'firecracker',
        hasDefinitionFile: true,
        execMethod: 'vsock',
        availabilityChecks: ['firecracker', '/dev/kvm'],
    },
];

suite('Container Adapters Test Suite', () => {
    const containersDir = path.resolve(__dirname, '../../../src/containers');
    const containerAdapterPath = path.join(containersDir, 'ContainerAdapter.ts');
    const containerAdapterContent = fs.readFileSync(containerAdapterPath, 'utf-8');

    suite('ContainerAdapter Interface', () => {
        test('should export ContainerDisplayInfo interface', () => {
            assert.ok(
                containerAdapterContent.includes('export interface ContainerDisplayInfo'),
                'ContainerDisplayInfo interface should be exported'
            );
        });

        test('ContainerDisplayInfo should have required fields', () => {
            const fields = ['name: string', 'description?: string', 'memoryLimit?: string', 'cpuLimit?: string'];
            for (const field of fields) {
                assert.ok(
                    containerAdapterContent.includes(field),
                    `ContainerDisplayInfo should have ${field}`
                );
            }
        });

        test('should export ContainerAdapter interface', () => {
            assert.ok(
                containerAdapterContent.includes('export interface ContainerAdapter'),
                'ContainerAdapter interface should be exported'
            );
        });

        test('ContainerAdapter should have all required methods', () => {
            const methods = [
                'readonly type: string',
                'isAvailable(): Promise<boolean>',
                'getDisplayInfo(definitionPath: string): Promise<ContainerDisplayInfo>',
                'create(definitionPath: string, worktreePath: string, agentId: number): Promise<string>',
                'exec(containerId: string, command: string): Promise<string>',
                'destroy(containerId: string): Promise<void>',
            ];
            for (const method of methods) {
                assert.ok(
                    containerAdapterContent.includes(method),
                    `ContainerAdapter should have ${method}`
                );
            }
        });

        test('ContainerAdapter should have optional getStats method', () => {
            assert.ok(
                containerAdapterContent.includes('getStats?(containerId: string)'),
                'ContainerAdapter should have optional getStats method'
            );
        });
    });

    // Parameterized tests for each adapter
    for (const adapter of ADAPTERS) {
        suite(`${adapter.name}`, () => {
            const adapterPath = path.join(containersDir, adapter.filename);
            let adapterContent: string;

            suiteSetup(() => {
                adapterContent = fs.readFileSync(adapterPath, 'utf-8');
            });

            suite('Interface Implementation', () => {
                test('should implement ContainerAdapter', () => {
                    assert.ok(
                        adapterContent.includes('implements ContainerAdapter'),
                        `${adapter.name} should implement ContainerAdapter interface`
                    );
                });

                test(`should have type = '${adapter.type}'`, () => {
                    assert.ok(
                        adapterContent.includes(`readonly type = '${adapter.type}'`),
                        `${adapter.name} should have type = '${adapter.type}'`
                    );
                });

                test('should implement all required methods', () => {
                    const methods = [
                        'async isAvailable(): Promise<boolean>',
                        'async getDisplayInfo(',
                        'async create(',
                        'async exec(',
                        'async destroy(',
                    ];
                    for (const method of methods) {
                        assert.ok(
                            adapterContent.includes(method),
                            `${adapter.name} should implement ${method}`
                        );
                    }
                });

                test('should implement getStats method', () => {
                    assert.ok(
                        adapterContent.includes('async getStats('),
                        `${adapter.name} should implement getStats`
                    );
                });
            });

            suite('Method Signatures', () => {
                test('create should return container ID string', () => {
                    assert.ok(
                        adapterContent.includes('create(') &&
                        adapterContent.includes('): Promise<string>'),
                        'create should return Promise<string>'
                    );
                });

                test('exec should accept containerId and command', () => {
                    // Note: unused params may be prefixed with _ (e.g., _containerId)
                    assert.ok(
                        adapterContent.includes('exec(containerId: string, command: string)') ||
                        adapterContent.includes('exec(_containerId: string, command: string)'),
                        'exec should have correct signature'
                    );
                });

                test('destroy should accept containerId', () => {
                    // Note: unused params may be prefixed with _ (e.g., _containerId)
                    assert.ok(
                        adapterContent.includes('destroy(containerId: string)') ||
                        adapterContent.includes('destroy(_containerId: string)'),
                        'destroy should accept containerId'
                    );
                });
            });

            if (adapter.availabilityChecks.length > 0) {
                suite('Availability Checks', () => {
                    for (const check of adapter.availabilityChecks) {
                        test(`isAvailable should check for ${check}`, () => {
                            assert.ok(
                                adapterContent.includes(check),
                                `isAvailable should check for ${check}`
                            );
                        });
                    }
                });
            } else {
                suite('Availability', () => {
                    test('isAvailable should return true (always available)', () => {
                        assert.ok(
                            adapterContent.includes('return true'),
                            'Unisolated adapter should always be available'
                        );
                    });
                });
            }

            if (adapter.hasDefinitionFile) {
                suite('Definition File Handling', () => {
                    test('should have loadDefinition method', () => {
                        assert.ok(
                            adapterContent.includes('loadDefinition('),
                            `${adapter.name} should have loadDefinition method`
                        );
                    });

                    test('loadDefinition should use agentPath for cross-platform paths', () => {
                        assert.ok(
                            adapterContent.includes('agentPath('),
                            `${adapter.name} should use agentPath for path handling`
                        );
                    });

                    test('loadDefinition should check file exists', () => {
                        assert.ok(
                            adapterContent.includes('fs.existsSync('),
                            `${adapter.name} should verify definition file exists`
                        );
                    });

                    test('loadDefinition should parse JSON', () => {
                        assert.ok(
                            adapterContent.includes('JSON.parse('),
                            `${adapter.name} should parse JSON definition`
                        );
                    });

                    test('should export definition interface', () => {
                        const expectedInterface = adapter.name === 'DockerAdapter'
                            ? 'export interface DockerDefinition'
                            : 'export interface FirecrackerDefinition';
                        assert.ok(
                            adapterContent.includes(expectedInterface),
                            `${adapter.name} should export its definition interface`
                        );
                    });
                });
            }

            suite('Execution Method', () => {
                if (adapter.execMethod === 'direct') {
                    test('exec should use execSync for direct execution', () => {
                        assert.ok(
                            adapterContent.includes('execSync(command'),
                            'UnisolatedAdapter should execute commands directly'
                        );
                    });
                } else if (adapter.execMethod === 'docker') {
                    test('exec should use docker exec', () => {
                        assert.ok(
                            adapterContent.includes('docker exec'),
                            'DockerAdapter should use docker exec for commands'
                        );
                    });
                } else if (adapter.execMethod === 'vsock') {
                    test('exec should use vsock connection', () => {
                        assert.ok(
                            adapterContent.includes('vsockPath') &&
                            adapterContent.includes('net.createConnection'),
                            'FirecrackerAdapter should use vsock for commands'
                        );
                    });
                }
            });

            if (adapter.name === 'DockerAdapter') {
                suite('Docker-Specific Features', () => {
                    test('should have security hardening (cap-drop ALL)', () => {
                        assert.ok(
                            adapterContent.includes("'--cap-drop', 'ALL'"),
                            'DockerAdapter should drop all capabilities'
                        );
                    });

                    test('should have no-new-privileges security option', () => {
                        assert.ok(
                            adapterContent.includes("'--security-opt', 'no-new-privileges'"),
                            'DockerAdapter should set no-new-privileges'
                        );
                    });

                    test('should support read-only root filesystem', () => {
                        assert.ok(
                            adapterContent.includes("'--read-only'"),
                            'DockerAdapter should support read-only root'
                        );
                    });

                    test('should run as non-root user', () => {
                        assert.ok(
                            adapterContent.includes("'--user', '1000:1000'"),
                            'DockerAdapter should run as non-root'
                        );
                    });

                    test('should support custom runtime (gVisor)', () => {
                        assert.ok(
                            adapterContent.includes("'--runtime'"),
                            'DockerAdapter should support custom runtimes'
                        );
                    });

                    test('should label containers for management', () => {
                        assert.ok(
                            adapterContent.includes('opus-orchestra.managed=true'),
                            'DockerAdapter should label managed containers'
                        );
                    });

                    test('should mount worktree to /workspace', () => {
                        assert.ok(
                            adapterContent.includes('/workspace'),
                            'DockerAdapter should mount worktree to /workspace'
                        );
                    });

                    test('getStats should parse docker stats output', () => {
                        assert.ok(
                            adapterContent.includes('docker stats') &&
                            adapterContent.includes('--no-stream'),
                            'DockerAdapter should get stats from docker stats command'
                        );
                    });
                });
            }

            if (adapter.name === 'FirecrackerAdapter') {
                suite('Firecracker-Specific Features', () => {
                    test('should configure VM via REST API', () => {
                        assert.ok(
                            adapterContent.includes('apiRequest('),
                            'FirecrackerAdapter should use REST API for configuration'
                        );
                    });

                    test('should configure boot-source, machine-config, and drives', () => {
                        const endpoints = ['/boot-source', '/machine-config', '/drives/'];
                        for (const endpoint of endpoints) {
                            assert.ok(
                                adapterContent.includes(`'${endpoint}`),
                                `FirecrackerAdapter should configure ${endpoint}`
                            );
                        }
                    });

                    test('should support vsock for host-guest communication', () => {
                        assert.ok(
                            adapterContent.includes("'/vsock'") &&
                            adapterContent.includes('VsockConfig'),
                            'FirecrackerAdapter should support vsock'
                        );
                    });

                    test('should check for kernel and rootfs files', () => {
                        assert.ok(
                            adapterContent.includes('Firecracker kernel not found') &&
                            adapterContent.includes('Firecracker rootfs not found'),
                            'FirecrackerAdapter should validate kernel and rootfs'
                        );
                    });

                    test('should gracefully shutdown with SendCtrlAltDel', () => {
                        assert.ok(
                            adapterContent.includes("'SendCtrlAltDel'"),
                            'FirecrackerAdapter should use SendCtrlAltDel for graceful shutdown'
                        );
                    });

                    test('should support TAP network devices', () => {
                        assert.ok(
                            adapterContent.includes('setupTapDevice') &&
                            adapterContent.includes('ip tuntap'),
                            'FirecrackerAdapter should support TAP networking'
                        );
                    });

                    test('should track running VMs', () => {
                        assert.ok(
                            adapterContent.includes('runningVMs = new Map<string, RunningVM>()'),
                            'FirecrackerAdapter should track running VMs'
                        );
                    });

                    test('getStats should read from /proc', () => {
                        assert.ok(
                            adapterContent.includes('/proc/') &&
                            adapterContent.includes('/stat'),
                            'FirecrackerAdapter should read process stats from /proc'
                        );
                    });
                });
            }

            if (adapter.name === 'UnisolatedAdapter') {
                suite('Unisolated-Specific Features', () => {
                    test('should return static display info', () => {
                        assert.ok(
                            adapterContent.includes("name: 'Unisolated'") &&
                            adapterContent.includes('No isolation'),
                            'UnisolatedAdapter should return static display info'
                        );
                    });

                    test('create should return placeholder ID', () => {
                        assert.ok(
                            adapterContent.includes('unisolated-${agentId}'),
                            'UnisolatedAdapter create should return placeholder ID'
                        );
                    });

                    test('destroy should be a no-op', () => {
                        // destroy method should be empty or have just a comment
                        const destroyMethod = adapterContent.match(
                            /async destroy\(_containerId: string\): Promise<void> \{[\s\S]*?\n {4}\}/
                        );
                        assert.ok(destroyMethod, 'destroy method should exist');
                        assert.ok(
                            destroyMethod[0].includes('Nothing to destroy') ||
                            destroyMethod[0].match(/\{\s*\}/),
                            'UnisolatedAdapter destroy should be a no-op'
                        );
                    });

                    test('getStats should return null', () => {
                        assert.ok(
                            adapterContent.includes('getStats(') &&
                            adapterContent.includes('return null'),
                            'UnisolatedAdapter getStats should return null'
                        );
                    });
                });
            }
        });
    }

    suite('Adapter Registry', () => {
        const indexPath = path.join(containersDir, 'index.ts');
        const indexContent = fs.readFileSync(indexPath, 'utf-8');

        test('should export all adapters', () => {
            for (const adapter of ADAPTERS) {
                assert.ok(
                    indexContent.includes(adapter.name) ||
                    indexContent.includes(`from './${adapter.filename.replace('.ts', '')}'`),
                    `index.ts should export ${adapter.name}`
                );
            }
        });

        test('should export ContainerAdapter interface', () => {
            assert.ok(
                indexContent.includes("from './ContainerAdapter'") ||
                indexContent.includes("export * from './ContainerAdapter'"),
                'index.ts should export ContainerAdapter'
            );
        });
    });
});
