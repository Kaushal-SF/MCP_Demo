import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DevflowError } from '../lib/errors.js';

export interface ChecklistSummary {
  /** File name without `.md`; also the `{name}` in devflow://checklists/{name}. */
  name: string;
  title: string;
  description: string;
}

export interface Checklist extends ChecklistSummary {
  /** Full Markdown text of the file. */
  content: string;
}

/**
 * Only lowercase letters, digits and dashes. This is a security boundary, not style: the name
 * comes from a URI the client controls, and it becomes part of a file path, so anything like
 * "../" must be impossible.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Documentation for checklist authors, not a checklist itself. */
const IGNORED_FILES = new Set(['README.md']);

/**
 * Reads review checklists from a folder of Markdown files.
 *
 * File format: `# Title` on the first line, then a `> one-line description`, then the items.
 * Files are read on every call (they are tiny), so a team can edit checklists without restarting
 * the server.
 */
export class ChecklistStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<ChecklistSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      // A missing folder means "no checklists configured", not a server failure.
      return [];
    }
    const names = entries
      .filter((file) => file.endsWith('.md') && !IGNORED_FILES.has(file))
      .map((file) => file.slice(0, -3))
      .filter((name) => NAME_PATTERN.test(name))
      .sort();
    const checklists = await Promise.all(names.map((name) => this.read(name)));
    return checklists.map(({ name, title, description }) => ({ name, title, description }));
  }

  async read(name: string): Promise<Checklist> {
    if (!NAME_PATTERN.test(name)) {
      throw new DevflowError(
        'INVALID_INPUT',
        `"${name}" is not a valid checklist name. Use lowercase letters, digits and dashes.`,
      );
    }
    let content: string;
    try {
      content = await readFile(join(this.dir, `${name}.md`), 'utf8');
    } catch {
      const available = (await this.list()).map((checklist) => checklist.name);
      throw new DevflowError(
        'NOT_FOUND',
        `No checklist named "${name}". Available: ${available.join(', ') || 'none'}.`,
      );
    }
    return { name, ...parseHeader(content, name), content };
  }
}

function parseHeader(
  content: string,
  fallbackTitle: string,
): { title: string; description: string } {
  const lines = content.split('\n').map((line) => line.trim());
  const title =
    lines
      .find((line) => line.startsWith('# '))
      ?.slice(2)
      .trim() ?? fallbackTitle;
  const description =
    lines
      .find((line) => line.startsWith('> '))
      ?.slice(2)
      .trim() ?? '';
  return { title, description };
}
