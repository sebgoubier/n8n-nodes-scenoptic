import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { CONVERSIONS_PAGE_SIZE, conversionBody } from '../nodes/Scenoptic/resources/conversion';
import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { fileNameFromUrl } from '../nodes/shared/storage';
import { waitForConversion } from '../nodes/shared/wait';
import { fakeExecute, type FakeResponse } from './fakes';

const node = new Scenoptic();

type Options = Parameters<typeof fakeExecute>[2];

function context(params: Record<string, unknown>, responses: FakeResponse[], options: Options = {}) {
	return fakeExecute({ resource: 'conversion', projectId: 'p1', ...params }, responses, options);
}

async function run(params: Record<string, unknown>, responses: FakeResponse[], options: Options = {}) {
	const ctx = context(params, responses, options);
	const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
	return { out, calls: ctx.calls.map((c) => c.options), storage: ctx.storageCalls };
}

const conversion = (status: string, extra: IDataObject = {}): FakeResponse => ({
	statusCode: 200,
	body: { id: 'c1', name: 'R+1.ifc', status, error: null, artifacts: [], ...extra },
});

const CREATED: FakeResponse = {
	statusCode: 201,
	body: {
		id: 'c1',
		status: 'pending_upload',
		upload: { part_size: 4, part_count: 2 },
		links: { self: '/api/v1/conversions/c1', parts: '/api/v1/conversions/c1/parts', uploaded: '/api/v1/conversions/c1/uploaded' },
	},
};

const SIGNED: FakeResponse = {
	statusCode: 200,
	body: {
		parts: [
			{ n: 1, url: 'https://s3.example.com/c1?partNumber=1' },
			{ n: 2, url: 'https://s3.example.com/c1?partNumber=2' },
		],
	},
};

const BINARY = { binary: { data: Buffer.from('012345'), fileName: 'R+1.ifc' } };
const STORED = { storage: [{ statusCode: 200 }, { statusCode: 200 }] };

describe('Conversion > Convert', () => {
	const params = { operation: 'convert', binaryPropertyName: 'data', options: {}, waitForCompletion: false };

	it('crée la conversion, dépose les parties sur SES URL, confirme, sans attendre', async () => {
		const { out, calls, storage } = await run(
			{ ...params, options: { externalRef: ' mail:<abc@example.com> ', retentionDays: 7 } },
			[CREATED, SIGNED, { ...conversion('uploaded'), statusCode: 202 }],
			{ ...BINARY, ...STORED },
		);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'POST /api/v1/projects/p1/conversions',
			'POST /api/v1/conversions/c1/parts',
			'POST /api/v1/conversions/c1/uploaded',
		]);
		expect(calls[0].body).toEqual({
			name: 'R+1.ifc',
			size_bytes: 6,
			external_ref: 'mail:<abc@example.com>',
			retention_days: 7,
		});
		expect(storage.map((s) => (s.body as Buffer).toString())).toEqual(['0123', '45']);
		expect(out.map((o) => o.json.status)).toEqual(['uploaded']);
	});

	it('sans option : ni external_ref ni retention_days (défaut du serveur)', () => {
		expect(conversionBody('a.ifc', 3, { externalRef: '  ' })).toEqual({ name: 'a.ifc', size_bytes: 3 });
	});

	it('Wait for Completion : relit jusqu’à ready et rend la conversion finale', async () => {
		const { out, calls } = await run(
			{ ...params, waitForCompletion: true, maxWait: 5, pollInterval: 0.001 },
			[
				CREATED,
				SIGNED,
				{ ...conversion('uploaded'), statusCode: 202 },
				conversion('converting'),
				conversion('ready', { artifacts: [{ kind: 'glb', size_bytes: 9, url: 'https://cde.example.com/a/model.glb?sig=s' }] }),
			],
			{ ...BINARY, ...STORED },
		);
		expect(calls.slice(3).map((c) => `${c.method} ${c.url}`)).toEqual([
			'GET /api/v1/conversions/c1',
			'GET /api/v1/conversions/c1',
		]);
		expect(out.map((o) => o.json.status)).toEqual(['ready']);
	});

	it('Wait for Completion : une conversion en erreur est rendue, pas levée', async () => {
		const { out } = await run(
			{ ...params, waitForCompletion: true, maxWait: 5, pollInterval: 0.001 },
			[
				CREATED,
				SIGNED,
				{ ...conversion('uploaded'), statusCode: 202 },
				conversion('error', { error: { code: 'CONVERSION_FAILED', message: 'Conversion failed' } }),
			],
			{ ...BINARY, ...STORED },
		);
		expect(out[0].json).toMatchObject({ status: 'error', error: { code: 'CONVERSION_FAILED' } });
	});

	it('Wait for Completion : délai dépassé = erreur lisible avec l’id de la conversion', async () => {
		const ctx = context(
			{ ...params, waitForCompletion: true, maxWait: 0.02, pollInterval: 0.005 },
			[
				CREATED,
				SIGNED,
				{ ...conversion('uploaded'), statusCode: 202 },
				...Array.from({ length: 20 }, () => conversion('converting')),
			],
			{ ...BINARY, ...STORED },
		);
		const error = (await node.execute.call(ctx as unknown as IExecuteFunctions).catch((e: unknown) => e)) as {
			message: string;
			description: string;
		};
		expect(error.message).toBe('Conversion is still "converting" after 0.02 s');
		expect(error.description).toContain('c1');
		expect(error.description).toContain('Scenoptic Trigger');
	});

	it('jeton sans conversions:write : erreur lisible', async () => {
		await expect(
			run(
				params,
				[
					{
						statusCode: 403,
						body: { status: 403, code: 'INSUFFICIENT_SCOPE', details: { required: 'conversions:write' } },
					},
				],
				BINARY,
			),
		).rejects.toThrow('The access token is missing a required scope (conversions:write) [INSUFFICIENT_SCOPE]');
	});
});

