// Input autocomplete and ghost-text suggestion engine.
// Provides tab-completion and inline suggestions for slash commands,
// subcommand arguments, session names, prompt history, and security workflows.

import { SLASH_ITEMS, type SlashItem } from './slashItems.js';

export interface AutocompleteContext {
  history?: string[];
  skills?: Array<{ name: string; description?: string }>;
  sessionNames?: string[];
}

export interface AutocompleteSuggestion {
  /** The ghost text to display right after the cursor */
  ghostText: string;
  /** The complete replacement text when accepted */
  fullValue: string;
}

const COMMAND_ARG_OPTIONS: Record<string, string[]> = {
  '/mode': ['auto-safe', 'ask', 'plan', 'act', 'yolo'],
  '/report': ['html', 'markdown', 'sarif'],
  '/session': ['rename ', 'info', 'list'],
  '/skills': ['enable ', 'disable ', 'new '],
  '/effort': ['high', 'medium', 'low', 'xhigh', 'max', 'default'],
  '/thinking': ['on', 'off'],
  '/yolo': ['on', 'off'],
  '/memory': ['add ', 'list', 'forget ', 'clear', 'provider'],
  '/scope': ['add ', 'list', 'deny ', 'remove ', 'clear'],
  '/config': ['show', 'path', 'example'],
  '/target': ['http://localhost:', 'https://'],
};

const PROMPT_TEMPLATES: string[] = [
  'recon subdomains and open ports',
  'test for owasp top 10 vulnerabilities',
  'scan target for web vulnerabilities',
  'check for file upload bypasses (Upload2Shell)',
  'analyze application attack surface and endpoints',
  'find exposed credentials, secrets, and API routes',
  'test for IDOR and broken access control',
  'test for SQL and command injection',
  'check for Spring Boot actuator exposure',
  'check for WordPress user enumeration and vulnerabilities',
  'test for SSRF and cloud metadata access',
];

/**
 * Compute inline ghost-text autocomplete for the active user prompt.
 * Only triggers when cursor is at the very end of the input.
 */
export function computeAutocomplete(
  inputValue: string,
  cursor: number,
  ctx?: AutocompleteContext,
): AutocompleteSuggestion | null {
  if (cursor !== inputValue.length || inputValue.length === 0) {
    return null;
  }

  // 1. Slash commands & arguments
  if (inputValue.startsWith('/')) {
    // 1a. Argument completion after command, e.g. "/mode auto" or "/report "
    const spaceIdx = inputValue.indexOf(' ');
    if (spaceIdx > 0) {
      const cmd = inputValue.slice(0, spaceIdx).toLowerCase();
      const argPrefix = inputValue.slice(spaceIdx + 1);

      // Special case: /session rename <name>
      if (cmd === '/session' && argPrefix.startsWith('rename ')) {
        const namePrefix = argPrefix.slice('rename '.length).toLowerCase();
        for (const name of ctx?.sessionNames ?? []) {
          if (name.toLowerCase().startsWith(namePrefix) && name.length > namePrefix.length) {
            const ghostText = name.slice(namePrefix.length);
            return {
              ghostText,
              fullValue: `${cmd} rename ${name}`,
            };
          }
        }
      }

      // Special case: /rename <name>
      if (cmd === '/rename' && ctx?.sessionNames?.length) {
        const namePrefix = argPrefix.toLowerCase();
        for (const name of ctx.sessionNames) {
          if (name.toLowerCase().startsWith(namePrefix) && name.length > namePrefix.length) {
            const ghostText = name.slice(namePrefix.length);
            return {
              ghostText,
              fullValue: `${cmd} ${name}`,
            };
          }
        }
      }

      const options = COMMAND_ARG_OPTIONS[cmd];
      if (options) {
        const match = options.find((opt) =>
          opt.toLowerCase().startsWith(argPrefix.toLowerCase()),
        );
        if (match && match.length > argPrefix.length) {
          const ghostText = match.slice(argPrefix.length);
          return {
            ghostText,
            fullValue: `${inputValue}${ghostText}`,
          };
        }
      }
      return null;
    }

    // 1b. Command name completion, e.g. "/rep" -> "/report "
    const typed = inputValue.toLowerCase();
    const allItems: Array<{ name: string; args?: string }> = [
      ...SLASH_ITEMS,
      ...(ctx?.skills?.map((s) => ({ name: s.name.startsWith('/') ? s.name : `/${s.name}` })) ?? []),
    ];

    for (const item of allItems) {
      const name = item.name.toLowerCase();
      if (name.startsWith(typed) && name.length > typed.length) {
        const targetName = item.name;
        const completion = item.args ? `${targetName} ` : targetName;
        const ghostText = completion.slice(inputValue.length);
        return {
          ghostText,
          fullValue: completion,
        };
      }
    }

    // If typed exactly matches command name with args, suggest trailing space
    const exact = allItems.find((item) => item.name.toLowerCase() === typed);
    if (exact && exact.args && !inputValue.endsWith(' ')) {
      return {
        ghostText: ' ',
        fullValue: `${exact.name} `,
      };
    }

    return null;
  }

  // 2. Prompt history (most recent first)
  const history = ctx?.history ?? [];
  const lowerInput = inputValue.toLowerCase();
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item && item.toLowerCase().startsWith(lowerInput) && item.length > inputValue.length) {
      const ghostText = item.slice(inputValue.length);
      return {
        ghostText,
        fullValue: `${inputValue}${ghostText}`,
      };
    }
  }

  // 3. Security prompt templates
  for (const template of PROMPT_TEMPLATES) {
    if (template.toLowerCase().startsWith(lowerInput) && template.length > inputValue.length) {
      const ghostText = template.slice(inputValue.length);
      return {
        ghostText,
        fullValue: `${inputValue}${ghostText}`,
      };
    }
  }

  return null;
}

