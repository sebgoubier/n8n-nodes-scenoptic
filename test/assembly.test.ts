import type { IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { parseFileIds } from '../nodes/Scenoptic/resources/assembly';
import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { fakeExecute } from './fakes';

const A1 = { id: 'a1', projectId: 'p1', name: 'ARC + STR', createdAt: '2026-10-01T10:00:00.000Z', fileIds: ['f1', 'f2'] };
const A2 = { id: 'a2', projectId: 'p1', name: 'CVC', createdAt: '2026-09-30T10:00:00.000Z', fileIds: ['f3'] };

const run = async (ctx: ReturnType<typeof fakeExecute>) => {
	const [out] = await new Scenoptic().execute.call(ctx as unknown as IExecuteFunctions);
	return out;
};

describe('parseFileIds', () => {
	it('liste séparée par des virgules, espaces et vides écartés', () => {
		expect(parseFileIds(' f1, ,f2 ,')).toEqual(['f1', 'f2']);
	});

	it('tableau passé par une expression', () => {
		expect(parseFileIds(['f1', ' f2 ', ''])).toEqual(['f1', 'f2']);
	});

	it('vide → aucune', () => {
		expect(parseFileIds('')).toEqual([]);
		expect(parseFileIds(undefined)).toEqual([]);
	});
});

describe('Scenoptic › Assembly', () => {
	it('Get : GET /api/v1/assemblies/{id}', async () => {
		const ctx = fakeExecute({ resource: 'assembly', operation: 'get', assemblyId: 'a 1' }, [
			{ statusCode: 200, body: A1 },
		]);
		const out = await run(ctx);
		expect(out.map((o) => o.json)).toEqual([A1]);
		expect(ctx.calls[0].options.method).toBe('GET');
		expect(ctx.calls[0].options.url).toBe('/api/v1/assemblies/a%201');
	});

	it('Get Many, Return All : toute la liste, un élément par assemblage', async () => {
		const ctx = fakeExecute({ resource: 'assembly', operation: 'getAll', projectId: 'p1', returnAll: true }, [
			{ statusCode: 200, body: [A1, A2] },
		]);
		const out = await run(ctx);
		expect(out.map((o) => o.json)).toEqual([A1, A2]);
		expect(ctx.calls[0].options.url).toBe('/api/v1/projects/p1/assemblies');
		expect(ctx.calls[0].options.qs).toBeUndefined();
	});

	it('Get Many, Limit : la liste est coupée côté nœud', async () => {
		const ctx = fakeExecute(
			{ resource: 'assembly', operation: 'getAll', projectId: 'p1', returnAll: false, limit: 1 },
			[{ statusCode: 200, body: [A1, A2] }],
		);
		const out = await run(ctx);
		expect(out.map((o) => o.json)).toEqual([A1]);
	});

	it('Create : POST avec nom et documents', async () => {
		const ctx = fakeExecute(
			{ resource: 'assembly', operation: 'create', projectId: 'p1', name: 'ARC + STR', fileIds: 'f1, f2' },
			[{ statusCode: 201, body: A1 }],
		);
		const out = await run(ctx);
		expect(out.map((o) => o.json)).toEqual([A1]);
		expect(ctx.calls[0].options.method).toBe('POST');
		expect(ctx.calls[0].options.url).toBe('/api/v1/projects/p1/assemblies');
		expect(ctx.calls[0].options.body).toEqual({ name: 'ARC + STR', fileIds: ['f1', 'f2'] });
	});

	it('Create sans document : refusé AVANT tout appel', async () => {
		const ctx = fakeExecute({ resource: 'assembly', operation: 'create', projectId: 'p1', name: 'X', fileIds: ' , ' });
		await expect(run(ctx)).rejects.toThrow(/at least one document/);
		expect(ctx.calls).toHaveLength(0);
	});

	it('Create : un refus du serveur remonte par son code', async () => {
		const ctx = fakeExecute(
			{ resource: 'assembly', operation: 'create', projectId: 'p1', name: 'X', fileIds: 'c1' },
			[{ statusCode: 400, body: { code: 'WRONG_PROJECT', detail: 'x' } }],
		);
		await expect(run(ctx)).rejects.toThrow(/\[WRONG_PROJECT\]/);
	});

	it('Update : PATCH du seul nom, la composition n’est pas envoyée', async () => {
		const ctx = fakeExecute(
			{ resource: 'assembly', operation: 'update', assemblyId: 'a1', updateFields: { name: 'Nouveau' } },
			[{ statusCode: 200, body: { ...A1, name: 'Nouveau' } }],
		);
		await run(ctx);
		expect(ctx.calls[0].options.method).toBe('PATCH');
		expect(ctx.calls[0].options.url).toBe('/api/v1/assemblies/a1');
		expect(ctx.calls[0].options.body).toEqual({ name: 'Nouveau' });
	});

	it('Update : « Document IDs » vide remplace par une composition vide', async () => {
		const ctx = fakeExecute(
			{ resource: 'assembly', operation: 'update', assemblyId: 'a1', updateFields: { fileIds: '' } },
			[{ statusCode: 200, body: { ...A1, fileIds: [] } }],
		);
		await run(ctx);
		expect(ctx.calls[0].options.body).toEqual({ fileIds: [] });
	});

	it('Update sans champ : refusé AVANT tout appel', async () => {
		const ctx = fakeExecute({ resource: 'assembly', operation: 'update', assemblyId: 'a1', updateFields: {} });
		await expect(run(ctx)).rejects.toThrow(/Nothing to update/);
		expect(ctx.calls).toHaveLength(0);
	});
});
