import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  LoggingMessageNotificationSchema,
  type CallToolResult,
  type LoggingMessageNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import { McpLogBridge } from '../../src/lib/mcp-log-bridge.js';
import { findPackageRoot } from '../../src/lib/package-root.js';
import { createServer } from '../../src/server.js';
import { ChecklistStore } from '../../src/services/checklists.js';
import { ReviewQueueSuggestions } from '../../src/services/suggestions.js';
import {
  FakeGitHubClient,
  makeFile,
  makePr,
  makeReviewItem,
  makeSearchItem,
} from '../helpers/fixtures.js';

const CHECKLISTS_DIR = join(findPackageRoot(import.meta.url), 'checklists');

/**
 * End-to-end over the real MCP protocol: a real SDK Client talks to our server through an
 * in-memory transport. This checks registration, schemas, annotations, output validation and
 * error reporting exactly as an MCP host would see them.
 */
describe('DevFlow MCP server (in-memory)', () => {
  let github: FakeGitHubClient;
  let client: Client;
  let logger: Logger;
  let logs: LoggingMessageNotification['params'][];

  beforeEach(async () => {
    github = new FakeGitHubClient().addPr(makePr({ body: 'x'.repeat(5000) + '\nFixes #12' }), [
      { ...makeFile('src/auth/login.ts', 80), patch: '@@ -1 +1 @@\n+login()' },
    ]);
    github.reviewRequests = { totalCount: 1, items: [makeReviewItem(42, '2026-10-01T00:00:00Z')] };

    // Same wiring as index.ts, with the stderr copy of logs discarded.
    const bridge = new McpLogBridge();
    logger = createLogger('debug', bridge.sink, { write: () => undefined });
    const server = createServer({
      github,
      logger,
      checklists: new ChecklistStore(CHECKLISTS_DIR),
      suggestions: new ReviewQueueSuggestions(github, logger),
      extraSensitivePaths: [],
    });
    bridge.attach(server);

    logs = [];
    client = new Client({ name: 'test-client', version: '1.0.0' });
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      logs.push(notification.params);
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    // Behave like a real host: list tools first. The SDK client only validates structuredContent
    // (strictly, additionalProperties: false) for tools it has listed, and that strict check is
    // what caught an extra-fields bug the server-side zod check let through (PROGRESS M2).
    await client.listTools();
  });

  afterEach(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;

  it('advertises server identity, instructions and capabilities', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'devflow-mcp', title: 'DevFlow MCP' });
    expect(client.getInstructions()).toContain('untrusted');
    expect(client.getServerCapabilities()).toMatchObject({
      tools: {},
      resources: {},
      prompts: {},
      completions: {},
      logging: {},
    });
  });

  it('lists all tools with schemas and read-only annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'get_pr_context',
      'analyze_pr_risk',
      'get_pr_diff',
      'list_review_queue',
      'get_my_activity',
      'generate_release_notes',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(50);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    }
  });

  it('get_pr_context returns validated structured content and a JSON text block', async () => {
    const result = await call('get_pr_context', { pr: 'https://github.com/acme/web/pull/42' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      pr: { body: string; bodyTruncated: boolean };
      linkedIssues: string[];
      files: unknown[];
    };
    expect(structured.pr.bodyTruncated).toBe(true);
    expect(structured.pr.body).toHaveLength(4000);
    expect(structured.files).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(structured);
  });

  it('analyze_pr_risk flags the sensitive, untested change', async () => {
    const result = await call('analyze_pr_risk', { pr: 'acme/web#42' });
    const { risk } = result.structuredContent as {
      risk: { level: string; signals: { id: string }[] };
    };
    expect(risk.signals.map((signal) => signal.id)).toEqual(['NO_TEST_CHANGES', 'SENSITIVE_PATHS']);
    expect(risk.level).toBe('medium');
  });

  it('list_review_queue returns the queue for the authenticated user', async () => {
    const result = await call('list_review_queue', { limit: 5 });
    expect(result.structuredContent).toMatchObject({
      reviewer: 'reviewer1',
      totalCount: 1,
      items: [{ ref: { number: 42 }, size: { label: 'M' } }],
    });
  });

  it('reports bad input as a tool error the model can act on', async () => {
    const result = await call('get_pr_context', { pr: 'not a pr' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('[INVALID_INPUT]'),
    });
  });

  it('reports upstream failures as tool errors, not protocol errors', async () => {
    const result = await call('get_pr_context', { pr: 'acme/web#999' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('[NOT_FOUND]') });
  });

  it('hides unexpected internal errors behind a generic message', async () => {
    github.getPullRequest = () => Promise.reject(new TypeError('secret internal detail'));
    const result = await call('get_pr_context', { pr: 'acme/web#42' });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[INTERNAL]');
    expect(text).not.toContain('secret internal detail');
  });

  it('rejects arguments that violate the input schema', async () => {
    const result = await call('get_pr_context', { pr: 'acme/web#42', maxFiles: 9999 });
    expect(result.isError).toBe(true);
  });
  it('strips undeclared fields so strict clients accept the result (regression, M2)', async () => {
    const pr = makePr();
    github.getPullRequest = () => Promise.resolve({ ...pr, internalOnly: 'should not leak' });
    const result = await call('get_pr_context', { pr: 'acme/web#42' });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).not.toContain('internalOnly');
  });

  it('turns a result that breaks its own schema into an [INTERNAL] error', async () => {
    const broken: Partial<ReturnType<typeof makePr>> = makePr();
    delete broken.title;
    github.getPullRequest = () => Promise.resolve(broken as ReturnType<typeof makePr>);
    const result = await call('get_pr_context', { pr: 'acme/web#42' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('[INTERNAL]') });
  });

  // --- M2: new tools ------------------------------------------------------------

  it('get_pr_diff returns budgeted patches', async () => {
    const result = await call('get_pr_diff', { pr: 'acme/web#42', paths: ['src/**'] });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      pr: { owner: 'acme', repo: 'web', number: 42 },
      files: [{ path: 'src/auth/login.ts', patch: '@@ -1 +1 @@\n+login()', patchTruncated: false }],
      unmatchedPaths: [],
    });
  });

  it('get_my_activity and generate_release_notes return validated structured content', async () => {
    github.prSearch = () => ({ totalCount: 1, items: [makeSearchItem(5, { title: 'feat: x' })] });

    const activity = await call('get_my_activity', { days: 2 });
    expect(activity.isError).toBeFalsy();
    expect(activity.structuredContent).toMatchObject({ user: 'reviewer1', days: 2 });

    const notes = await call('generate_release_notes', { repo: 'acme/web', from: '2026-09-01' });
    expect(notes.isError).toBeFalsy();
    expect(notes.structuredContent).toMatchObject({ sections: [{ type: 'feat' }] });
  });

  it('generate_release_notes reports an unknown tag as a tool error', async () => {
    const result = await call('generate_release_notes', { repo: 'acme/web', from: 'v0.0.0-nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('[NOT_FOUND]') });
  });

  // --- M2: resources ------------------------------------------------------------

  it('lists the checklists as resources and both templates', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'devflow://checklists/general',
      'devflow://checklists/node',
      'devflow://checklists/react',
      'devflow://checklists/security',
    ]);
    expect(resources[2]).toMatchObject({ title: 'React review', mimeType: 'text/markdown' });

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'devflow://checklists/{name}',
      'devflow://repos/{owner}/{repo}/guidelines',
    ]);
  });

  it('reads a checklist and a repository’s guidelines', async () => {
    const checklist = await client.readResource({ uri: 'devflow://checklists/security' });
    expect(checklist.contents[0]).toMatchObject({
      uri: 'devflow://checklists/security',
      mimeType: 'text/markdown',
      text: expect.stringContaining('# Security review'),
    });

    github.fileTexts.set('acme/web:CONTRIBUTING.md', 'Use conventional commits.');
    const guidelines = await client.readResource({ uri: 'devflow://repos/acme/web/guidelines' });
    expect(guidelines.contents[0]).toMatchObject({
      text: expect.stringContaining('Use conventional commits.'),
    });
  });

  it('turns resource failures into JSON-RPC errors with our message', async () => {
    await expect(client.readResource({ uri: 'devflow://checklists/python' })).rejects.toMatchObject(
      {
        code: -32602,
        message: expect.stringContaining('[NOT_FOUND] No checklist named "python"'),
      },
    );
    await expect(
      client.readResource({ uri: 'devflow://checklists/..%2Fsecrets' }),
    ).rejects.toMatchObject({
      code: -32602,
    });
  });

  // --- M2: prompts and completions ------------------------------------------------

  it('lists the prompts with their arguments', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'review-pr',
      'standup-summary',
      'release-notes',
    ]);
    expect(prompts[0]?.arguments).toEqual([
      expect.objectContaining({ name: 'pr', required: true }),
      expect.objectContaining({ name: 'checklist', required: false }),
    ]);
  });

  it('review-pr builds instructions and embeds the chosen checklist', async () => {
    const prompt = await client.getPrompt({
      name: 'review-pr',
      arguments: { pr: 'https://github.com/acme/web/pull/42', checklist: 'react' },
    });
    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]?.content).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Call get_pr_diff with pr="acme/web#42"'),
    });
    expect(prompt.messages[1]?.content).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'devflow://checklists/react',
        text: expect.stringContaining('# React review'),
      },
    });
  });

  it('prompts reject bad arguments with a clear error', async () => {
    await expect(
      client.getPrompt({ name: 'review-pr', arguments: { pr: 'not-a-pr' } }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('[INVALID_INPUT]') });
    await expect(
      client.getPrompt({ name: 'standup-summary', arguments: { days: 'lots' } }),
    ).rejects.toMatchObject({ message: expect.stringContaining('days must be a whole number') });
  });

  it('standup-summary and release-notes produce tool-calling instructions', async () => {
    const standup = await client.getPrompt({ name: 'standup-summary', arguments: { days: '3' } });
    expect(standup.messages[0]?.content).toMatchObject({
      text: expect.stringContaining('Call get_my_activity with days=3'),
    });
    const release = await client.getPrompt({
      name: 'release-notes',
      arguments: { repo: 'acme/web', from: 'v1.0.0', to: 'v1.1.0' },
    });
    expect(release.messages[0]?.content).toMatchObject({
      text: expect.stringContaining('from="v1.0.0" and to="v1.1.0"'),
    });
  });

  it('completes prompt arguments and resource-template variables', async () => {
    const pr = await client.complete({
      ref: { type: 'ref/prompt', name: 'review-pr' },
      argument: { name: 'pr', value: 'acme' },
    });
    expect(pr.completion.values).toEqual(['acme/web#42']);

    const checklist = await client.complete({
      ref: { type: 'ref/prompt', name: 'review-pr' },
      argument: { name: 'checklist', value: 're' },
    });
    expect(checklist.completion.values).toEqual(['react']);

    const repo = await client.complete({
      ref: { type: 'ref/prompt', name: 'release-notes' },
      argument: { name: 'repo', value: '' },
    });
    expect(repo.completion.values).toEqual(['acme/web']);

    const name = await client.complete({
      ref: { type: 'ref/resource', uri: 'devflow://checklists/{name}' },
      argument: { name: 'name', value: 's' },
    });
    expect(name.completion.values).toEqual(['security']);
  });

  // --- M2: logging --------------------------------------------------------------

  it('forwards warnings by default and follows logging/setLevel', async () => {
    await call('get_pr_context', { pr: 'acme/web#42' }); // info: not forwarded by default
    await call('get_pr_context', { pr: 'acme/web#999' }); // NOT_FOUND → warn: forwarded
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs.map((log) => log.level)).toEqual(['warning']);
    expect(logs[0]?.data).toMatchObject({ tool: 'get_pr_context', code: 'NOT_FOUND' });

    await client.setLoggingLevel('info');
    await call('get_pr_context', { pr: 'acme/web#42' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs.at(-1)).toMatchObject({ level: 'info', data: { msg: 'tool succeeded' } });
    expect(logger.isLevelEnabled('debug')).toBe(true);
  });
});
