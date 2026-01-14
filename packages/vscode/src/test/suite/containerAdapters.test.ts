import * as assert from 'assert';
import * as fs from 'fs';

/**
 * Tests for Container Adapters
 *
 * Note: DockerAdapter and UnisolatedAdapter are now in @opus-orchestra/core.
 * This test file focuses on VSCode-specific container adapters and the index.ts exports.
 */

suite('Container Adapters Test Suite', () => {
    const containersDir = `${__dirname}/../../../src/containers`;

    suite('CloudHypervisorAdapter', () => {
        const adapterPath = `${containersDir}/CloudHypervisorAdapter.ts`;
        let adapterContent: string;

        suiteSetup(() => {
            adapterContent = fs.readFileSync(adapterPath, 'utf-8');
        });

        suite('Interface Implementation', () => {
            test('should implement ContainerAdapter', () => {
                assert.ok(
                    adapterContent.includes('implements ContainerAdapter'),
                    'CloudHypervisorAdapter should implement ContainerAdapter interface'
                );
            });

            test('should have type = "cloud-hypervisor"', () => {
                assert.ok(
                    adapterContent.includes("readonly type = 'cloud-hypervisor'"),
                    "CloudHypervisorAdapter should have type = 'cloud-hypervisor'"
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
                        `CloudHypervisorAdapter should implement ${method}`
                    );
                }
            });

            test('should implement getStats method', () => {
                assert.ok(
                    adapterContent.includes('async getStats('),
                    'CloudHypervisorAdapter should implement getStats'
                );
            });
        });

        suite('Availability Checks', () => {
            test('isAvailable should check for cloud-hypervisor', () => {
                assert.ok(
                    adapterContent.includes('cloud-hypervisor'),
                    'isAvailable should check for cloud-hypervisor'
                );
            });

            test('isAvailable should check for /dev/kvm', () => {
                assert.ok(
                    adapterContent.includes('/dev/kvm'),
                    'isAvailable should check for /dev/kvm'
                );
            });
        });

        suite('Definition File Handling', () => {
            test('should have loadDefinition method', () => {
                assert.ok(
                    adapterContent.includes('loadDefinition('),
                    'CloudHypervisorAdapter should have loadDefinition method'
                );
            });

            test('loadDefinition should use agentPath for cross-platform paths', () => {
                assert.ok(
                    adapterContent.includes('agentPath('),
                    'CloudHypervisorAdapter should use agentPath for path handling'
                );
            });

            test('loadDefinition should check file exists', () => {
                assert.ok(
                    adapterContent.includes('fs.existsSync('),
                    'CloudHypervisorAdapter should verify definition file exists'
                );
            });

            test('loadDefinition should parse JSON', () => {
                assert.ok(
                    adapterContent.includes('JSON.parse('),
                    'CloudHypervisorAdapter should parse JSON definition'
                );
            });

            test('should export definition interface', () => {
                assert.ok(
                    adapterContent.includes('export interface CloudHypervisorDefinition'),
                    'CloudHypervisorAdapter should export its definition interface'
                );
            });
        });

        suite('Execution Method', () => {
            test('exec should use vsock connection', () => {
                assert.ok(
                    adapterContent.includes('vsockSocketPath') &&
                    adapterContent.includes('net.createConnection'),
                    'CloudHypervisorAdapter should use vsock for commands'
                );
            });
        });

        suite('Cloud Hypervisor-Specific Features', () => {
            test('should support virtio-fs mounts via virtiofsd', () => {
                assert.ok(
                    adapterContent.includes('virtiofsd') &&
                    adapterContent.includes('startVirtiofsd'),
                    'CloudHypervisorAdapter should use virtiofsd for mounts'
                );
            });

            test('should configure VM via CLI arguments', () => {
                assert.ok(
                    adapterContent.includes('--kernel') &&
                    adapterContent.includes('--memory') &&
                    adapterContent.includes('--cpus'),
                    'CloudHypervisorAdapter should configure VM via CLI'
                );
            });

            test('should support vsock for host-guest communication', () => {
                assert.ok(
                    adapterContent.includes('vsock') &&
                    adapterContent.includes('vsockSocketPath'),
                    'CloudHypervisorAdapter should support vsock'
                );
            });

            test('should check for kernel and rootfs files', () => {
                assert.ok(
                    adapterContent.includes('Cloud Hypervisor kernel not found') &&
                    adapterContent.includes('Cloud Hypervisor rootfs not found'),
                    'CloudHypervisorAdapter should validate kernel and rootfs'
                );
            });

            test('should support workspace mounts', () => {
                assert.ok(
                    adapterContent.includes('workspace') &&
                    adapterContent.includes('/workspace'),
                    'CloudHypervisorAdapter should mount workspace'
                );
            });

            test('should track running VMs', () => {
                assert.ok(
                    adapterContent.includes('runningVMs = new Map<string, RunningVM>()'),
                    'CloudHypervisorAdapter should track running VMs'
                );
            });

            test('getStats should read from /proc', () => {
                assert.ok(
                    adapterContent.includes('/proc/') &&
                    adapterContent.includes('/stat'),
                    'CloudHypervisorAdapter should read process stats from /proc'
                );
            });
        });
    });

    suite('Adapter Exports', () => {
        const indexPath = `${containersDir}/index.ts`;
        const indexContent = fs.readFileSync(indexPath, 'utf-8');

        test('should re-export ContainerAdapter from core', () => {
            assert.ok(
                indexContent.includes("from '@opus-orchestra/core'") &&
                indexContent.includes('ContainerAdapter'),
                'index.ts should re-export ContainerAdapter from core'
            );
        });

        test('should re-export DockerAdapter from core', () => {
            assert.ok(
                indexContent.includes("from '@opus-orchestra/core'") &&
                indexContent.includes('DockerAdapter'),
                'index.ts should re-export DockerAdapter from core'
            );
        });

        test('should re-export UnisolatedAdapter from core', () => {
            assert.ok(
                indexContent.includes("from '@opus-orchestra/core'") &&
                indexContent.includes('UnisolatedAdapter'),
                'index.ts should re-export UnisolatedAdapter from core'
            );
        });

        test('should re-export ContainerRegistry from core', () => {
            assert.ok(
                indexContent.includes("from '@opus-orchestra/core'") &&
                indexContent.includes('ContainerRegistry'),
                'index.ts should re-export ContainerRegistry from core'
            );
        });

        test('should export CloudHypervisorAdapter', () => {
            assert.ok(
                indexContent.includes('CloudHypervisorAdapter'),
                'index.ts should export CloudHypervisorAdapter'
            );
        });

        test('should export ProxyManager', () => {
            assert.ok(
                indexContent.includes('ProxyManager'),
                'index.ts should export ProxyManager'
            );
        });
    });
});
