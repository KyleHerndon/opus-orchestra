/**
 * Root application component
 *
 * Manages view routing, agent state, and keyboard navigation.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { AgentListView } from './views/AgentListView.js';
import { DiffView } from './views/DiffView.js';
import { SettingsView } from './views/SettingsView.js';
import { HelpBar } from './HelpBar.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { CreateAgentDialog } from './CreateAgentDialog.js';
import { useAgents } from '../hooks/useAgents.js';
import type { ViewType } from '../types.js';

type DialogType = 'none' | 'delete' | 'create';

export interface AppProps {
  /** Callback when user wants to focus an agent's tmux session */
  onFocusAgent?: (agentName: string) => void;
}

export function App({ onFocusAgent }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Agent state from hook
  const {
    agents,
    stats,
    loading,
    error,
    approveAgent,
    rejectAgent,
    deleteAgent,
    createAgents,
    focusAgent,
  } = useAgents();

  // View state
  const [view, setView] = useState<ViewType>('agents');

  // Selection state - use ID instead of index to handle deletions correctly
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Dialog state
  const [dialog, setDialog] = useState<DialogType>('none');

  // Derive selected agent and index from ID
  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const selectedIndex = selectedAgent ? agents.findIndex((a) => a.id === selectedAgent.id) : 0;

  // Navigation helpers - update ID, not index
  const selectNext = useCallback(() => {
    const currentIdx = agents.findIndex((a) => a.id === selectedId);
    if (currentIdx === -1) {return;} // Selected agent not found, do nothing
    const nextIdx = Math.min(currentIdx + 1, agents.length - 1);
    if (agents[nextIdx]) {
      setSelectedId(agents[nextIdx].id);
    }
  }, [agents, selectedId]);

  const selectPrev = useCallback(() => {
    const currentIdx = agents.findIndex((a) => a.id === selectedId);
    if (currentIdx === -1) {return;} // Selected agent not found, do nothing
    const prevIdx = Math.max(currentIdx - 1, 0);
    if (agents[prevIdx]) {
      setSelectedId(agents[prevIdx].id);
    }
  }, [agents, selectedId]);

  const toggleExpand = useCallback(() => {
    if (!selectedAgent) {return;}

    setExpandedIds((ids) => {
      const newIds = new Set(ids);
      if (newIds.has(selectedAgent.id)) {
        newIds.delete(selectedAgent.id);
      } else {
        newIds.add(selectedAgent.id);
      }
      return newIds;
    });
  }, [selectedAgent]);

  const toggleExpandAll = useCallback(() => {
    setExpandedIds((ids) => {
      if (ids.size === agents.length) {
        return new Set();
      } else {
        return new Set(agents.map((a) => a.id));
      }
    });
  }, [agents]);

  // Action handlers
  const handleApprove = useCallback(() => {
    if (selectedAgent?.pendingApproval) {
      approveAgent(selectedAgent.id);
    }
  }, [selectedAgent, approveAgent]);

  const handleReject = useCallback(() => {
    if (selectedAgent?.pendingApproval) {
      rejectAgent(selectedAgent.id);
    }
  }, [selectedAgent, rejectAgent]);

  const handleFocus = useCallback(() => {
    if (selectedAgent) {
      if (onFocusAgent) {
        // Use callback to let CLI handle tmux attachment
        onFocusAgent(selectedAgent.name);
        exit();
      } else {
        // Fallback to direct focus (won't return to dashboard)
        focusAgent(selectedAgent.id);
      }
    }
  }, [selectedAgent, focusAgent, onFocusAgent, exit]);

  const handleDeleteConfirm = useCallback(() => {
    if (selectedAgent) {
      deleteAgent(selectedAgent.id);
    }
    setDialog('none');
  }, [selectedAgent, deleteAgent]);

  const handleCreateConfirm = useCallback((count: number) => {
    createAgents(count);
    setDialog('none');
  }, [createAgents]);

  // Handle keyboard input
  useInput((input, key) => {
    // If dialog is open, don't process other input
    if (dialog !== 'none') {
      return;
    }

    // Global: Quit
    if (input === 'q') {
      exit();
      return;
    }

    // Global: Help toggle
    if (input === '?') {
      setView((v) => (v === 'help' ? 'agents' : 'help'));
      return;
    }

    // View switching
    if (input === '1' || key.escape) {
      setView('agents');
      return;
    }
    if (input === '2' || (input === 'd' && view === 'agents')) {
      setView('diff');
      return;
    }
    if (input === '3' || input === 's') {
      setView('settings');
      return;
    }

    // Agent list navigation (only in agents view)
    if (view === 'agents') {
      if (key.upArrow) {
        selectPrev();
      } else if (key.downArrow) {
        selectNext();
      } else if (input === 'e') {
        toggleExpand();
      } else if (input === 'E') {
        toggleExpandAll();
      } else if (key.return) {
        handleFocus();
      } else if (input === 'c') {
        setDialog('create');
      } else if (input === 'x') {
        if (selectedAgent) {
          setDialog('delete');
        }
      } else if (input === 'a') {
        handleApprove();
      } else if (input === 'r') {
        handleReject();
      }
    }
  });

  // Handle selection when agents change
  useEffect(() => {
    if (agents.length === 0) {
      setSelectedId(null);
      return;
    }

    // If no selection or selected agent was deleted, select first agent
    if (selectedId === null || !agents.find((a) => a.id === selectedId)) {
      setSelectedId(agents[0].id);
    }
  }, [agents, selectedId]);

  // Show error if any
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Dialog overlay */}
      {dialog === 'delete' && selectedAgent && (
        <ConfirmDialog
          message={`Delete agent "${selectedAgent.name}"? This will remove the worktree and all changes.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDialog('none')}
        />
      )}

      {dialog === 'create' && (
        <CreateAgentDialog
          onConfirm={handleCreateConfirm}
          onCancel={() => setDialog('none')}
        />
      )}

      {/* Main content area (hidden when dialog is open) */}
      {dialog === 'none' && (
        <>
          <Box flexDirection="column" minHeight={10}>
            {view === 'agents' && (
              <AgentListView
                agents={agents}
                stats={stats}
                selectedIndex={selectedIndex}
                expandedIds={expandedIds}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            )}
            {view === 'diff' && (
              <DiffView
                agent={selectedAgent ?? undefined}
                onBack={() => setView('agents')}
              />
            )}
            {view === 'settings' && (
              <SettingsView onBack={() => setView('agents')} />
            )}
            {view === 'help' && <HelpView />}
          </Box>

          {/* Loading indicator */}
          {loading && (
            <Box>
              <Text color="cyan">Loading...</Text>
            </Box>
          )}

          {/* Help bar */}
          <HelpBar view={view} />
        </>
      )}
    </Box>
  );
}

function HelpView(): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="yellow" bold>Keyboard Shortcuts</Text>
      <Text> </Text>
      <Box flexDirection="column">
        <Text><Text color="cyan" bold>Navigation</Text></Text>
        <Text>  <Text color="cyan">↑/↓</Text>     Navigate between agents</Text>
        <Text>  <Text color="cyan">Enter</Text>   Focus selected agent (attach tmux)</Text>
        <Text>  <Text color="cyan">e</Text>       Expand/collapse selected agent</Text>
        <Text>  <Text color="cyan">E</Text>       Expand/collapse all agents</Text>
        <Text> </Text>
        <Text><Text color="cyan" bold>Actions</Text></Text>
        <Text>  <Text color="cyan">a</Text>       Approve pending action</Text>
        <Text>  <Text color="cyan">r</Text>       Reject pending action</Text>
        <Text>  <Text color="cyan">c</Text>       Create new agent</Text>
        <Text>  <Text color="cyan">x</Text>       Delete selected agent</Text>
        <Text> </Text>
        <Text><Text color="cyan" bold>Views</Text></Text>
        <Text>  <Text color="cyan">d</Text> / <Text color="cyan">2</Text>   Switch to diff view</Text>
        <Text>  <Text color="cyan">s</Text> / <Text color="cyan">3</Text>   Switch to settings view</Text>
        <Text>  <Text color="cyan">1</Text> / <Text color="cyan">Esc</Text> Return to agent list</Text>
        <Text>  <Text color="cyan">?</Text>       Toggle this help</Text>
        <Text>  <Text color="cyan">q</Text>       Quit</Text>
      </Box>
    </Box>
  );
}
