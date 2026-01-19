import * as vscode from 'vscode';
import * as os from 'os';
import * as childProcess from 'child_process';

/**
 * Unified path handling for cross-platform compatibility.
 *
 * Uses `wslpath` when available (in WSL) for robust path conversion.
 * Falls back to manual conversion on native Windows.
 *
 * Path contexts:
 * - nodeFs: For Node.js fs operations (always Windows format on Windows, or UNC for WSL native paths)
 * - terminal: For terminal commands (WSL: /mnt/c/..., Git Bash: /c/..., Windows: C:\...)
 * - display: For showing to users (Windows format)
 *
 * Path types handled:
 * - Windows: C:\Users\... or C:/Users/...
 * - WSL mounted: /mnt/c/Users/...
 * - WSL native: /home/user/... (converted to \\wsl.localhost\<distro>\home\user\... for Windows)
 * - Git Bash: /c/Users/...
 * - UNC WSL: \\wsl.localhost\<distro>\... or \\wsl$\<distro>\...
 */

// Cache whether wslpath is available
let wslpathAvailable: boolean | null = null;

/**
 * Check if wslpath command is available (we're running in WSL)
 */
function hasWslpath(): boolean {
    if (wslpathAvailable !== null) {
        return wslpathAvailable;
    }
    try {
        childProcess.execSync('which wslpath', { encoding: 'utf-8', stdio: 'pipe' });
        wslpathAvailable = true;
    } catch {
        wslpathAvailable = false;
    }
    return wslpathAvailable;
}

/**
 * Convert path to Windows format using wslpath -w
 */
function toWindowsPath(inputPath: string): string {
    if (!hasWslpath()) {
        return inputPath;
    }
    try {
        return childProcess.execSync(`wslpath -w "${inputPath}"`, {
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
    } catch {
        return inputPath;
    }
}

/**
 * Convert path to WSL/Unix format using wslpath -u
 */
function toUnixPath(inputPath: string): string {
    if (!hasWslpath()) {
        return inputPath;
    }
    try {
        return childProcess.execSync(`wslpath -u "${inputPath}"`, {
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
    } catch {
        return inputPath;
    }
}

/**
 * Convert path to Windows format with forward slashes using wslpath -m
 */
function toMixedPath(inputPath: string): string {
    if (!hasWslpath()) {
        return inputPath;
    }
    try {
        return childProcess.execSync(`wslpath -m "${inputPath}"`, {
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
    } catch {
        return inputPath;
    }
}
export class AgentPath {
    private readonly originalPath: string;

    constructor(inputPath: string) {
        this.originalPath = inputPath;
    }

    /**
     * Get path for Node.js fs operations.
     * In WSL, this returns the Unix path (Node.js fs uses Linux paths).
     * On native Windows, returns Windows path.
     */
    forNodeFs(): string {
        if (hasWslpath()) {
            // We're in WSL - convert to Unix path for Node.js fs
            return toUnixPath(this.originalPath);
        }
        // Native Windows - use mixed path (forward slashes work with Node.js)
        return this.originalPath.replace(/\\/g, '/');
    }

    /**
     * Get path for terminal commands based on the configured terminal type.
     */
    forTerminal(): string {
        const terminalType = vscode.workspace.getConfiguration('claudeAgents')
            .get<string>('terminalType', 'wsl');

        if (hasWslpath()) {
            switch (terminalType) {
                case 'wsl':
                case 'bash':
                    // WSL/bash terminal expects Unix paths
                    return toUnixPath(this.originalPath);
                case 'powershell':
                case 'cmd':
                    // Windows terminal expects Windows paths
                    return toWindowsPath(this.originalPath);
                case 'gitbash':
                    // Git Bash uses mixed paths with forward slashes
                    return toMixedPath(this.originalPath);
                default:
                    return toUnixPath(this.originalPath);
            }
        }

        // Not in WSL - return path with normalized slashes
        if (terminalType === 'powershell' || terminalType === 'cmd') {
            return this.originalPath.replace(/\//g, '\\');
        }
        return this.originalPath.replace(/\\/g, '/');
    }

    /**
     * Get path for display to users (Windows format).
     */
    forDisplay(): string {
        if (hasWslpath()) {
            return toWindowsPath(this.originalPath);
        }
        return this.originalPath.replace(/\//g, '\\');
    }

    /**
     * Join a subpath to this path, returning a new AgentPath.
     */
    join(...parts: string[]): AgentPath {
        // Use Unix path as base for joining, then create new AgentPath
        const base = this.forNodeFs();
        const joined = [base, ...parts].join('/').replace(/\/+/g, '/');
        return new AgentPath(joined);
    }

    /**
     * Get the original path as provided.
     */
    toString(): string {
        return this.originalPath;
    }
}

/**
 * Create an AgentPath from any path format.
 */
export function agentPath(inputPath: string): AgentPath {
    return new AgentPath(inputPath);
}

/**
 * Get the home directory path appropriate for the current environment.
 * In WSL, returns the native Linux home directory.
 * On native Windows with WSL terminal type, attempts to get WSL home.
 */
export function getHomeDir(): AgentPath {
    // If wslpath is available, we're in WSL - use native home
    if (hasWslpath()) {
        return new AgentPath(os.homedir());
    }

    // On native Windows, check terminal type
    const terminalType = vscode.workspace.getConfiguration('claudeAgents')
        .get<string>('terminalType', 'wsl');

    if (terminalType === 'wsl') {
        try {
            // Get WSL home directory using wsl.exe
            const result = childProcess.execSync('wsl.exe -e sh -c "echo $HOME"', {
                encoding: 'utf-8',
                timeout: 5000,
                windowsHide: true,
            });
            const wslHome = result.trim();
            if (wslHome) {
                return new AgentPath(wslHome);
            }
        } catch {
            // Fall through to Windows home
        }
    }

    // Default to native home directory
    return new AgentPath(os.homedir());
}

// Export wslpath helpers for direct use where needed
export { hasWslpath, toWindowsPath, toUnixPath, toMixedPath };
