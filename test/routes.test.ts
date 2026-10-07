import { describe, expect, it } from 'vitest';

import { ScenopticApi } from '../credentials/ScenopticApi.credentials';
import { buildPath, normalizeBaseUrl, ROUTES } from '../nodes/shared/routes';
import { loadSpec } from './spec';

describe('ROUTES contre la spec publique', () => {
	const spec = loadSpec();

	it.each(Object.entries(ROUTES))('%s est une route publique documentée', (_, route) => {
		const op = spec.paths[route.path]?.[route.method.toLowerCase()];
		expect(op, `${route.method} ${route.path} absente de openapi.json`).toBeDefined();
		// Une route réservée à la session est décrite avec `security: [{ cookieAuth }]` seul.
		const cookieOnly =
			op?.security?.length === 1 && Object.keys(op.security[0]).join() === 'cookieAuth';
		expect(cookieOnly, `${route.method} ${route.path} est réservée à la session`).toBe(false);
	});

	it('le test de la credential appelle la route currentUser', () => {
		const cred = new ScenopticApi();
		expect(cred.test.request.url).toBe(ROUTES.currentUser.path);
		expect(cred.test.request.method).toBe(ROUTES.currentUser.method);
	});
});

describe('buildPath', () => {
	it('encode les paramètres', () => {
		expect(buildPath(ROUTES.getTopic, { project_id: 'p 1', guid: 'a/b' })).toBe(
			'/bcf/3.0/projects/p%201/topics/a%2Fb',
		);
	});

	it('refuse un paramètre manquant ou vide', () => {
		expect(() => buildPath(ROUTES.getTopic, { project_id: 'p' })).toThrow(/guid/);
		expect(() => buildPath(ROUTES.getTopic, { project_id: 'p', guid: '' })).toThrow(/guid/);
	});
});

describe('normalizeBaseUrl', () => {
	it('retire espaces et barres obliques finales', () => {
		expect(normalizeBaseUrl(' https://cde.example.com// ')).toBe('https://cde.example.com');
	});
});
