/**
 * ContainerConfigService - Discovers and loads container configuration references.
 *
 * Config files are lightweight pointers to container definitions:
 * - Repo configs: .opus-orchestra/containers/*.json → prefixed "repo:"
 * - User configs: ~/.opus-orchestra/containers/*.json → prefixed "user:"
 *
 * The service doesn't parse container-specific settings - it delegates
 * to adapters for definition file interpretation.
 *
 * Implements IContainerConfigProvider from core for use with ContainerManager.
 */

import * as fs from 'fs';
import { agentPath, getHomeDir } from '../pathUtils';
import { ContainerConfigRef, IContainerConfigProvider, ContainerDisplayInfo } from '@opus-orchestra/core';
import { getContainer, isContainerInitialized } from '../ServiceContainer';
import { getLogger, isLoggerInitialized } from './Logger';

/**
 * Repo-level container settings (.opus-orchestra/config.json)
 */
export interface RepoContainerSettings {
    /** Default container configuration name for this repo */
    defaultContainer?: string;
}

/**
 * User-level container settings (~/.opus-orchestra/config.json)
 */
export interface UserContainerSettings {
    /** Default container configuration name for all repos */
    defaultContainer?: string;
}

/**
 * Discovered config with metadata
 */
export interface DiscoveredConfig {
    /** Prefixed name (e.g., "repo:development", "user:secure") */
    prefixedName: string;
    /** Source: repo or user */
    source: 'repo' | 'user';
    /** The config reference */
    configRef: ContainerConfigRef;
    /** Absolute path to the config file */
    configPath: string;
}

let containerConfigServiceInstance: ContainerConfigService | null = null;

export class ContainerConfigService implements IContainerConfigProvider {
    private readonly logger = isLoggerInitialized() ? getLogger().child({ component: 'ContainerConfigService' }) : null;

    /**
     * Discover all available container configurations.
     * Returns configs from both repo and user directories with prefixed names.
     */
    discoverConfigs(repoPath: string): DiscoveredConfig[] {
        const configs: DiscoveredConfig[] = [];

        // Always include unisolated as an option
        configs.push({
            prefixedName: 'unisolated',
            source: 'repo',  // Doesn't matter for built-in
            configRef: { type: 'unisolated' },
            configPath: '',
        });

        // Discover repo configs
        const repoConfigDir = agentPath(repoPath)
            .join('.opus-orchestra', 'containers')
            .forNodeFs();

        this.logger?.debug(`Looking for repo configs at: ${repoConfigDir} (from repoPath: ${repoPath})`);
        this.logger?.debug(`Directory exists: ${fs.existsSync(repoConfigDir)}`);

        if (fs.existsSync(repoConfigDir)) {
            const repoConfigs = this.scanConfigDirectory(repoConfigDir, 'repo');
            this.logger?.debug(`Found ${repoConfigs.length} repo configs`);
            configs.push(...repoConfigs);
        }

        // Discover user configs
        const userConfigDir = getHomeDir()
            .join('.opus-orchestra', 'containers')
            .forNodeFs();

        this.logger?.debug(`Looking for user configs at: ${userConfigDir}`);

        if (fs.existsSync(userConfigDir)) {
            const userConfigs = this.scanConfigDirectory(userConfigDir, 'user');
            configs.push(...userConfigs);
        }

        this.logger?.debug(`Discovered ${configs.length} configs total for repo: ${repoPath}`);
        return configs;
    }

    /**
     * List available config names (prefixed).
     */
    listAvailableConfigs(repoPath: string): string[] {
        return this.discoverConfigs(repoPath).map(c => c.prefixedName);
    }

    /**
     * Load a config reference by prefixed name.
     */
    loadConfigRef(prefixedName: string, repoPath: string): ContainerConfigRef | undefined {
        // Handle built-in unisolated
        if (prefixedName === 'unisolated') {
            return { type: 'unisolated' };
        }

        const configs = this.discoverConfigs(repoPath);
        const config = configs.find(c => c.prefixedName === prefixedName);
        return config?.configRef;
    }

