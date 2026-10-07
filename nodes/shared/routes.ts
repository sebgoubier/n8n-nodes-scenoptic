import type { IHttpRequestMethods } from 'n8n-workflow';

/**
 * Toutes les routes Scenoptic que le paquet appelle, et AUCUNE autre : chaque appel passe par
 * cette table. `test/routes.test.ts` vérifie que chacune figure dans la spec publique
 * (`/api/openapi.json`, copiée dans `test/fixtures/`) et n'y est pas réservée à la session (cookie).
 *
 * Seules exceptions, hors de l'API : les URL présignées des parties d'un dépôt et les liens
 * signés des artefacts. Le paquet ne les construit jamais, il les reçoit de ces routes et les
 * appelle SANS le jeton (`shared/storage.ts`).
 *
 * Les chemins suivent la notation de la spec (`{param}`), ce qui permet la comparaison directe.
 */
export interface ScenopticRoute {
	method: IHttpRequestMethods;
	path: string;
}

export const ROUTES = {
	currentUser: { method: 'GET', path: '/foundation/1.1/current-user' },
	listProjects: { method: 'GET', path: '/api/v1/projects' },

	createWebhook: { method: 'POST', path: '/api/v1/projects/{id}/webhooks' },
	getWebhook: { method: 'GET', path: '/api/v1/projects/{id}/webhooks/{wid}' },
	deleteWebhook: { method: 'DELETE', path: '/api/v1/projects/{id}/webhooks/{wid}' },

	listTopics: { method: 'GET', path: '/bcf/3.0/projects/{project_id}/topics' },
	createTopic: { method: 'POST', path: '/bcf/3.0/projects/{project_id}/topics' },
	getTopic: { method: 'GET', path: '/bcf/3.0/projects/{project_id}/topics/{guid}' },
	updateTopic: { method: 'PUT', path: '/bcf/3.0/projects/{project_id}/topics/{guid}' },

	getTree: { method: 'GET', path: '/api/v1/projects/{id}/tree' },
	createFolder: { method: 'POST', path: '/api/v1/projects/{id}/folders' },
	createFile: { method: 'POST', path: '/api/v1/projects/{id}/files' },
	presignFileParts: { method: 'POST', path: '/api/v1/files/{id}/parts' },
	confirmFileUpload: { method: 'POST', path: '/api/v1/files/{id}/uploaded' },
	getFile: { method: 'GET', path: '/api/v1/files/{id}' },
	nativeDownloadUrl: { method: 'POST', path: '/api/v1/files/{id}/native/download-url' },

	listAssemblies: { method: 'GET', path: '/api/v1/projects/{id}/assemblies' },
	createAssembly: { method: 'POST', path: '/api/v1/projects/{id}/assemblies' },
	getAssembly: { method: 'GET', path: '/api/v1/assemblies/{id}' },
	updateAssembly: { method: 'PATCH', path: '/api/v1/assemblies/{id}' },

	createConversion: { method: 'POST', path: '/api/v1/projects/{id}/conversions' },
	listConversions: { method: 'GET', path: '/api/v1/projects/{id}/conversions' },
	getConversion: { method: 'GET', path: '/api/v1/conversions/{id}' },
	presignConversionParts: { method: 'POST', path: '/api/v1/conversions/{id}/parts' },
	confirmConversionUpload: { method: 'POST', path: '/api/v1/conversions/{id}/uploaded' },

	listComments: { method: 'GET', path: '/bcf/3.0/projects/{project_id}/topics/{topic_guid}/comments' },
	createComment: {
		method: 'POST',
		path: '/bcf/3.0/projects/{project_id}/topics/{topic_guid}/comments',
	},
} as const satisfies Record<string, ScenopticRoute>;

/** Remplace chaque `{param}` par sa valeur encodée ; un paramètre manquant est une erreur. */
export function buildPath(route: ScenopticRoute, params: Record<string, string> = {}): string {
	return route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = params[name];
		if (value === undefined || value === '') {
			throw new Error(`Missing path parameter "${name}" for ${route.method} ${route.path}`);
		}
		return encodeURIComponent(value);
	});
}

/** URL de base sans barre oblique finale (`https://x/` et `https://x` donnent la même URL). */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}
