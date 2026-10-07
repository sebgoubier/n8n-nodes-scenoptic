import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { getProjects } from '../nodes/shared/projects';
import { fakeApi, fakeExecute } from './fakes';

const P1 = { id: 'p1', name: 'Zeta' };
const P2 = { id: 'p2', name: 'Alpha' };

describe('getProjects (liste dynamique)', () => {
	it('rend nom/valeur, triés par nom', async () => {
		const api = fakeApi([{ statusCode: 200, body: [P1, P2] }]);
		const out = await getProjects.call(api as unknown as ILoadOptionsFunctions);
		expect(out).toEqual([
			{ name: 'Alpha', value: 'p2' },
			{ name: 'Zeta', value: 'p1' },
		]);
		expect(api.calls[0].options.qs).toBeUndefined();
	});
});

describe('Scenoptic › Project › Get Many', () => {
	const node = new Scenoptic();

	it('Return All : tableau complet, sans pagination', async () => {
		const ctx = fakeExecute({ resource: 'project', operation: 'getAll', returnAll: true }, [
			{ statusCode: 200, body: [P1, P2] },
		]);
		const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
		expect(out.map((o) => o.json)).toEqual([P1, P2]);
		expect(ctx.calls[0].options.qs).toBeUndefined();
	});

	it('Limit : page `items`', async () => {
		const ctx = fakeExecute({ resource: 'project', operation: 'getAll', returnAll: false, limit: 1 }, [
			{ statusCode: 200, body: { items: [P1], next_cursor: 'c' } },
		]);
		const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
		expect(out.map((o) => o.json)).toEqual([P1]);
		expect(ctx.calls[0].options.qs).toEqual({ limit: 1 });
	});

	it('continueOnFail : l’erreur (par code) devient un item', async () => {
		const ctx = fakeExecute(
			{ resource: 'project', operation: 'getAll', returnAll: true },
			[{ statusCode: 401, body: { code: 'UNAUTHENTICATED', detail: 'x' } }],
			{ continueOnFail: true },
		);
		const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
		expect(out).toHaveLength(1);
		expect(String(out[0].json.error)).toContain('[UNAUTHENTICATED]');
	});
});
