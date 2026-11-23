/** @jsxImportSource @opentui/react */
// OpenTUI SlashMenu — inline slash command suggestion picker (Claude Code style).
// Displays directly above the input prompt and divider line without heavy box chrome.

import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { computeMenuWindow } from '../ui/menuWindow.js';
import type { SlashItem } from '../ui/slashItems.js';
import { sliceToCells } from '../ui/terminalWidth.js';
import { theme } from '../ui/theme.js';

export interface SlashMenuProps {
  items: SlashItem[];
  selected: number;
}

const PRIMARY_COL = 26;

export function SlashMenu({ items, selected }: SlashMenuProps) {
  if (items.length === 0) return null;
  const { width: columns } = useTerminalDimensions();
  const w = computeMenuWindow(items.length, selected);
  const visible = items.slice(w.start, w.end);

  const maxPrimaryLen = Math.max(
    PRIMARY_COL,
    ...visible.map((item) => `${item.name}${item.args ? ` ${item.args}` : ''}`.length + 2),
  );
  const primaryWidth = Math.min(36, maxPrimaryLen);

  return (
    <box style={{ flexDirection: 'column', width: '100%' }}>
      {visible.map((item, idx) => {
        const absoluteIdx = w.start + idx;
        const isSelected = absoluteIdx === selected;
        const caret = isSelected ? `${theme.glyphs.caret} ` : '  ';
        const args = item.args ? ` ${item.args}` : '';
        const fullName = `${item.name}${args}`;
        const paddedName =
          fullName.length >= primaryWidth
            ? `${fullName}  `
            : fullName + ' '.repeat(primaryWidth - fullName.length);

        const descBudget = Math.max(10, columns - primaryWidth - 6);
        const secondary = item.description ? sliceToCells(item.description, descBudget, '…') : '';

        return (
          <box key={item.name} style={{ flexDirection: 'row', width: '100%', paddingX: 1 }}>
            <text
              fg={isSelected ? theme.focus : theme.text}
              attributes={isSelected ? TextAttributes.BOLD : undefined}
            >
              {caret}
              {paddedName}
            </text>
            {secondary ? (
              <text fg={theme.muted} attributes={TextAttributes.DIM} truncate>
                {secondary}
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
}
