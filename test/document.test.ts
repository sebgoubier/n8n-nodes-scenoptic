import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { treeItems } from '../nodes/Scenoptic/resources/document';
import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { folderPaths, getFolders } from '../nodes/shared/folders';
import { PARTS_PER_REQUEST } from '../nodes/shared/storage';
import { fakeExecute, fakeLoadOptions, type FakeResponse } from './fakes';

const node = new Scenoptic();

type Options = Parameters<typeof fakeExecute>[2];

async function run(params: Record<string, unknown>, responses: FakeResponse[], options: Options = {}) {
	const ctx = fakeExecute({ resource: 'document', projectId: 'p1', ...params }, responses, options);
	const [out] = await node.execute.call(ctx as unknown as IExecuteFunctions);
	return {
		out: out.map((o) => o.json),
		calls: ctx.calls.map((c) => c.options),
		storage: ctx.storageCalls,
	};
}

/** Réponse de `POST …/parts` pour les parties `from..from+count-1`. */
const signed = (from: number, count: number): FakeResponse => ({
	statusCode: 200,
	body: {
		parts: Array.from({ length: count }, (_, k) => ({
			n: from + k,
			url: `https://s3.example.com/depots/f1?partNumber=${from + k}&X-Amz-Signature=secret${from + k}`,
		})),
	},
});

const UPLOADED_FILE = { id: 'f1', name: 'R+1.ifc', status: 'uploaded', artifacts: [] };

const TREE = {
	project: { id: 'p1', name: 'Projet' },
	folders: [
		{ id: 'a', projectId: 'p1', parentId: null, name: 'Architecture' },
		{ id: 'b', projectId: 'p1', parentId: 'a', name: 'Plans' },
		{ id: 'c', projectId: 'p1', parentId: null, name: 'Structure' },
	],
	files: [
		{ id: 'f0', folderId: null, name: 'Lisez-moi.pdf' },
		{ id: 'f1', folderId: 'b', name: 'R+1.ifc' },
		{ id: 'f2', folderId: 'c', name: 'Poutres.ifc' },
	],
};

