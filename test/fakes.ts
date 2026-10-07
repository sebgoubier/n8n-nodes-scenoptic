import type { IHttpRequestOptions, IN8nHttpFullResponse, INode } from 'n8n-workflow';

/** Réponse simulée de l'API Scenoptic. */
export interface FakeResponse {
	statusCode: number;
	body?: unknown;
}

export const FAKE_NODE: INode = {
	id: 'node-1',
	name: 'Scenoptic',
	type: 'n8n-nodes-scenoptic.scenoptic',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/**
 * Serveur Scenoptic simulé : chaque appel est consigné (credential, options) et reçoit la
 * prochaine réponse de la file. Une file vide est une erreur de test, pas un 200 implicite.
 */
export function fakeApi(responses: FakeResponse[] = []) {
	const calls: Array<{ credential: string; options: IHttpRequestOptions }> = [];
	const queue = [...responses];
	const httpRequestWithAuthentication = async (
		credential: string,
		options: IHttpRequestOptions,
	): Promise<IN8nHttpFullResponse> => {
		calls.push({ credential, options });
		const next = queue.shift();
		if (!next) throw new Error(`Appel inattendu : ${options.method} ${options.url}`);
		return { statusCode: next.statusCode, body: (next.body ?? null) as never, headers: {} };
	};
	return {
		calls,
		queue,
		push: (...more: FakeResponse[]) => queue.push(...more),
		helpers: { httpRequestWithAuthentication },
		getCredentials: async () => ({ baseUrl: 'https://cde.example.com/', accessToken: 'scn_pat_test' }),
		getNode: () => FAKE_NODE,
	};
}

/**
 * Contexte d'exécution n8n simulé : paramètres par nom (identiques pour tous les items), API
 * simulée, `continueOnFail` réglable.
 */
export function fakeExecute(
	params: Record<string, unknown>,
	responses: FakeResponse[] = [],
	options: {
		items?: number;
		continueOnFail?: boolean;
		/** Binaire n8n du champ `data` de chaque élément. */
		binary?: { data: Buffer; fileName?: string; mimeType?: string };
		/** Réponses du stockage (URL présignées, liens signés), appelé SANS credential. */
		storage?: FakeResponse[];
	} = {},
) {
	const api = fakeApi(responses);
	const storage = fakeStorage(options.storage);
	const binaryField = (property: string) => {
		if (property !== 'data' || !options.binary) throw new Error(`No binary data in "${property}"`);
		return options.binary;
	};
	return {
		...api,
		storageCalls: storage.calls,
		helpers: {
			...api.helpers,
			httpRequest: storage.httpRequest,
			assertBinaryData: (_i: number, property: string) => {
				const { fileName, mimeType } = binaryField(property);
				return { data: '', mimeType: mimeType ?? 'application/octet-stream', fileName };
			},
			getBinaryDataBuffer: async (_i: number, property: string) => binaryField(property).data,
			prepareBinaryData: async (data: Buffer, fileName?: string, mimeType?: string) => ({
				data: data.toString('base64'),
				fileName,
				mimeType: mimeType ?? 'application/octet-stream',
			}),
		},
		getInputData: () => Array.from({ length: options.items ?? 1 }, () => ({ json: {} })),
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Paramètre inattendu : ${name}`);
		},
		continueOnFail: () => options.continueOnFail ?? false,
	};
}

/**
 * Stockage simulé (URL présignées, liens signés) : appelé par `helpers.httpRequest`, donc
 * sans credential. Chaque appel est consigné ; une file vide est une erreur de test.
 */
export function fakeStorage(responses: FakeResponse[] = []) {
	const calls: IHttpRequestOptions[] = [];
	const queue = [...responses];
	const httpRequest = async (options: IHttpRequestOptions): Promise<IN8nHttpFullResponse> => {
		calls.push(options);
		const next = queue.shift();
		if (!next) throw new Error(`Appel inattendu au stockage : ${options.method} ${options.url}`);
		return { statusCode: next.statusCode, body: (next.body ?? '') as never, headers: {} };
	};
	return { calls, httpRequest };
}

/** Contexte des listes dynamiques (`loadOptions`) : paramètres courants du nœud. */
export function fakeLoadOptions(current: Record<string, unknown>, responses: FakeResponse[] = []) {
	const api = fakeApi(responses);
	return { ...api, getCurrentNodeParameter: (name: string) => current[name] };
}

/** Journal n8n simulé : chaque appel est gardé, pour vérifier qu'aucun secret n'y passe. */
export function fakeLogger() {
	const lines: unknown[][] = [];
	const log = (...args: unknown[]) => {
		lines.push(args);
	};
	return { lines, logger: { debug: log, info: log, warn: log, error: log, verbose: log } };
}

/** Contexte des méthodes de cycle de vie d'un webhook (`checkExists` / `create` / `delete`). */
export function fakeHook(
	params: Record<string, unknown>,
	staticData: Record<string, unknown>,
	responses: FakeResponse[] = [],
	webhookUrl = 'https://n8n.example.com/webhook/abc/webhook',
) {
	const api = fakeApi(responses);
	const { lines, logger } = fakeLogger();
	return {
		...api,
		logLines: lines,
		logger,
		staticData,
		getNodeParameter: (name: string, fallback?: unknown) => {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Paramètre inattendu : ${name}`);
		},
		getNodeWebhookUrl: () => webhookUrl,
		getWorkflowStaticData: () => staticData,
		getWorkflow: () => ({ id: 'wf1', name: 'Topic assigned to Teams', active: true }),
	};
}

/** Réponse Express simulée : statut et corps envoyés par le nœud lui-même. */
export function fakeResponse() {
	const res = {
		statusCode: 0,
		body: undefined as unknown,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
	};
	return res;
}

/** Contexte de la méthode `webhook` : requête entrante (corps brut + en-têtes). */
export function fakeWebhook(options: {
	staticData: Record<string, unknown>;
	rawBody?: unknown;
	headers?: Record<string, string>;
	params?: Record<string, unknown>;
}) {
	const res = fakeResponse();
	const { lines, logger } = fakeLogger();
	return {
		res,
		logLines: lines,
		logger,
		getRequestObject: () => ({ rawBody: options.rawBody }),
		getResponseObject: () => res,
		getHeaderData: () => options.headers ?? {},
		getWorkflowStaticData: () => options.staticData,
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in (options.params ?? {}) ? options.params?.[name] : fallback,
		getNode: () => FAKE_NODE,
		helpers: {
			returnJsonArray: (items: Array<Record<string, unknown>>) => items.map((json) => ({ json })),
		},
	};
}
