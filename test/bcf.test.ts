import type { IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZE } from '../nodes/Scenoptic/resources/shared';
import { topicBody, topicODataFilter } from '../nodes/Scenoptic/resources/topic';
import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { PROBLEM_MESSAGES } from '../nodes/shared/problem';
import { fakeExecute, type FakeResponse } from './fakes';

const node = new Scenoptic();

async function run(params: Record<string, unknown>, responses: FakeResponse[]) {
	const ctx = fakeExecute({ projectId: 'p1', ...params }, responses);
	const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
	return { out: out.map((o) => o.json), calls: ctx.calls.map((c) => c.options) };
}

const STORED_TOPIC = {
	guid: 'g1',
	server_assigned_id: '42',
	title: 'Réservation manquante',
	topic_type: 'Clash',
	topic_status: 'Open',
	priority: 'Haute',
	stage: null,
	assigned_to: 'marie@example.com',
	description: 'La gaine traverse la dalle.',
	due_date: '2026-10-15T00:00:00.000Z',
	labels: ['CVC'],
	reference_links: [],
	index: 3,
	bim_snippet: null,
	extended: { file_id: 'f1', pdf_annotation: { id: 'a' } },
	creation_date: '2026-10-02T15:40:03.510Z',
	creation_author: 'paul@example.com',
	modified_date: '2026-10-03T10:00:00.000Z',
};

describe('Topic', () => {
	it('Get', async () => {
		const { out, calls } = await run({ resource: 'topic', operation: 'get', topicId: 'g1' }, [
			{ statusCode: 200, body: STORED_TOPIC },
		]);
		expect(out).toEqual([STORED_TOPIC]);
		expect(calls[0]).toMatchObject({ method: 'GET', url: '/bcf/3.0/projects/p1/topics/g1' });
	});

	it('Get Many, Return All : pages de $top jusqu’à une page incomplète', async () => {
		const full = Array.from({ length: PAGE_SIZE }, (_, k) => ({ guid: `g${k}` }));
		const { out, calls } = await run(
			{ resource: 'topic', operation: 'getAll', returnAll: true, filters: {} },
			[
				{ statusCode: 200, body: full },
				{ statusCode: 200, body: [{ guid: 'last' }] },
			],
		);
		expect(out).toHaveLength(PAGE_SIZE + 1);
		expect(calls.map((c) => c.qs)).toEqual([
			{ $orderby: 'creation_date desc', $top: PAGE_SIZE, $skip: 0 },
			{ $orderby: 'creation_date desc', $top: PAGE_SIZE, $skip: PAGE_SIZE },
		]);
	});

	it('Get Many, Limit et filtres : $top et $filter joints par and', async () => {
		const { calls } = await run(
			{
				resource: 'topic',
				operation: 'getAll',
				returnAll: false,
				limit: 5,
				filters: {
					status: 'Open',
					assignedTo: "o'neil@example.com",
					odataFilter: "priority eq 'Haute'",
					orderBy: 'modified_date desc',
				},
			},
			[{ statusCode: 200, body: [] }],
		);
		expect(calls[0]).toMatchObject({ url: '/bcf/3.0/projects/p1/topics' });
		expect(calls[0].qs).toEqual({
			$orderby: 'modified_date desc',
			$top: 5,
			$filter: "topic_status eq 'Open' and assigned_to eq 'o''neil@example.com' and priority eq 'Haute'",
		});
	});

	it('Create : titre + champs, labels en liste', async () => {
		const { calls } = await run(
			{
				resource: 'topic',
				operation: 'create',
				title: 'Nouveau',
				additionalFields: { assignedTo: 'marie@example.com', labels: 'CVC, Plomberie, ', status: 'Open' },
			},
			[{ statusCode: 201, body: { guid: 'g2' } }],
		);
		expect(calls[0]).toMatchObject({ method: 'POST', url: '/bcf/3.0/projects/p1/topics' });
		expect(calls[0].body).toEqual({
			title: 'Nouveau',
			assigned_to: 'marie@example.com',
			labels: ['CVC', 'Plomberie'],
			topic_status: 'Open',
		});
	});

	// Mutation « PUT des seuls champs modifiés » : le PUT BCF efface tout champ omis, la mise à jour
	// doit renvoyer chaque champ inscriptible du topic lu, `extended` compris.
	it('Update : relit le topic et renvoie tous les champs inscriptibles, modifiés ou non', async () => {
		const { calls } = await run(
			{
				resource: 'topic',
				operation: 'update',
				topicId: 'g1',
				updateFields: { assignedTo: 'paul@example.com', description: '' },
			},
			[
				{ statusCode: 200, body: STORED_TOPIC },
				{ statusCode: 200, body: { ...STORED_TOPIC, assigned_to: 'paul@example.com' } },
			],
		);
		expect(calls.map((c) => [c.method, c.url])).toEqual([
			['GET', '/bcf/3.0/projects/p1/topics/g1'],
			['PUT', '/bcf/3.0/projects/p1/topics/g1'],
		]);
		expect(calls[1].body).toEqual({
			title: 'Réservation manquante',
			topic_type: 'Clash',
			topic_status: 'Open',
			priority: 'Haute',
			stage: null,
			assigned_to: 'paul@example.com',
			description: null,
			due_date: '2026-10-15T00:00:00.000Z',
			labels: ['CVC'],
			reference_links: [],
			index: 3,
			bim_snippet: null,
			extended: { file_id: 'f1', pdf_annotation: { id: 'a' } },
		});
	});

	it('Update sans champ, ou avec un titre vide : refusé sans appel', async () => {
		const empty = fakeExecute({ projectId: 'p1', resource: 'topic', operation: 'update', topicId: 'g1', updateFields: {} });
		await expect(node.execute.call(empty as unknown as IExecuteFunctions)).rejects.toThrow(/at least one field/);
		const noTitle = fakeExecute({
			projectId: 'p1',
			resource: 'topic',
			operation: 'update',
			topicId: 'g1',
			updateFields: { title: '' },
		});
		await expect(node.execute.call(noTitle as unknown as IExecuteFunctions)).rejects.toThrow(/title/);
		expect(empty.calls).toHaveLength(0);
		expect(noTitle.calls).toHaveLength(0);
	});

	it('Create avec un jeton sans bcf:write : INSUFFICIENT_SCOPE lisible', async () => {
		const ctx = fakeExecute({ projectId: 'p1', resource: 'topic', operation: 'create', title: 't', additionalFields: {} }, [
			{
				statusCode: 403,
				body: { code: 'INSUFFICIENT_SCOPE', detail: 'Scope bcf:write requis', details: { required: 'bcf:write' } },
			},
		]);
		await expect(node.execute.call(ctx as unknown as IExecuteFunctions)).rejects.toThrow(
			`${PROBLEM_MESSAGES.INSUFFICIENT_SCOPE} (bcf:write) [INSUFFICIENT_SCOPE]`,
		);
	});
});