describe('Attente bornée', () => {
	/** Horloge simulée : `sleep` avance l'horloge, rien n'attend vraiment. */
	function clock(start = 0) {
		let t = start;
		return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
	}

	/** Lecture qui reste `converting` ; au-delà de 1 000 lectures, la boucle est déclarée sans fin. */
	function stuck() {
		let reads = 0;
		const read = async () => {
			reads++;
			if (reads > 1000) throw new Error('boucle sans fin');
			return { status: 'converting' };
		};
		return { read, reads: () => reads };
	}

	it('s’arrête au délai : 60 s par pas de 10 s = 6 relectures', async () => {
		const c = clock();
		const s = stuck();
		const result = await waitForConversion(s.read, { status: 'uploaded' }, {
			maxWaitMs: 60_000,
			intervalMs: 10_000,
			...c,
		});
		expect(result.timedOut).toBe(true);
		expect(s.reads()).toBe(6);
		expect(c.now()).toBe(60_000);
	});

	it('borne aussi le nombre de relectures quand l’horloge n’avance pas', async () => {
		const s = stuck();
		const result = await waitForConversion(s.read, { status: 'uploaded' }, {
			maxWaitMs: 60_000,
			intervalMs: 10_000,
			now: () => 0,
			sleep: async () => {},
		});
		expect(result.timedOut).toBe(true);
		expect(s.reads()).toBe(7);
	});

	it('le dernier sommeil ne dépasse pas l’échéance', async () => {
		const c = clock();
		const slept: number[] = [];
		await waitForConversion(stuck().read, { status: 'uploaded' }, {
			maxWaitMs: 25_000,
			intervalMs: 10_000,
			now: c.now,
			sleep: async (ms) => {
				slept.push(ms);
				c.advance(ms);
			},
		});
		expect(slept).toEqual([10_000, 10_000, 5_000]);
	});

	it.each(['ready', 'error'])('statut final %s : rendu sans relire', async (status) => {
		const s = stuck();
		const result = await waitForConversion(s.read, { status }, { maxWaitMs: 1000, intervalMs: 10, ...clock() });
		expect(result).toEqual({ conversion: { status }, timedOut: false });
		expect(s.reads()).toBe(0);
	});
});

