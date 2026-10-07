import { describe, expect, it } from 'vitest';

import { PROBLEM_MESSAGES } from '../nodes/shared/problem';
import { ROUTES } from '../nodes/shared/routes';
import { CREDENTIAL_NAME, ScenopticApiError, scenopticApiRequest } from '../nodes/shared/transport';
import { fakeApi } from './fakes';

type Ctx = ThisParameterType<typeof scenopticApiRequest>;

describe('scenopticApiRequest', () => {
	it('appelle la route avec la credential, sans barre oblique finale, et rend le corps', async () => {
		const api = fakeApi([{ statusCode: 200, body: [{ id: 'p1' }] }]);
		const out = await scenopticApiRequest.call(api as unknown as Ctx, ROUTES.listProjects, {
			qs: { limit: 5 },
		});
		expect(out).toEqual([{ id: 'p1' }]);
		expect(api.calls).toHaveLength(1);
		expect(api.calls[0].credential).toBe(CREDENTIAL_NAME);
		expect(api.calls[0].options).toMatchObject({
			method: 'GET',
			baseURL: 'https://cde.example.com',
			url: '/api/v1/projects',
			qs: { limit: 5 },
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
	});

	it('transforme un problem+json en NodeApiError lisible, par code', async () => {
		const api = fakeApi([
			{
				statusCode: 403,
				body: { code: 'INSUFFICIENT_SCOPE', detail: 'Scope bcf:write requis', details: { required: 'bcf:write' } },
			},
		]);
		const err = await scenopticApiRequest
			.call(api as unknown as Ctx, ROUTES.createTopic, {
				params: { project_id: 'p1' },
				body: { title: 't' },
				itemIndex: 2,
			})
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ScenopticApiError);
		const e = err as ScenopticApiError;
		expect(e.message).toBe(`${PROBLEM_MESSAGES.INSUFFICIENT_SCOPE} (bcf:write) [INSUFFICIENT_SCOPE]`);
		expect(e.httpCode).toBe('403');
		expect(e.description).toBe('Scope bcf:write requis');
		expect(e.problem.code).toBe('INSUFFICIENT_SCOPE');
		expect(e.context.itemIndex).toBe(2);
	});

	it('un 2xx sans corps (204) ne lève pas', async () => {
		const api = fakeApi([{ statusCode: 204 }]);
		await expect(
			scenopticApiRequest.call(api as unknown as Ctx, ROUTES.deleteWebhook, {
				params: { id: 'p', wid: 'w' },
			}),
		).resolves.toBeNull();
	});
});
