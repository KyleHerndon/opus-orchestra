#!/bin/bash
# Auto-fix console.log → log.debug in staged TypeScript files
# Run before lint-staged to convert console statements

set -e

# Get staged .ts/.tsx files (excluding test files and specific directories)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v 'consoleOverride\.ts' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FIXED_FILES=()

for FILE in $STAGED_FILES; do
  if [ ! -f "$FILE" ]; then
    continue
  fi

  # Check if file has console.log/warn/error (not in comments)
  if grep -qE '^\s*console\.(log|warn|error|debug|info)\(' "$FILE"; then
    # Check if it's in packages/terminal CLI files (should use print, not log)
    if [[ "$FILE" == packages/terminal/src/cli.ts ]] || [[ "$FILE" == packages/terminal/src/adapters/* ]]; then
      # These files should use print() for user output - skip auto-fix, let lint catch it
      continue
    fi

    # Replace console.X with log.X
    sed -i 's/console\.log(/log.debug(/g' "$FILE"
    sed -i 's/console\.debug(/log.debug(/g' "$FILE"
    sed -i 's/console\.info(/log.info(/g' "$FILE"
    sed -i 's/console\.warn(/log.warn(/g' "$FILE"
    sed -i 's/console\.error(/log.error(/g' "$FILE"

    # Check if log import already exists
    if ! grep -qE "^import.*\blog\b.*from '@opus-orchestra/core'" "$FILE" && \
       ! grep -qE "^import.*\blog\b.*from '\.\./.*log'" "$FILE" && \
       ! grep -qE "^import.*\blog\b.*from '\./log'" "$FILE"; then

      # Determine the right import path based on package
      if [[ "$FILE" == packages/core/* ]]; then
        # Within core, use relative import
        IMPORT_STMT="import { log } from '../utils/log';"
        # Adjust path depth
        DEPTH=$(echo "$FILE" | tr -cd '/' | wc -c)
        if [ "$DEPTH" -gt 3 ]; then
          IMPORT_STMT="import { log } from '../../utils/log';"
        fi
      else
        # Other packages import from @opus-orchestra/core
        IMPORT_STMT="import { log } from '@opus-orchestra/core';"
      fi

      # Add import after the last existing import line
      # Find the line number of the last import statement
      LAST_IMPORT_LINE=$(grep -n "^import " "$FILE" | tail -1 | cut -d: -f1)

      if [ -n "$LAST_IMPORT_LINE" ]; then
        sed -i "${LAST_IMPORT_LINE}a\\${IMPORT_STMT}" "$FILE"
      else
        # No imports exist, add at the top after any comments/shebang
        sed -i "1i\\${IMPORT_STMT}" "$FILE"
      fi
    fi

    FIXED_FILES+=("$FILE")
    git add "$FILE"
  fi
done

if [ ${#FIXED_FILES[@]} -gt 0 ]; then
  echo "Auto-fixed console.log → log.debug in: ${FIXED_FILES[*]}"
fi
