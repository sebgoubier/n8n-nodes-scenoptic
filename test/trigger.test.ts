import type { IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScenopticTrigger } from '../nodes/ScenopticTrigger/ScenopticTrigger.node';
import { ScenopticApiError } from '../nodes/shared/transport';
import { fakeHook, fakeWebhook } from './fakes';
import { signer } from './sign';

const SIGNING_FIXTURE = 'whsec_SECRET_never_printed_42';
const URL = 'https://n8n.example.com/webhook/abc/webhook';
const NOW = 1_790_000_000;
const PARAMS = { projectId: 'p1', events: ['notification.created', 'bcf.topic.created'] };

const node = new ScenopticTrigger();
const hooks = node.webhookMethods.default;

const subscription = (over: Record<string, unknown> = {}) => ({
	id: 'w1',
	project_id: 'p1',
	url: URL,
	event_types: ['bcf.topic.created', 'notification.created'],
	active: true,
	...over,
});

const TEST_URL = 'https://n8n.example.com/webhook-test/abc/webhook';
const SUB = { webhookId: 'w1', webhookSecret: SIGNING_FIXTURE, projectId: 'p1' };
/** staticData du nœud, abonnements rangés par URL de webhook. */
const stored = (over: Record<string, unknown> = {}) => ({ subscriptions: { [URL]: { ...SUB, ...over } } });
const EMPTY = { subscriptions: {} };

const asHook = (ctx: unknown) => ctx as IHookFunctions;
const asWebhook = (ctx: unknown) => ctx as IWebhookFunctions;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('create', () => {
	it("crée l'abonnement et ne garde le secret que dans le staticData", async () => {
		const state: Record<string, unknown> = {};
		const ctx = fakeHook(PARAMS, state, [
			{ statusCode: 201, body: { ...subscription(), secret: SIGNING_FIXTURE } },
		]);
		await expect(hooks.create.call(asHook(ctx))).resolves.toBe(true);

		expect(ctx.calls[0].options).toMatchObject({
			method: 'POST',
			url: '/api/v1/projects/p1/webhooks',
			body: {
				url: URL,
				event_types: PARAMS.events,
				description: 'n8n: Topic assigned to Teams',
			},
		});
		expect(state).toEqual(stored());
	});

	it('422 WEBHOOK_URL_FORBIDDEN : erreur lisible par code, rien mémorisé', async () => {
		const state: { subscriptions?: Record<string, unknown> } = {};
		const ctx = fakeHook(PARAMS, state, [
			{ statusCode: 422, body: { code: 'WEBHOOK_URL_FORBIDDEN', detail: 'adresse privée' } },
		]);
		const err = await hooks.create.call(asHook(ctx)).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ScenopticApiError);
		expect((err as ScenopticApiError).message).toContain('[WEBHOOK_URL_FORBIDDEN]');
		expect(state.subscriptions ?? {}).toEqual({});
	});

	it('refuse une réponse sans secret', async () => {
		const ctx = fakeHook(PARAMS, {}, [{ statusCode: 201, body: subscription() }]);
		await expect(hooks.create.call(asHook(ctx))).rejects.toThrow(/signing secret/);
	});
});

describe('checkExists', () => {

	it('rien de mémorisé : false, sans appel', async () => {
		const ctx = fakeHook(PARAMS, {});
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(false);
		expect(ctx.calls).toHaveLength(0);
	});

	it('abonnement à jour : true (ordre des événements indifférent)', async () => {
		const ctx = fakeHook(PARAMS, stored(), [{ statusCode: 200, body: subscription() }]);
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(true);
		expect(ctx.calls[0].options.url).toBe('/api/v1/projects/p1/webhooks/w1');
	});

	it('404 : oublié, false', async () => {
		const state = stored();
		const ctx = fakeHook(PARAMS, state, [{ statusCode: 404, body: { code: 'WEBHOOK_NOT_FOUND' } }]);
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(false);
		expect(state).toEqual(EMPTY);
	});

	it.each([
		['URL changée', subscription({ url: 'https://ailleurs.example.com/x' }), PARAMS],
		['événements changés', subscription({ event_types: ['bcf.topic.created'] }), PARAMS],
		['désactivé côté Scenoptic', subscription({ active: false }), PARAMS],
	])('%s : supprimé puis false', async (_, body, params) => {
		const state = stored();
		const ctx = fakeHook(params, state, [{ statusCode: 200, body }, { statusCode: 204 }]);
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(false);
		expect(ctx.calls[1].options).toMatchObject({
			method: 'DELETE',
			url: '/api/v1/projects/p1/webhooks/w1',
		});
		expect(state).toEqual(EMPTY);
	});

	it("projet changé : l'ancien abonnement est supprimé dans l'ANCIEN projet", async () => {
		const state = stored();
		const ctx = fakeHook({ ...PARAMS, projectId: 'p2' }, state, [
			{ statusCode: 200, body: subscription() },
			{ statusCode: 204 },
		]);
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(false);
		expect(ctx.calls[1].options.url).toBe('/api/v1/projects/p1/webhooks/w1');
	});

	it('secret perdu : supprimé puis false', async () => {
		const state = stored({ webhookSecret: '' });
		const ctx = fakeHook(PARAMS, state, [{ statusCode: 200, body: subscription() }, { statusCode: 204 }]);
		await expect(hooks.checkExists.call(asHook(ctx))).resolves.toBe(false);
		expect(ctx.calls[1].options.method).toBe('DELETE');
	});

	it('autre erreur : remontée', async () => {
		const ctx = fakeHook(PARAMS, stored(), [{ statusCode: 401, body: { code: 'UNAUTHENTICATED' } }]);
		await expect(hooks.checkExists.call(asHook(ctx))).rejects.toThrow(/\[UNAUTHENTICATED\]/);
	});
});

