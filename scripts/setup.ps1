# Opus Orchestra Setup Script for Windows
# PowerShell version for native Windows/Docker Desktop users
#
# Usage:
#   .\setup.ps1              # Interactive mode
#   .\setup.ps1 check        # Check what's available
#   .\setup.ps1 docker       # Set up Docker isolation

param(
    [Parameter(Position=0)]
    [ValidateSet('check', 'docker', 'help', '')]
    [string]$Command = ''
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Split-Path -Parent $ScriptDir

function Write-Status {
    param(
        [string]$Status,
        [string]$Name,
        [string]$Detail = ''
    )

    $icon = switch ($Status) {
        'ok'    { Write-Host -NoNewline "  " -ForegroundColor Green; Write-Host -NoNewline "[OK]" -ForegroundColor Green }
        'warn'  { Write-Host -NoNewline "  " -ForegroundColor Yellow; Write-Host -NoNewline "[WARN]" -ForegroundColor Yellow }
        'error' { Write-Host -NoNewline "  " -ForegroundColor Red; Write-Host -NoNewline "[FAIL]" -ForegroundColor Red }
        'info'  { Write-Host -NoNewline "  " -ForegroundColor Cyan; Write-Host -NoNewline "[INFO]" -ForegroundColor Cyan }
    }

    if ($Detail) {
        Write-Host " $Name - $Detail"
    } else {
        Write-Host " $Name"
    }
}

function Write-Header {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Blue
    Write-Host "  Opus Orchestra Setup (Windows)" -ForegroundColor Blue
    Write-Host "================================================================" -ForegroundColor Blue
    Write-Host ""
}

function Test-Docker {
    try {
        $null = Get-Command docker -ErrorAction Stop
        $info = docker info 2>&1
        if ($LASTEXITCODE -eq 0) {
            $version = (docker --version) -replace 'Docker version ', '' -replace ',.*', ''
            Write-Status 'ok' 'Docker Desktop' "v$version"
            return $true
        } else {
            Write-Status 'warn' 'Docker Desktop' 'installed but not running'
            return $false
        }
    } catch {
        Write-Status 'error' 'Docker Desktop' 'not installed'
        return $false
    }
}

function Test-WSL {
    try {
        $wslList = wsl --list --quiet 2>&1
        if ($LASTEXITCODE -eq 0 -and $wslList) {
            Write-Status 'ok' 'WSL' 'available'
            return $true
        } else {
            Write-Status 'warn' 'WSL' 'no distributions installed'
            return $false
        }
    } catch {
        Write-Status 'error' 'WSL' 'not available'
        return $false
    }
}

function Test-DockerImage {
    try {
        $images = docker images --format '{{.Repository}}:{{.Tag}}' 2>&1
        if ($images -match 'opus-orchestra-sandbox') {
            Write-Status 'ok' 'Sandbox Image' 'opus-orchestra-sandbox exists'
            return $true
        } else {
            Write-Status 'warn' 'Sandbox Image' 'not built (run: .\setup.ps1 docker)'
            return $false
        }
    } catch {
        Write-Status 'error' 'Sandbox Image' 'could not check'
        return $false
    }
}

function Invoke-CheckAll {
    Write-Host "Checking installed components..." -ForegroundColor Blue
    Write-Host ""

    Write-Host "Platform: Windows"
    Write-Host ""

    Write-Host "Prerequisites:"
    Test-WSL | Out-Null
    Write-Host ""

    Write-Host "Isolation Tiers:"
    Test-Docker | Out-Null
    Write-Status 'info' 'gVisor' 'not supported on Windows'
    Write-Status 'info' 'Cloud Hypervisor' 'not supported on Windows'
    Write-Status 'info' 'Sandbox Runtime' 'use Docker on Windows'
    Write-Host ""

    Write-Host "Docker Image:"
    if (Test-Docker) {
        Test-DockerImage | Out-Null
    }
    Write-Host ""
}

function Invoke-SetupDocker {
    Write-Host "Setting up Docker isolation..." -ForegroundColor Blue
    Write-Host ""

    # Check Docker
    if (-not (Test-Docker)) {
        Write-Host ""
        Write-Host "Docker Desktop is not installed or not running." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "To install Docker Desktop:"
        Write-Host "  1. Download from https://docker.com/products/docker-desktop"
        Write-Host "  2. Install and restart"
        Write-Host "  3. Enable WSL 2 backend in Docker Desktop settings"
        Write-Host ""
        return
    }

    # Build the sandbox image
    Write-Host ""
    Write-Host "Building sandbox image..."

    $dockerfilePath = Join-Path $ExtensionDir "docker\Dockerfile.sandbox"
    $dockerContext = Join-Path $ExtensionDir "docker"

    if (Test-Path $dockerfilePath) {
        docker build -t opus-orchestra-sandbox:latest -f $dockerfilePath $dockerContext

        if ($LASTEXITCODE -eq 0) {
            Write-Status 'ok' 'Image built' 'opus-orchestra-sandbox:latest'
        } else {
            Write-Status 'error' 'Build failed' 'check Docker output above'
            return
        }
    } else {
        Write-Status 'error' 'Dockerfile not found' $dockerfilePath
        return
    }

    Write-Host ""
    Write-Host "Docker isolation setup complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now use 'docker' isolation tier in Opus Orchestra."
    Write-Host "Set claudeAgents.isolationTier to 'docker' in VS Code settings."
}

function Invoke-InteractiveMode {
    Write-Header
    Invoke-CheckAll

    Write-Host ""
    Write-Host "What would you like to set up?"
    Write-Host ""
    Write-Host "  1) Docker isolation (recommended for Windows)"
    Write-Host "  2) Exit"
    Write-Host ""

    $choice = Read-Host "Select option [1-2]"

    switch ($choice) {
        '1' { Invoke-SetupDocker }
        '2' { Write-Host "Exiting."; exit 0 }
        default { Write-Host "Invalid option" -ForegroundColor Red; exit 1 }
    }
}

function Show-Help {
    Write-Host "Opus Orchestra Setup Script (Windows)"
    Write-Host ""
    Write-Host "Usage: .\setup.ps1 [command]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  check    Check what's available"
    Write-Host "  docker   Set up Docker isolation"
    Write-Host "  help     Show this help message"
    Write-Host ""
    Write-Host "Run without arguments for interactive mode."
    Write-Host ""
    Write-Host "Note: On Windows, Docker Desktop is the recommended isolation method."
    Write-Host "      gVisor and Cloud Hypervisor are only available on Linux."
}

# Main
switch ($Command) {
    'check' {
        Write-Header
        Invoke-CheckAll
    }
    'docker' {
        Invoke-SetupDocker
    }
    'help' {
        Show-Help
    }
    '' {
        Invoke-InteractiveMode
    }
}
