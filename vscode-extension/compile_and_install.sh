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

# Try to install - handle both WSL VS Code Server and Windows VS Code
echo "Installing to VS Code..."

install_success=false

# Try WSL VS Code Server first
if command -v code &> /dev/null; then
    if code --install-extension "$VSIX_FILE" --force 2>/dev/null; then
        install_success=true
        echo "Installed via VS Code Server (WSL)"
    fi
fi

# If that failed, try Windows VS Code directly
if [ "$install_success" = false ]; then
    # Find Windows VS Code
    WIN_CODE=""
    for path in "/mnt/c/Program Files/Microsoft VS Code/bin/code" \
                "/mnt/c/Users/$USER/AppData/Local/Programs/Microsoft VS Code/bin/code"; do
        if [ -f "$path" ]; then
            WIN_CODE="$path"
            break
        fi
    done

    if [ -n "$WIN_CODE" ]; then
        # Convert WSL path to Windows path
        WIN_VSIX=$(echo "$VSIX_FILE" | sed 's|^/mnt/\([a-z]\)/|\1:/|' | sed 's|/|\\|g')
        if "$WIN_CODE" --install-extension "$WIN_VSIX" --force 2>/dev/null; then
            install_success=true
            echo "Installed via Windows VS Code"
        fi
    fi
fi

# Last resort: just tell user where the file is
if [ "$install_success" = false ]; then
    echo ""
    echo "Could not auto-install. Please install manually:"
    echo "  1. Open VS Code"
    echo "  2. Press Ctrl+Shift+P -> 'Extensions: Install from VSIX'"
    echo "  3. Select: $VSIX_FILE"
fi

echo ""
echo "Done! Reload VS Code to use v${VERSION}"
