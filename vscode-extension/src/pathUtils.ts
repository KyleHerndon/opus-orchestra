import * as vscode from 'vscode';
import * as os from 'os';
import * as childProcess from 'child_process';

/**
 * Unified path handling for cross-platform compatibility.
 *
 * The extension runs on Windows Node.js but may execute commands in WSL, Git Bash, etc.
 * This class ensures paths are always converted to the correct format for each context.
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
export class AgentPath {
    private readonly originalPath: string;
    private readonly drive: string;
    private readonly restPath: string;
    private readonly isWslNative: boolean;
    private readonly wslDistro: string;

    constructor(inputPath: string) {
        this.originalPath = inputPath;
        this.isWslNative = false;
        this.wslDistro = '';

        // Parse the path to extract drive and rest
        const wslMountMatch = inputPath.match(/^\/mnt\/([a-z])\/(.*)/i);
        const gitBashMatch = inputPath.match(/^\/([a-z])\/(.*)/i);
        const windowsMatch = inputPath.match(/^([a-zA-Z]):[\\/](.*)/);
        // Match UNC paths with backslashes: \\wsl.localhost\Ubuntu\... or \\wsl$\Ubuntu\...
        const wslUncBackslashMatch = inputPath.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)/i);
        // Match UNC paths with forward slashes: //wsl.localhost/Ubuntu/... or //wsl$/Ubuntu/...
        const wslUncForwardMatch = inputPath.match(/^\/\/wsl(?:\.localhost|\$)\/([^/]+)\/(.*)/i);

        if (wslUncBackslashMatch) {
            // UNC path to WSL with backslashes: \\wsl.localhost\Ubuntu\home\user
            this.drive = '';
            this.wslDistro = wslUncBackslashMatch[1];
            this.restPath = '/' + wslUncBackslashMatch[2].replace(/\\/g, '/');
            this.isWslNative = true;
        } else if (wslUncForwardMatch) {
            // UNC path to WSL with forward slashes: //wsl.localhost/Ubuntu/home/user
            this.drive = '';
            this.wslDistro = wslUncForwardMatch[1];
            this.restPath = '/' + wslUncForwardMatch[2];
            this.isWslNative = true;
        } else if (wslMountMatch) {
            // WSL mounted Windows drive: /mnt/c/Users/...
            this.drive = wslMountMatch[1].toLowerCase();
            this.restPath = wslMountMatch[2].replace(/\\/g, '/');
        } else if (windowsMatch) {
            // Windows path: C:\Users\... or C:/Users/...
            this.drive = windowsMatch[1].toLowerCase();
            this.restPath = windowsMatch[2].replace(/\\/g, '/');
        } else if (gitBashMatch && !inputPath.startsWith('/mnt/') && gitBashMatch[1].length === 1) {
            // Git Bash path: /c/Users/...
            this.drive = gitBashMatch[1].toLowerCase();
            this.restPath = gitBashMatch[2].replace(/\\/g, '/');
        } else if (inputPath.startsWith('/') && !inputPath.startsWith('/mnt/')) {
            // WSL native path: /home/user/... (not a mounted drive)
            this.drive = '';
            this.restPath = inputPath;
            this.isWslNative = true;
            this.wslDistro = getWslDistro();
        } else {
            // Unknown format - assume it's a relative path
            this.drive = '';
            this.restPath = inputPath.replace(/\\/g, '/');
        }
    }

    /**
     * Get path for Node.js fs operations.
     * Returns appropriate format based on the platform Node.js is running on:
     * - On Windows: C:/... for Windows drives, UNC paths for WSL native paths
     * - On Linux (WSL VS Code): /mnt/c/... for Windows drives, native paths for Linux paths
     */
    forNodeFs(): string {
        const platform = os.platform();
        let result: string;

        // If running on Linux (e.g., WSL VS Code with Remote - WSL extension),
        // Node.js fs uses Linux paths
        if (platform !== 'win32') {
            if (this.isWslNative) {
                // Already a native Linux path
                result = this.restPath;
            } else if (this.drive) {
                // Windows drive letter - convert to WSL mount path
                result = `/mnt/${this.drive}/${this.restPath}`;
            } else {
                // Pure Unix path
                result = this.restPath;
            }
        } else {
            // On Windows Node.js
            if (this.isWslNative && this.wslDistro) {
                // Convert WSL native path to UNC path accessible from Windows Node.js
                // /home/user/... -> \\wsl.localhost\Ubuntu\home\user\...
                // Note: Node.js fs on Windows requires backslash UNC paths
                result = `\\\\wsl.localhost\\${this.wslDistro}${this.restPath.replace(/\//g, '\\')}`;
            } else if (!this.drive) {
                result = this.restPath;
            } else {
                result = `${this.drive.toUpperCase()}:/${this.restPath}`;
            }
        }

        return result;
    }

    /**
     * Get path for terminal commands based on the configured terminal type.
     */
    forTerminal(): string {
        const terminalType = vscode.workspace.getConfiguration('claudeAgents')
            .get<string>('terminalType', 'wsl');
        let result: string;

        // WSL native paths stay as-is for WSL terminals
        if (this.isWslNative) {
            if (terminalType === 'wsl' || terminalType === 'bash') {
                result = this.restPath;
            } else if (this.wslDistro) {
                // For Windows terminals, use UNC path
                result = `\\\\wsl.localhost\\${this.wslDistro}${this.restPath.replace(/\//g, '\\')}`;
            } else {
                result = this.restPath;
            }
        } else if (!this.drive) {
            // Unix path without drive letter (macOS/Linux) - return as-is
            result = this.restPath.startsWith('/') ? this.restPath : `/${this.restPath}`;
        } else {
            switch (terminalType) {
                case 'wsl':
                    result = `/mnt/${this.drive}/${this.restPath}`;
                    break;
                case 'gitbash':
                    result = `/${this.drive}/${this.restPath}`;
                    break;
                case 'bash':
                    // Native bash - if we have a Windows drive letter, we're likely in WSL
                    // accessing Windows files, so use WSL mount path format
                    if (this.drive) {
                        result = `/mnt/${this.drive}/${this.restPath}`;
                    } else {
                        // Pure Unix path without drive letter
                        result = this.restPath.startsWith('/') ? this.restPath : `/${this.restPath}`;
                    }
                    break;
                case 'powershell':
                case 'cmd':
                    result = `${this.drive.toUpperCase()}:\\${this.restPath.replace(/\//g, '\\')}`;
                    break;
                default:
                    result = this.forNodeFs();
                    break;
            }
        }

        return result;
    }

    /**
     * Get path for display to users (Windows format).
     */
    forDisplay(): string {
        if (!this.drive) {
            return this.restPath;
        }
        return `${this.drive.toUpperCase()}:\\${this.restPath.replace(/\//g, '\\')}`;
    }

    /**
     * Join a subpath to this path, returning a new AgentPath.
     */
    join(...parts: string[]): AgentPath {
        const base = this.forNodeFs();
        // For backslash UNC paths, use backslash separator
        const sep = base.startsWith('\\\\') ? '\\' : '/';
        let joined = [base, ...parts].join(sep);
        // Normalize separators
        if (base.startsWith('\\\\')) {
            // Backslash UNC path - normalize to backslashes, preserve leading \\
            joined = '\\\\' + joined.slice(2).replace(/[\\/]+/g, '\\');
        } else if (joined.startsWith('//')) {
            // Forward slash UNC path - preserve leading //
            joined = '//' + joined.slice(2).replace(/\/+/g, '/');
        } else {
            joined = joined.replace(/\/+/g, '/');
        }
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
 * Cached WSL distro name
 */
let cachedWslDistro: string | null = null;

/**
 * Get the default WSL distribution name.
 * Caches the result for performance.
 */
export function getWslDistro(): string {
    if (cachedWslDistro !== null) {
        return cachedWslDistro;
    }

    // Check if we're on Windows
    if (os.platform() !== 'win32') {
        cachedWslDistro = '';
        return cachedWslDistro;
    }

    try {
        // Get the default WSL distro using wsl.exe
        const result = childProcess.execSync('wsl.exe -l -q', {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
        });

        // The first line is the default distro (remove null chars from UTF-16 output)
        const lines = result.replace(/\0/g, '').trim().split('\n');
        cachedWslDistro = lines[0]?.trim() || '';
    } catch {
        // WSL not available or error
        cachedWslDistro = '';
    }

    return cachedWslDistro;
}

/**
 * Get the home directory path appropriate for the current environment.
 * - On Linux (WSL VS Code): returns the native Linux home directory
 * - On Windows with WSL terminal type: returns the WSL home directory
 * - Otherwise: returns the native home directory
 */
export function getHomeDir(): AgentPath {
    // If running on Linux (e.g., WSL VS Code), just use native home
    if (os.platform() !== 'win32') {
        return new AgentPath(os.homedir());
    }

    // On Windows, check terminal type
    const terminalType = vscode.workspace.getConfiguration('claudeAgents')
        .get<string>('terminalType', 'wsl');

    if (terminalType === 'wsl') {
        const distro = getWslDistro();
        if (distro) {
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
    }

    // Default to Windows/native home directory
    return new AgentPath(os.homedir());
}
