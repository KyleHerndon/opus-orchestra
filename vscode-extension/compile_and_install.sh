#!/bin/bash
# Compile and install the VS Code extension

set -e

# Get version and name from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
NAME=$(grep '"name"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')

echo "Building Claude Agents extension v${VERSION}..."

# Setup Node environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20

# Package the extension
npx vsce package --allow-missing-repository

VSIX_FILE="$(pwd)/${NAME}-${VERSION}.vsix"

# Remove old versions to force clean update
echo "Removing old extension versions..."
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
echo "Extracting extension..."
unzip -o "$VSIX_FILE" -d /tmp/vsix-extract > /dev/null

# Install to WSL VS Code Server (for Remote - WSL users)
if [ -d ~/.vscode-server ]; then
    echo "Installing to VS Code Server (WSL)..."
    EXT_DIR=~/.vscode-server/extensions/${EXT_ID}-${VERSION}
    mkdir -p "$EXT_DIR"
    cp -r /tmp/vsix-extract/extension/* "$EXT_DIR/"
    echo "  Installed to: $EXT_DIR"
fi

# Install to Windows VS Code (for native Windows users)
WIN_EXT_DIR="/mnt/c/Users/$USER/.vscode/extensions/${EXT_ID}-${VERSION}"
if [ -d "/mnt/c/Users/$USER/.vscode/extensions" ]; then
    echo "Installing to Windows VS Code..."
    mkdir -p "$WIN_EXT_DIR"
    cp -r /tmp/vsix-extract/extension/* "$WIN_EXT_DIR/"
    echo "  Installed to: $WIN_EXT_DIR"
fi

rm -rf /tmp/vsix-extract

echo ""
echo "Done! Reload VS Code to use v${VERSION}"