describe('Conversion > Get, Get Many', () => {
	it('Get', async () => {
		const { out, calls } = await run({ operation: 'get', conversionId: 'c1' }, [conversion('ready')]);
		expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/conversions/c1' });
		expect(out[0].json.id).toBe('c1');
	});

	it('conversion inconnue : erreur lisible', async () => {
		await expect(
			run({ operation: 'get', conversionId: 'zz' }, [
				{ statusCode: 404, body: { status: 404, code: 'CONVERSION_NOT_FOUND' } },
			]),
		).rejects.toThrow('Conversion not found [CONVERSION_NOT_FOUND]');
	});

	it('Get Many filtré par external_ref et statut, une page de Limit', async () => {
		const { out, calls } = await run(
			{ operation: 'getAll', returnAll: false, limit: 5, filters: { externalRef: 'mail:<abc>', status: 'error' } },
			[{ statusCode: 200, body: { items: [{ id: 'c1' }], next_cursor: 'k2' } }],
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			url: '/api/v1/projects/p1/conversions',
			qs: { limit: 5, external_ref: 'mail:<abc>', status: 'error' },
		});
		expect(out.map((o) => o.json.id)).toEqual(['c1']);
	});

	it('Get Many, Return All : suit next_cursor jusqu’à null', async () => {
		const { out, calls } = await run({ operation: 'getAll', returnAll: true, filters: {} }, [
			{ statusCode: 200, body: { items: [{ id: 'c1' }, { id: 'c2' }], next_cursor: 'k2' } },
			{ statusCode: 200, body: { items: [{ id: 'c3' }], next_cursor: null } },
		]);
		expect(calls.map((c) => c.qs)).toEqual([
			{ limit: CONVERSIONS_PAGE_SIZE },
			{ limit: CONVERSIONS_PAGE_SIZE, cursor: 'k2' },
		]);
		expect(out.map((o) => o.json.id)).toEqual(['c1', 'c2', 'c3']);
	});
});

describe('Conversion > Download Artifact', () => {
	const READY = conversion('ready', {
		artifacts: [
			{ kind: 'glb', size_bytes: 4, url: 'https://cde.example.com/artifacts/projects/p1/c1/model.glb?sig=secret' },
			{ kind: 'properties', size_bytes: 2, url: 'https://cde.example.com/artifacts/projects/p1/c1/props.arrow?sig=secret' },
		],
	});
	const params = { operation: 'downloadArtifact', conversionId: 'c1', artifactKind: 'glb', binaryPropertyName: 'model' };

	it('relit la conversion et télécharge le lien signé, sans jeton, dans le champ binaire choisi', async () => {
		const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer;
		const { out, calls, storage } = await run(params, [READY], { storage: [{ statusCode: 200, body: glb }] });
		expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/conversions/c1' });
		expect(storage).toHaveLength(1);
		expect(storage[0]).toMatchObject({
			method: 'GET',
			url: 'https://cde.example.com/artifacts/projects/p1/c1/model.glb?sig=secret',
			encoding: 'arraybuffer',
		});
		expect(Object.keys(storage[0].headers ?? {})).toEqual([]);
		expect(out[0].json).toEqual({ conversionId: 'c1', kind: 'glb', size_bytes: 4, fileName: 'model.glb' });
		expect(Buffer.from(String(out[0].binary?.model.data), 'base64').toString()).toBe('glTF');
		expect(out[0].binary?.model.fileName).toBe('model.glb');
	});

	it('conversion pas prête : erreur, aucun téléchargement', async () => {
		const ctx = context(params, [conversion('converting')]);
		await expect(node.execute.call(ctx as unknown as IExecuteFunctions)).rejects.toThrow(
			'Conversion is "converting", not ready',
		);
		expect(ctx.storageCalls).toHaveLength(0);
	});

	it('nature absente : erreur qui liste les natures disponibles', async () => {
		const error = (await run({ ...params, artifactKind: 'pdf' }, [READY]).catch((e: unknown) => e)) as {
			message: string;
			description: string;
		};
		expect(error.message).toBe('This conversion has no "pdf" artifact');
		expect(error.description).toBe('Available kinds: glb, properties');
	});

	it('lien refusé : erreur sans le lien signé', async () => {
		const error = await run(params, [READY], { storage: [{ statusCode: 403 }] }).catch((e: unknown) => e);
		expect((error as Error).message).toBe('Download of the "glb" artifact failed (HTTP 403)');
		expect(JSON.stringify(error)).not.toContain('sig=secret');
	});

	it('nom de fichier tiré du lien, sinon valeur de repli', () => {
		expect(fileNameFromUrl('https://x/a/b/mod%C3%A8le.glb?sig=1', 'f.glb')).toBe('modèle.glb');
		expect(fileNameFromUrl('pas une url', 'f.glb')).toBe('f.glb');
		expect(fileNameFromUrl('https://x/', 'f.glb')).toBe('f.glb');
	});
});
