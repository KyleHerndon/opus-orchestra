#!/bin/bash
# Install git hooks for the project
# Run this once after cloning the repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "Installing git hooks..."

# Create pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash
# Pre-commit hook: Run linter on vscode-extension

# Only run if there are staged changes in vscode-extension
if git diff --cached --name-only | grep -q "^vscode-extension/"; then
    echo "Running ESLint on vscode-extension..."
    cd vscode-extension

    # Run lint
    if ! npm run lint; then
        echo ""
        echo "ESLint found issues. Please fix them before committing."
        echo "You can run 'npm run lint' in vscode-extension/ to see all issues."
        exit 1
    fi

    echo "ESLint passed!"
fi

exit 0
EOF

chmod +x "$HOOKS_DIR/pre-commit"

echo "✓ Pre-commit hook installed"
echo ""
echo "Hooks installed successfully!"