    /**
     * Get the absolute path to a container definition file.
     * Resolves the 'file' path relative to the config file location.
     */
    getDefinitionPath(prefixedName: string, repoPath: string): string | undefined {
        if (prefixedName === 'unisolated') {
            return undefined;  // No definition file for unisolated
        }

        const configs = this.discoverConfigs(repoPath);
        const config = configs.find(c => c.prefixedName === prefixedName);

        if (!config || !config.configRef.file) {
            return undefined;
        }

        // Resolve file path relative to the config file's directory
        // Extract directory by removing the filename from the path
        const configDir = config.configPath.replace(/[\\/][^\\/]+$/, '');
        return agentPath(configDir).join(config.configRef.file).forNodeFs();
    }

    /**
     * Get display info for a config by delegating to the appropriate adapter.
     */
    async getDisplayInfo(prefixedName: string, repoPath: string): Promise<ContainerDisplayInfo | undefined> {
        const configRef = this.loadConfigRef(prefixedName, repoPath);
        if (!configRef) {
            return undefined;
        }

        if (!isContainerInitialized()) {
            return undefined;
        }

        const adapter = getContainer().containerRegistry.get(configRef.type);
        if (!adapter) {
            return undefined;
        }

        const definitionPath = this.getDefinitionPath(prefixedName, repoPath);

        // For unisolated or configs without definition files, adapter returns static info
        return adapter.getDisplayInfo(definitionPath || '');
    }

    /**
     * Get the default config name for a repo.
     * Priority: repo default → user default → "unisolated"
     */
    getDefaultConfigName(repoPath: string): string {
        // Check repo settings
        const repoSettings = this.getRepoSettings(repoPath);
        if (repoSettings?.defaultContainer) {
            return repoSettings.defaultContainer;
        }

        // Check user settings
        const userSettings = this.getUserSettings();
        if (userSettings?.defaultContainer) {
            return userSettings.defaultContainer;
        }

        // Hardcoded default
        return 'unisolated';
    }

    /**
     * Get repo-level container settings.
     */
    getRepoSettings(repoPath: string): RepoContainerSettings | undefined {
        const configPath = agentPath(repoPath)
            .join('.opus-orchestra', 'config.json')
            .forNodeFs();

        return this.loadJsonFile<RepoContainerSettings>(configPath);
    }

    /**
     * Get user-level container settings.
     */
    getUserSettings(): UserContainerSettings | undefined {
        const configPath = getHomeDir()
            .join('.opus-orchestra', 'config.json')
            .forNodeFs();

        return this.loadJsonFile<UserContainerSettings>(configPath);
    }

    /**
     * Scan a directory for config files and return discovered configs.
     */
    private scanConfigDirectory(dirPath: string, source: 'repo' | 'user'): DiscoveredConfig[] {
        const configs: DiscoveredConfig[] = [];

        try {
            const files = fs.readdirSync(dirPath);

            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue;
                }

                const filePath = agentPath(dirPath).join(file).forNodeFs();
                const stat = fs.statSync(filePath);

                if (!stat.isFile()) {
                    continue;
                }

                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const configRef = JSON.parse(content) as ContainerConfigRef;

                    // Validate it has a type
                    if (!configRef.type) {
                        this.logger?.debug(`Skipping invalid config (no type): ${filePath}`);
                        continue;
                    }

                    // Config name is filename without .json extension
                    const configName = file.replace(/\.json$/, '');
                    const prefixedName = `${source}:${configName}`;

                    configs.push({
                        prefixedName,
                        source,
                        configRef,
                        configPath: filePath,
                    });

                    this.logger?.debug(`Discovered config: ${prefixedName} (type: ${configRef.type})`);
                } catch (e) {
                    this.logger?.debug(`Failed to parse config file ${filePath}: ${e}`);
                }
            }
        } catch (e) {
            this.logger?.debug(`Failed to scan config directory ${dirPath}: ${e}`);
        }

        return configs;
    }

    /**
     * Load and parse a JSON file, returning undefined if it doesn't exist or fails.
     */
    private loadJsonFile<T>(filePath: string): T | undefined {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content) as T;
        } catch (e) {
            this.logger?.debug(`Failed to load JSON file ${filePath}: ${e}`);
            return undefined;
        }
    }
}

/**
 * Get the singleton ContainerConfigService instance.
 */
export function getContainerConfigService(): ContainerConfigService {
    if (!containerConfigServiceInstance) {
        containerConfigServiceInstance = new ContainerConfigService();
    }
    return containerConfigServiceInstance;
}

/**
 * Check if ContainerConfigService is initialized.
 */
export function isContainerConfigServiceInitialized(): boolean {
    return containerConfigServiceInstance !== null;
}
