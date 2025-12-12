#!/bin/bash
# Compile and install the VS Code extension

set -e

# Get version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')

echo "Building Claude Agents extension v${VERSION}..."

# Setup Node environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20

# Package the extension
npx vsce package --allow-missing-repository

# Install to VS Code (WSL mode - uses VS Code Server in WSL)
echo "Installing to VS Code (WSL)..."
code --install-extension "$(pwd)/claude-agents-${VERSION}.vsix" --force

echo ""
echo "Done! Reload VS Code to use v${VERSION}"