describe('topicBody / topicODataFilter', () => {
	it('vide → null, labels vides → null, champs inconnus ignorés', () => {
		expect(topicBody({ priority: '', labels: ' , ', inconnu: 'x' })).toEqual({ priority: null, labels: null });
	});

	it('sans filtre : pas de $filter', () => {
		expect(topicODataFilter({ orderBy: 'index asc' })).toBeUndefined();
	});
});

describe('Comment', () => {
	it('Create : texte et champs facultatifs', async () => {
		const { calls } = await run(
			{
				resource: 'comment',
				operation: 'create',
				topicId: 'g1',
				comment: 'Vu @marie@example.com',
				additionalFields: { replyToCommentGuid: 'c0' },
			},
			[{ statusCode: 201, body: { guid: 'c1' } }],
		);
		expect(calls[0]).toMatchObject({ method: 'POST', url: '/bcf/3.0/projects/p1/topics/g1/comments' });
		expect(calls[0].body).toEqual({ comment: 'Vu @marie@example.com', reply_to_comment_guid: 'c0' });
	});

	it('Get Many : tri et limite', async () => {
		const { out, calls } = await run(
			{ resource: 'comment', operation: 'getAll', topicId: 'g1', returnAll: false, limit: 2, orderBy: 'date desc' },
			[{ statusCode: 200, body: [{ guid: 'c2' }, { guid: 'c1' }] }],
		);
		expect(out).toHaveLength(2);
		expect(calls[0].qs).toEqual({ $orderby: 'date desc', $top: 2 });
	});

	it('Topic introuvable : TOPIC_NOT_FOUND lisible', async () => {
		const ctx = fakeExecute(
			{ projectId: 'p1', resource: 'comment', operation: 'create', topicId: 'zz', comment: 'x', additionalFields: {} },
			[{ statusCode: 404, body: { code: 'TOPIC_NOT_FOUND', detail: 'Topic zz not found' } }],
		);
		await expect(node.execute.call(ctx as unknown as IExecuteFunctions)).rejects.toThrow('[TOPIC_NOT_FOUND]');
	});
});