describe('Document > Upload', () => {
	const params = { operation: 'upload', folderId: 'b', binaryPropertyName: 'data', options: {} };

	it('crée le fichier, dépose chaque partie sur son URL puis confirme', async () => {
		const data = Buffer.from('0123456789');
		const { out, calls, storage } = await run(
			params,
			[
				{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 3 } },
				signed(1, 3),
				{ statusCode: 202, body: UPLOADED_FILE },
			],
			{ binary: { data, fileName: 'R+1.ifc' }, storage: [{ statusCode: 200 }, { statusCode: 200 }, { statusCode: 200 }] },
		);

		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'POST /api/v1/projects/p1/files',
			'POST /api/v1/files/f1/parts',
			'POST /api/v1/files/f1/uploaded',
		]);
		expect(calls[0].body).toEqual({ name: 'R+1.ifc', sizeBytes: 10, folderId: 'b' });
		expect(calls[1].body).toEqual({ from: 1, count: 3 });

		expect(storage.map((s) => s.method)).toEqual(['PUT', 'PUT', 'PUT']);
		expect(storage.map((s) => s.url)).toEqual([1, 2, 3].map((n) => expect.stringContaining(`partNumber=${n}&`)));
		expect(storage.map((s) => (s.body as Buffer).toString())).toEqual(['0123', '4567', '89']);
		expect(out).toEqual([UPLOADED_FILE]);
	});

	it('n’envoie jamais le jeton au stockage', async () => {
		const { storage } = await run(
			params,
			[
				{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 1 } },
				signed(1, 1),
				{ statusCode: 202, body: UPLOADED_FILE },
			],
			{ binary: { data: Buffer.from('abc'), fileName: 'R+1.ifc' }, storage: [{ statusCode: 200 }] },
		);
		const headers = Object.keys(storage[0].headers ?? {}).map((h) => h.toLowerCase());
		expect(headers).not.toContain('authorization');
		expect(JSON.stringify(storage[0])).not.toContain('scn_pat_test');
	});

	it(`demande les URL par lots de ${PARTS_PER_REQUEST}`, async () => {
		const count = PARTS_PER_REQUEST + 4;
		const { calls, storage } = await run(
			params,
			[
				{ statusCode: 200, body: { fileId: 'f1', partSize: 1, partCount: count } },
				signed(1, PARTS_PER_REQUEST),
				signed(PARTS_PER_REQUEST + 1, 4),
				{ statusCode: 202, body: UPLOADED_FILE },
			],
			{
				binary: { data: Buffer.alloc(count, 1), fileName: 'R+1.ifc' },
				storage: Array.from({ length: count }, () => ({ statusCode: 200 })),
			},
		);
		expect(calls.filter((c) => c.url.endsWith('/parts')).map((c) => c.body)).toEqual([
			{ from: 1, count: PARTS_PER_REQUEST },
			{ from: PARTS_PER_REQUEST + 1, count: 4 },
		]);
		expect(storage).toHaveLength(count);
	});

	it('racine du projet = folderId null ; l’option File Name remplace le nom du binaire', async () => {
		const { calls } = await run(
			{ ...params, folderId: '', options: { fileName: 'Maquette.ifc' } },
			[
				{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 1 } },
				signed(1, 1),
				{ statusCode: 202, body: UPLOADED_FILE },
			],
			{ binary: { data: Buffer.from('abc'), fileName: 'piece-jointe.bin' }, storage: [{ statusCode: 200 }] },
		);
		expect(calls[0].body).toEqual({ name: 'Maquette.ifc', sizeBytes: 3, folderId: null });
	});

	it('refuse un binaire sans nom, avant tout appel', async () => {
		await expect(run(params, [], { binary: { data: Buffer.from('abc') } })).rejects.toThrow(
			'The binary file has no name',
		);
	});

	it('refuse un plan de dépôt incohérent, avant tout envoi', async () => {
		const ctx = fakeExecute({ resource: 'document', projectId: 'p1', ...params }, [
			{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 2 } },
		], { binary: { data: Buffer.from('0123456789'), fileName: 'R+1.ifc' } });
		await expect(node.execute.call(ctx as unknown as IExecuteFunctions)).rejects.toThrow(
			'Unexpected upload plan from Scenoptic',
		);
		expect(ctx.storageCalls).toHaveLength(0);
	});

	it('une partie refusée arrête le dépôt sans le confirmer, et l’URL n’apparaît pas', async () => {
		const ctx = fakeExecute(
			{ resource: 'document', projectId: 'p1', ...params },
			[{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 3 } }, signed(1, 3)],
			{
				binary: { data: Buffer.from('0123456789'), fileName: 'R+1.ifc' },
				storage: [{ statusCode: 200 }, { statusCode: 403, body: '<Error>SignatureDoesNotMatch</Error>' }],
			},
		);
		const error = await node.execute.call(ctx as unknown as IExecuteFunctions).catch((e: Error) => e);
		expect((error as Error).message).toBe('Upload of part 2/3 failed (HTTP 403)');
		expect(JSON.stringify(error)).not.toContain('X-Amz-Signature');
		expect(ctx.calls.map((c) => c.options.url)).not.toContain('/api/v1/files/f1/uploaded');
	});

	it('une partie absente du lot signé est une erreur', async () => {
		await expect(
			run(
				params,
				[
					{ statusCode: 200, body: { fileId: 'f1', partSize: 4, partCount: 2 } },
					{ statusCode: 200, body: { parts: [{ n: 1, url: 'https://s3.example.com/1' }] } },
				],
				{ binary: { data: Buffer.from('012345'), fileName: 'R+1.ifc' }, storage: [{ statusCode: 200 }] },
			),
		).rejects.toThrow('Scenoptic did not sign part 2');
	});

	it('scope manquant : erreur lisible portant le code et le scope', async () => {
		await expect(
			run(
				params,
				[
					{
						statusCode: 403,
						body: { status: 403, code: 'INSUFFICIENT_SCOPE', details: { required: 'files:write' } },
					},
				],
				{ binary: { data: Buffer.from('abc'), fileName: 'R+1.ifc' } },
			),
		).rejects.toThrow('The access token is missing a required scope (files:write) [INSUFFICIENT_SCOPE]');
	});

	it('quota dépassé : erreur lisible, et Continue On Fail rend l’erreur en sortie', async () => {
		const { out } = await run(
			params,
			[{ statusCode: 409, body: { status: 409, code: 'QUOTA_BYTES', detail: 'Votre quota de stockage est atteint.' } }],
			{ binary: { data: Buffer.from('abc'), fileName: 'R+1.ifc' }, continueOnFail: true },
		);
		expect(out).toEqual([{ error: 'The project owner has reached their storage quota [QUOTA_BYTES]' }]);
	});
});

