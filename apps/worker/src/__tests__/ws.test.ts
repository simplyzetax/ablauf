import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Ablauf } from '@der-ablauf/workflows';
import { SSEWorkflow } from '../workflows/sse-workflow';

const ablauf = new Ablauf(env.WORKFLOW_RUNNER);

describe('WebSocket live updates', () => {
	it('workflow completes and persists emit messages', async () => {
		const stub = await ablauf.create(SSEWorkflow, {
			id: 'ws-1',
			payload: { itemCount: 10 },
		});

		const status = await stub.getStatus();
		expect(status.status).toBe('completed');
		expect(status.result).toEqual({ processed: 10 });
	});

	it('connectWS returns persisted messages to a new WebSocket client', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'ws-stream-1',
			payload: { itemCount: 6 },
		});

		// Connect via WebSocket to the DO
		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('ws-stream-1'));
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		expect(resp.status).toBe(101);

		const ws = resp.webSocket!;
		ws.accept();

		// Should receive persisted emit messages
		const messages: string[] = [];
		const done = new Promise<void>((resolve) => {
			ws.addEventListener('message', (evt: MessageEvent) => {
				messages.push(evt.data as string);
				const parsed = JSON.parse(evt.data as string);
				if (parsed.event === 'close') {
					resolve();
				}
			});
			// Fallback timeout
			setTimeout(resolve, 2000);
		});
		await done;

		const parsed = messages.map((m) => JSON.parse(m));
		const doneMsg = parsed.find((m: any) => m.event === 'done');
		expect(doneMsg).toBeDefined();
		expect(doneMsg.data).toContain('Processed 6 items');

		ws.close();
	});

	it('broadcast messages are not persisted (fire-and-forget)', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'ws-broadcast-1',
			payload: { itemCount: 4 },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('ws-broadcast-1'));
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		const ws = resp.webSocket!;
		ws.accept();

		const messages: string[] = [];
		const done = new Promise<void>((resolve) => {
			ws.addEventListener('message', (evt: MessageEvent) => {
				messages.push(evt.data as string);
				const parsed = JSON.parse(evt.data as string);
				if (parsed.event === 'close') resolve();
			});
			setTimeout(resolve, 2000);
		});
		await done;

		const parsed = messages.map((m) => JSON.parse(m));
		expect(parsed.some((m: any) => m.event === 'done')).toBe(true);
		expect(parsed.some((m: any) => m.event === 'progress')).toBe(false);

		ws.close();
	});

	it('connectWS on workflow without sseUpdates returns 1008 close', async () => {
		const { EchoWorkflow } = await import('../workflows/echo-workflow');

		await new Ablauf(env.WORKFLOW_RUNNER).create(EchoWorkflow, {
			id: 'ws-no-schema-1',
			payload: { message: 'no sse' },
		});

		const rawStub = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.idFromName('ws-no-schema-1'));
		const resp = await rawStub.fetch('http://fake-host/ws', {
			headers: { Upgrade: 'websocket' },
		});
		const ws = resp.webSocket!;
		ws.accept();

		const closed = new Promise<{ code: number }>((resolve) => {
			ws.addEventListener('close', (evt: CloseEvent) => {
				resolve({ code: evt.code });
			});
		});
		const result = await closed;
		expect(result.code).toBe(1008); // Policy violation — no SSE schema
	});

	it('waitForUpdate resolves typed data via WebSocket', async () => {
		await ablauf.create(SSEWorkflow, {
			id: 'ws-wait-update-1',
			payload: { itemCount: 8 },
		});

		const done = await ablauf.waitForUpdate(SSEWorkflow, {
			id: 'ws-wait-update-1',
			update: 'done',
		});

		expect(done).toEqual({ message: 'Processed 8 items' });
	});
});
