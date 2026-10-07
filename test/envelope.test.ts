import { describe, expect, it } from 'vitest';

import {
	EVENT_TYPE_PREFIX,
	flattenEvent,
	isScenopticEvent,
	passesFilters,
	PING,
	WEBHOOK_EVENT_TYPES,
	type ScenopticEvent,
} from '../nodes/ScenopticTrigger/envelope';
import { loadSpec } from './spec';

const spec = loadSpec();

function specExamples(): Array<[string, ScenopticEvent]> {
	const out: Array<[string, ScenopticEvent]> = [];
	for (const [type, webhook] of Object.entries(spec.webhooks)) {
		for (const media of Object.values(webhook.post.requestBody.content)) {
			for (const example of Object.values(media.examples ?? {})) {
				out.push([type, example.value as ScenopticEvent]);
			}
		}
	}
	return out;
}

describe('catalogue contre la spec', () => {
	it('les types proposés sont ceux de la spec, hors ping', () => {
		const fromSpec = Object.keys(spec.webhooks)
			.map((t) => t.slice(EVENT_TYPE_PREFIX.length))
			.filter((t) => t !== PING);
		expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(fromSpec.sort());
	});

	it('chaque type de la spec a un exemple', () => {
		expect(
			specExamples()
				.map(([t]) => t)
				.sort(),
		).toEqual(Object.keys(spec.webhooks).sort());
	});
});

describe('flattenEvent', () => {
	it.each(specExamples())('%s : data à plat, sans collision', (_, event) => {
		expect(isScenopticEvent(event)).toBe(true);
		const flat = flattenEvent(event);
		expect(Object.keys(flat).filter((k) => k.startsWith('data_'))).toEqual([]);
		expect(flat).not.toHaveProperty('data');
		for (const [k, v] of Object.entries(event.data)) expect(flat[k]).toEqual(v);
		expect(flat.id).toBe(event.id);
		expect(flat.type).toBe(event.type);
		expect(flat.event).toBe(event.type.slice(EVENT_TYPE_PREFIX.length));
		expect(flat.project_id).toBe(event.source.replace('/projects/', ''));
	});

	it('une clé de data en collision devient data_<clé>', () => {
		const flat = flattenEvent({
			id: 'e1',
			type: 'com.scenoptic.x',
			source: '/projects/p1',
			data: { id: 'interne', project_id: 'autre', topic: { guid: 'g' } },
		});
		expect(flat).toMatchObject({
			id: 'e1',
			data_id: 'interne',
			project_id: 'p1',
			data_project_id: 'autre',
		});
		expect(flat.topic).toEqual({ guid: 'g' });
	});
});

describe('passesFilters', () => {
	const notif = (kind: string, email: string): ScenopticEvent => ({
		id: 'n1',
		type: 'com.scenoptic.notification.created',
		source: '/projects/p1',
		data: { notification: { kind, recipient: { email } }, topic: null },
	});
	const topicCreated: ScenopticEvent = {
		id: 'e1',
		type: 'com.scenoptic.bcf.topic.created',
		source: '/projects/p1',
		data: { topic: { assigned_to: 'x@example.com' } },
	};

	it('sans filtre : tout passe', () => {
		expect(passesFilters(notif('topic.assigned', 'a@example.com'), {})).toBe(true);
	});

	it('Assigned To : destinataire, sans tenir compte de la casse ni des espaces', () => {
		const f = { assignedTo: '  Marie.Durand@Example.com ' };
		expect(passesFilters(notif('topic.assigned', 'marie.durand@example.com'), f)).toBe(true);
		expect(passesFilters(notif('topic.assigned', 'paul@example.com'), f)).toBe(false);
	});

	it('Notification Kinds', () => {
		const f = { notificationKinds: ['topic.assigned'] };
		expect(passesFilters(notif('topic.assigned', 'a@example.com'), f)).toBe(true);
		expect(passesFilters(notif('topic.commented', 'a@example.com'), f)).toBe(false);
	});

	it('les filtres ne touchent pas les autres événements', () => {
		expect(
			passesFilters(topicCreated, {
				assignedTo: 'personne@example.com',
				notificationKinds: ['topic.assigned'],
			}),
		).toBe(true);
	});
});