describe('Document > autres opérations', () => {
	it('Get Tree : un élément par dossier et par document, avec type et chemin', async () => {
		const { out, calls } = await run({ operation: 'getTree', treeFolderId: '' }, [
			{ statusCode: 200, body: TREE },
		]);
		expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/projects/p1/tree' });
		expect(out.map((o) => `${o.type} ${o.path}`)).toEqual([
			'folder Architecture',
			'folder Architecture/Plans',
			'folder Structure',
			'document Lisez-moi.pdf',
			'document Architecture/Plans/R+1.ifc',
			'document Structure/Poutres.ifc',
		]);
	});

	it('Get Tree limité à un dossier : ce dossier et ses descendants', () => {
		expect(treeItems(TREE, 'a').map((o) => o.path)).toEqual([
			'Architecture',
			'Architecture/Plans',
			'Architecture/Plans/R+1.ifc',
		]);
	});

	it('Create Folder : parent vide = racine', async () => {
		const folder = { id: 'd', projectId: 'p1', parentId: null, name: 'Mails' };
		const { out, calls } = await run({ operation: 'createFolder', name: 'Mails', parentId: '' }, [
			{ statusCode: 200, body: folder },
		]);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: '/api/v1/projects/p1/folders',
			body: { name: 'Mails', parentId: null },
		});
		expect(out).toEqual([folder]);
	});

	it('Get', async () => {
		const { out, calls } = await run({ operation: 'get', fileId: 'f1' }, [
			{ statusCode: 200, body: UPLOADED_FILE },
		]);
		expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/files/f1' });
		expect(out).toEqual([UPLOADED_FILE]);
	});

	it('Get Download URL', async () => {
		const { out, calls } = await run({ operation: 'getDownloadUrl', fileId: 'f1' }, [
			{ statusCode: 200, body: { url: 'https://s3.example.com/natif?sig=x' } },
		]);
		expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/files/f1/native/download-url' });
		expect(out).toEqual([{ fileId: 'f1', url: 'https://s3.example.com/natif?sig=x' }]);
	});
});

describe('Liste des dossiers', () => {
	it('racine en tête, puis les chemins triés', async () => {
		const ctx = fakeLoadOptions({ projectId: 'p1' }, [{ statusCode: 200, body: TREE }]);
		const options = await getFolders.call(ctx as unknown as ILoadOptionsFunctions);
		expect(options).toEqual([
			{ name: '(Project Root)', value: '' },
			{ name: 'Architecture', value: 'a' },
			{ name: 'Architecture/Plans', value: 'b' },
			{ name: 'Structure', value: 'c' },
		]);
		expect(ctx.calls[0].options.url).toBe('/api/v1/projects/p1/tree');
	});

	it('sans projet choisi : liste vide, aucun appel', async () => {
		const ctx = fakeLoadOptions({ projectId: '' });
		expect(await getFolders.call(ctx as unknown as ILoadOptionsFunctions)).toEqual([]);
		expect(ctx.calls).toHaveLength(0);
	});

	it('un cycle de parents ne boucle pas', () => {
		const paths = folderPaths([
			{ id: 'x', parentId: 'y', name: 'X' },
			{ id: 'y', parentId: 'x', name: 'Y' },
		]);
		expect(paths.get('x')).toBe('Y/X');
	});
});
