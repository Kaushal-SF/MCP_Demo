import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSilentLogger } from '../../src/lib/logger.js';
import { createServer } from '../../src/server.js';
import { FakeGitHubClient, makeFile, makePr, makeReviewItem } from '../helpers/fixtures.js';

/**
 * End-to-end over the real MCP protocol: a real SDK Client talks to our server through an
 * in-memory transport. This checks registration, schemas, annotations, output validation and
 * error reporting exactly as an MCP host would see them.
 */
describe('DevFlow MCP server (in-memory)', () => {
  let github: FakeGitHubClient;
  let client: Client;

  beforeEach(async () => {
    github = new FakeGitHubClient().addPr(makePr({ body: 'x'.repeat(5000) + '\nFixes #12' }), [
      makeFile('src/auth/login.ts', 80),
    ]);
    github.reviewRequests = { totalCount: 1, items: [makeReviewItem(42, '2026-10-01T00:00:00Z')] };

    const server = createServer({ github, logger: createSilentLogger(), extraSensitivePaths: [] });
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;

  it('advertises server identity, instructions and capabilities', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'devflow-mcp', title: 'DevFlow MCP' });
    expect(client.getInstructions()).toContain('untrusted');
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, logging: {} });
  });

  it('lists all tools with schemas and read-only annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'analyze_pr_risk',
      'get_pr_context',
      'list_review_queue',
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
});
