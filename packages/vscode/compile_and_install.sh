#!/bin/bash
# Compile and install the VS Code extension
# Works with monorepo structure - builds core first, then vscode

set -e

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VSCODE_DIR="$SCRIPT_DIR"
CORE_DIR="$MONOREPO_ROOT/packages/core"

# Get version and name from package.json
VERSION=$(grep '"version"' "$VSCODE_DIR/package.json" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
NAME=$(grep '"name"' "$VSCODE_DIR/package.json" | head -1 | sed 's/.*: "\(.*\)".*/\1/')

echo "Building Claude Agents extension v${VERSION}..."
echo "  Monorepo root: $MONOREPO_ROOT"

# Setup Node environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20

# Check if esbuild has correct platform binaries (WSL/Linux vs Windows mismatch)
# This happens when node_modules is shared between Windows and WSL
if [ -d "$MONOREPO_ROOT/node_modules/esbuild" ]; then
    cd "$MONOREPO_ROOT"
    # Try to actually run esbuild - require() alone doesn't detect platform mismatch
    if ! node -e "require('esbuild').buildSync({stdin:{contents:''},write:false})" 2>/dev/null; then
        echo ""
        echo "Detected esbuild platform mismatch (Windows binaries in WSL)"
        echo "Reinstalling npm packages for Linux..."
        rm -rf node_modules packages/*/node_modules
        npm install
        echo "  npm packages reinstalled"
    fi
fi

# Step 1: Build core package first (vscode depends on it for type-checking and bundling)
echo ""
echo "Step 1: Building @opus-orchestra/core..."
cd "$CORE_DIR"
npm run build
echo "  Core package built successfully"

# Step 2: Package the VS Code extension
# vsce runs vscode:prepublish which runs: check-types + esbuild
# esbuild bundles @opus-orchestra/core into extension.js
echo ""
echo "Step 2: Packaging VS Code extension..."
cd "$VSCODE_DIR"
npx vsce package --no-dependencies --allow-missing-repository

VSIX_FILE="$(pwd)/${NAME}-${VERSION}.vsix"

# Remove old versions to force clean update
echo ""
echo "Step 3: Removing old extension versions..."
PUBLISHER=$(grep '"publisher"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
EXT_ID="${PUBLISHER}.${NAME}"

# Remove from WSL VS Code Server extensions
for old_ext in ~/.vscode-server/extensions/${EXT_ID}-*; do
    if [ -d "$old_ext" ]; then
        echo "  Removing: $old_ext"
        rm -rf "$old_ext"
    fi
done

# Remove from Windows VS Code extensions
for old_ext in /mnt/c/Users/$USER/.vscode/extensions/${EXT_ID}-*; do
    if [ -d "$old_ext" ]; then
        echo "  Removing: $old_ext"
        rm -rf "$old_ext"
    fi
done

# Extract VSIX once for direct installation
echo ""
echo "Step 4: Installing extension..."
unzip -o "$VSIX_FILE" -d /tmp/vsix-extract > /dev/null

# Install to WSL VS Code Server (for Remote - WSL users)
if [ -d ~/.vscode-server ]; then
    echo "  Installing to VS Code Server (WSL)..."
    EXT_DIR=~/.vscode-server/extensions/${EXT_ID}-${VERSION}
    mkdir -p "$EXT_DIR"
    cp -r /tmp/vsix-extract/extension/* "$EXT_DIR/"
    echo "    Installed to: $EXT_DIR"
fi

# Install to Windows VS Code (for native Windows users)
WIN_EXT_DIR="/mnt/c/Users/$USER/.vscode/extensions/${EXT_ID}-${VERSION}"
if [ -d "/mnt/c/Users/$USER/.vscode/extensions" ]; then
    echo "  Installing to Windows VS Code..."
    mkdir -p "$WIN_EXT_DIR"
    cp -r /tmp/vsix-extract/extension/* "$WIN_EXT_DIR/"
    echo "    Installed to: $WIN_EXT_DIR"
fi

rm -rf /tmp/vsix-extract

echo ""
echo "Done! Reload VS Code to use v${VERSION}"