describe('URL de test et URL de production', () => {
	it("écouter un test ne touche pas l'abonnement de production", async () => {
		const state = stored();
		const test = fakeHook(PARAMS, state, [
			{ statusCode: 201, body: { ...subscription({ id: 'w2', url: TEST_URL }), secret: 'whsec_test_2' } },
		], TEST_URL);
		await expect(hooks.checkExists.call(asHook(test))).resolves.toBe(false);
		await hooks.create.call(asHook(test));
		expect(test.calls.map((c) => c.options.method)).toEqual(['POST']);
		expect(Object.keys(state.subscriptions).sort()).toEqual([URL, TEST_URL].sort());

		test.push({ statusCode: 204 });
		await hooks.delete.call(asHook(test));
		expect(test.calls[1].options.url).toBe('/api/v1/projects/p1/webhooks/w2');
		expect(state).toEqual(stored());
	});
});

describe('delete', () => {

	it('204 : oublié', async () => {
		const state = stored();
		const ctx = fakeHook(PARAMS, state, [{ statusCode: 204 }]);
		await expect(hooks.delete.call(asHook(ctx))).resolves.toBe(true);
		expect(ctx.calls[0].options).toMatchObject({ method: 'DELETE', url: '/api/v1/projects/p1/webhooks/w1' });
		expect(state).toEqual(EMPTY);
	});

	it('404 : déjà supprimé, oublié', async () => {
		const state = stored();
		const ctx = fakeHook(PARAMS, state, [{ statusCode: 404, body: { code: 'WEBHOOK_NOT_FOUND' } }]);
		await expect(hooks.delete.call(asHook(ctx))).resolves.toBe(true);
		expect(state).toEqual(EMPTY);
	});

	it('autre échec : false, état gardé pour réessayer', async () => {
		const state = stored();
		const ctx = fakeHook(PARAMS, state, [{ statusCode: 503, body: { code: 'HTTP_503' } }]);
		await expect(hooks.delete.call(asHook(ctx))).resolves.toBe(false);
		expect(state).toEqual(stored());
	});
});

