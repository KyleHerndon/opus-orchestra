/**
 * SettingsView - Configuration display and editing
 *
 * Shows current configuration values with ability to toggle/edit.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { VERSION_INFO } from '../../version.js';

interface SettingItem {
  key: string;
  label: string;
  value: string | number | boolean;
  type: 'boolean' | 'string' | 'number';
  description?: string;
}

// Mock settings for development
const SETTINGS: SettingItem[] = [
  {
    key: 'useTmux',
    label: 'Use Tmux',
    value: true,
    type: 'boolean',
    description: 'Enable tmux session management for persistent terminals',
  },
  {
    key: 'defaultAgentCount',
    label: 'Default Agent Count',
    value: 3,
    type: 'number',
    description: 'Number of agents to create by default',
  },
  {
    key: 'worktreeDirectory',
    label: 'Worktree Directory',
    value: '.worktrees',
    type: 'string',
    description: 'Directory for git worktrees',
  },
  {
    key: 'autoStartClaudeOnFocus',
    label: 'Auto-start Claude',
    value: true,
    type: 'boolean',
    description: 'Automatically start Claude when focusing an agent terminal',
  },
  {
    key: 'tmuxSessionPrefix',
    label: 'Tmux Session Prefix',
    value: 'opus',
    type: 'string',
    description: 'Prefix for tmux session names',
  },
  {
    key: 'diffPollingInterval',
    label: 'Diff Polling (ms)',
    value: 60000,
    type: 'number',
    description: 'How often to refresh diff statistics',
  },
  {
    key: 'isolationTier',
    label: 'Isolation Tier',
    value: 'standard',
    type: 'string',
    description: 'Container isolation level (standard, docker, gvisor)',
  },
];

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === '1') {
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(SETTINGS.length - 1, i + 1));
    } else if (key.return) {
      // Toggle boolean settings
      const setting = SETTINGS[selectedIndex];
      if (setting.type === 'boolean') {
        // In real implementation, would update config via adapter
        // For now, just visual feedback
      }
    }
  });

  const selectedSetting = SETTINGS[selectedIndex];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text bold color="blue">Settings</Text>
        <Text> </Text>
        <Text dimColor>| Configuration options</Text>
      </Box>

      {/* Settings list */}
      <Box flexDirection="column" paddingY={1}>
        {SETTINGS.map((setting, index) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            selected={index === selectedIndex}
          />
        ))}
      </Box>

      {/* Description of selected setting */}
      {selectedSetting?.description && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>ℹ {selectedSetting.description}</Text>
        </Box>
      )}

      {/* Version info */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>Build: </Text>
        <Text color="yellow">{VERSION_INFO.version}</Text>
        <Text dimColor> ({VERSION_INFO.branch}) </Text>
        <Text dimColor>| {new Date(VERSION_INFO.timestamp).toLocaleString()}</Text>
      </Box>

      {/* Footer */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text dimColor> Navigate </Text>
        <Text color="cyan">[Enter]</Text>
        <Text dimColor> Toggle </Text>
        <Text color="cyan">[1/Esc]</Text>
        <Text dimColor> Back</Text>
      </Box>
    </Box>
  );
}

interface SettingRowProps {
  setting: SettingItem;
  selected: boolean;
}

function SettingRow({ setting, selected }: SettingRowProps): React.ReactElement {
  const formatValue = (value: string | number | boolean): string => {
    if (typeof value === 'boolean') {
      return value ? 'On' : 'Off';
    }
    return String(value);
  };

  const valueColor = (): string => {
    if (typeof setting.value === 'boolean') {
      return setting.value ? 'green' : 'red';
    }
    return 'cyan';
  };

  return (
    <Box paddingX={1}>
      <Text color={selected ? 'cyan' : undefined}>
        {selected ? '> ' : '  '}
      </Text>
      <Box width={25}>
        <Text bold={selected}>{setting.label}</Text>
      </Box>
      <Text color={valueColor()}>{formatValue(setting.value)}</Text>
    </Box>
  );
}
