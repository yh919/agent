/** @jsxImportSource @opentui/react */
// OpenTUI MentionMenu — inline @file picker (Claude Code style).
// Displays directly above the input prompt without heavy box chrome.

import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import type { MentionCandidate } from '../agent/mentions.js';
import { computeMenuWindow } from '../ui/menuWindow.js';
import { sliceToCells } from '../ui/terminalWidth.js';
import { theme } from '../ui/theme.js';

export interface MentionMenuProps {
  cwd: string;
  candidates: MentionCandidate[];
  selected: number;
}

export function MentionMenu({ candidates, selected }: MentionMenuProps) {
  if (candidates.length === 0) return null;
  const { width: columns } = useTerminalDimensions();
  const w = computeMenuWindow(candidates.length, selected);
  const visible = candidates.slice(w.start, w.end);

  return (
    <box style={{ flexDirection: 'column', width: '100%' }}>
      {visible.map((c, idx) => {
        const absoluteIdx = w.start + idx;
        const isSelected = absoluteIdx === selected;
        const caret = isSelected ? `${theme.glyphs.caret} ` : '  ';
        const icon = c.isDir ? `${theme.glyphs.dir} ` : `${theme.glyphs.file} `;
        const maxBudget = Math.max(10, columns - 6);
        const label = sliceToCells(c.display, maxBudget, '…');

        return (
          <box key={c.insert} style={{ flexDirection: 'row', width: '100%', paddingX: 1 }}>
            <text
              fg={isSelected ? theme.focus : theme.text}
              attributes={isSelected ? TextAttributes.BOLD : undefined}
              truncate
            >
              {caret}
              {icon}
              {label}
            </text>
          </box>
        );
      })}
    </box>
  );
}