describe('webhook', () => {
	const event = {
		specversion: '1.0',
		id: 'n1',
		type: 'com.scenoptic.notification.created',
		source: '/projects/p1',
		subject: 'topics/g1',
		time: '2026-10-04T08:30:00.000Z',
		datacontenttype: 'application/json',
		scenopticactor: 'paul@example.com',
		data: {
			notification: { id: 'n1', kind: 'topic.assigned', recipient: { email: 'marie@example.com' } },
			topic: { guid: 'g1', title: 'Réservation manquante' },
		},
	};
	// Corps tel qu'il arrive : NON canonique (espaces), comme peut l'envoyer n'importe quel émetteur.
	const raw = JSON.stringify(event, null, 1);
	const state = () => stored();
	const signed = (t = NOW, body = raw) => ({ 'scenoptic-signature': signer(SIGNING_FIXTURE, t, body) });

	it('signature valide : déclenche avec data à plat', async () => {
		const ctx = fakeWebhook({ staticData: state(), rawBody: Buffer.from(raw), headers: signed() });
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out.workflowData?.[0]).toHaveLength(1);
		expect(out.workflowData?.[0][0].json).toMatchObject({
			id: 'n1',
			event: 'notification.created',
			project_id: 'p1',
			notification: { kind: 'topic.assigned' },
			topic: { guid: 'g1' },
		});
		expect(ctx.res.statusCode).toBe(0);
	});

	it.each([
		['sans signature', {}],
		['signature fausse', { 'scenoptic-signature': `t=${NOW},v1=${'a'.repeat(64)}` }],
		['horodatage périmé', { 'scenoptic-signature': signer(SIGNING_FIXTURE, NOW - 301, raw) }],
		['horodatage futur', { 'scenoptic-signature': signer(SIGNING_FIXTURE, NOW + 301, raw) }],
	])('%s : 401, rien ne se déclenche', async (_, headers) => {
		const ctx = fakeWebhook({ staticData: state(), rawBody: Buffer.from(raw), headers });
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out).toEqual({ noWebhookResponse: true });
		expect(ctx.res.statusCode).toBe(401);
	});

	it('corps re-sérialisé par un intermédiaire : 401', async () => {
		const reserialized = JSON.stringify(JSON.parse(raw));
		const ctx = fakeWebhook({
			staticData: state(),
			rawBody: Buffer.from(reserialized),
			headers: signed(),
		});
		await node.webhook.call(asWebhook(ctx));
		expect(ctx.res.statusCode).toBe(401);
	});

	it('pas de corps brut disponible : 401', async () => {
		const ctx = fakeWebhook({ staticData: state(), rawBody: undefined, headers: signed() });
		await node.webhook.call(asWebhook(ctx));
		expect(ctx.res.statusCode).toBe(401);
	});

	it("signé par le secret de l'abonnement de test : accepté", async () => {
		const both = {
			subscriptions: {
				[URL]: SUB,
				[TEST_URL]: { webhookId: 'w2', webhookSecret: 'whsec_test_2', projectId: 'p1' },
			},
		};
		const ctx = fakeWebhook({
			staticData: both,
			rawBody: Buffer.from(raw),
			headers: { 'scenoptic-signature': signer('whsec_test_2', NOW, raw) },
		});
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out.workflowData?.[0]).toHaveLength(1);
	});

	it('aucun abonnement mémorisé (secret absent) : 401', async () => {
		const ctx = fakeWebhook({ staticData: {}, rawBody: Buffer.from(raw), headers: signed() });
		await node.webhook.call(asWebhook(ctx));
		expect(ctx.res.statusCode).toBe(401);
	});

	it('ping signé : 200 sans déclencher', async () => {
		const ping = JSON.stringify({ ...event, type: 'com.scenoptic.ping', data: { subscription_id: 'w1', message: 'test' } });
		const ctx = fakeWebhook({ staticData: state(), rawBody: Buffer.from(ping), headers: signed(NOW, ping) });
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out).toEqual({ noWebhookResponse: true });
		expect(ctx.res.statusCode).toBe(200);
	});

	it('écarté par le filtre Assigned To : 200 sans déclencher', async () => {
		const ctx = fakeWebhook({
			staticData: state(),
			rawBody: Buffer.from(raw),
			headers: signed(),
			params: { options: { assignedTo: 'quelquun@example.com' } },
		});
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out).toEqual({ noWebhookResponse: true });
		expect(ctx.res.statusCode).toBe(200);
	});

	it('retenu par le filtre Assigned To : déclenche', async () => {
		const ctx = fakeWebhook({
			staticData: state(),
			rawBody: Buffer.from(raw),
			headers: signed(),
			params: { options: { assignedTo: 'MARIE@example.com', notificationKinds: ['topic.assigned'] } },
		});
		const out = await node.webhook.call(asWebhook(ctx));
		expect(out.workflowData?.[0]).toHaveLength(1);
	});

	it("corps signé mais qui n'est pas une enveloppe : 400", async () => {
		const junk = '{"hello":"world"}';
		const ctx = fakeWebhook({ staticData: state(), rawBody: Buffer.from(junk), headers: signed(NOW, junk) });
		await node.webhook.call(asWebhook(ctx));
		expect(ctx.res.statusCode).toBe(400);
	});
});

// Garantie « secret jamais journalisé » : création, déclenchement et refus 401 enchaînés ; ni le
// journal, ni les réponses HTTP, ni la sortie du workflow ne contiennent le secret.
// Mutations vues : un `this.logger.debug(secret)` dans `create`, le secret dans la réponse 401,
// le staticData recopié dans la sortie.
describe('secret', () => {
	it("n'apparaît nulle part hors du staticData", async () => {
		const outside: unknown[] = [];
		const hook = fakeHook(PARAMS, {}, [
			{ statusCode: 201, body: { ...subscription(), secret: SIGNING_FIXTURE } },
		]);
		await hooks.create.call(asHook(hook));
		outside.push(hook.logLines);

		const raw = JSON.stringify({
			specversion: '1.0',
			id: 'e1',
			type: 'com.scenoptic.bcf.topic.created',
			source: '/projects/p1',
			data: { topic: { guid: 'g1' } },
		});
		const good = fakeWebhook({
			staticData: hook.staticData,
			rawBody: Buffer.from(raw),
			headers: { 'scenoptic-signature': signer(SIGNING_FIXTURE, NOW, raw) },
		});
		const out = await node.webhook.call(asWebhook(good));
		expect(out.workflowData?.[0]).toHaveLength(1);
		outside.push(out, good.res.body, good.logLines);

		const bad = fakeWebhook({
			staticData: hook.staticData,
			rawBody: Buffer.from(raw),
			headers: { 'scenoptic-signature': `t=${NOW},v1=${'b'.repeat(64)}` },
		});
		await node.webhook.call(asWebhook(bad));
		expect(bad.res.statusCode).toBe(401);
		outside.push(bad.res.body, bad.logLines);

		const dump = JSON.stringify(outside);
		expect(dump).not.toContain(SIGNING_FIXTURE);
		expect(dump).not.toContain(SIGNING_FIXTURE.slice(6));
		expect(JSON.stringify(hook.staticData)).toContain(SIGNING_FIXTURE);
	});
});
