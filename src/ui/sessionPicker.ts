// "Resume a session" picker, shared by `lepus --resume` and in-app /resume.
import type { Summary } from '../session/store.js';
import type { AskRequest } from './askBridge.js';

/** Ask request listing sessions; `done(null)` on cancel or "new session". */
export function sessionPickerRequest(
  sessions: Summary[],
  done: (id: string | null) => void,
): AskRequest {
  const NEW = '+ Start a new session';
  const label = (s: Summary, i: number) => `${i + 1}. ${s.preview || '(empty)'}`;
  return {
    question: {
      header: 'Resume',
      question: 'Resume a session',
      options: [
        ...sessions.map((s, i) => ({
          label: label(s, i),
          description: `${relativeTime(s.updatedAt)} · ${s.id.slice(0, 8)}`,
        })),
        { label: NEW },
      ],
    },
    resolve: (picked) => {
      if (picked === NEW) return done(null);
      done(sessions[Number.parseInt(picked, 10) - 1]?.id ?? null);
    },
    reject: () => done(null),
  };
}

function relativeTime(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
