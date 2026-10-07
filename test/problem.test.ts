import { describe, expect, it } from 'vitest';

import { PROBLEM_MESSAGES, problemMessage, readProblem } from '../nodes/shared/problem';

describe('readProblem', () => {
	it('lit le code du problem+json', () => {
		const p = readProblem(403, {
			type: 'urn:scenoptic:problem:INSUFFICIENT_SCOPE',
			title: 'Forbidden',
			status: 403,
			detail: 'Scope bcf:write requis',
			code: 'INSUFFICIENT_SCOPE',
			details: { required: 'bcf:write' },
		});
		expect(p).toEqual({
			status: 403,
			code: 'INSUFFICIENT_SCOPE',
			detail: 'Scope bcf:write requis',
			requiredScope: 'bcf:write',
		});
		expect(problemMessage(p)).toBe(
			`${PROBLEM_MESSAGES.INSUFFICIENT_SCOPE} (bcf:write) [INSUFFICIENT_SCOPE]`,
		);
	});

	// Mutation « lire detail au lieu de code » : le detail nomme un AUTRE code, le message doit
	// rester celui du `code`.
	it('décide sur code, jamais sur detail', () => {
		const p = readProblem(404, {
			code: 'TOPIC_NOT_FOUND',
			detail: 'WEBHOOK_URL_FORBIDDEN INSUFFICIENT_SCOPE',
		});
		expect(problemMessage(p)).toBe(`${PROBLEM_MESSAGES.TOPIC_NOT_FOUND} [TOPIC_NOT_FOUND]`);
	});

	it('accepte un corps texte ou Buffer (content-type problem+json non décodé)', () => {
		const corps = JSON.stringify({ code: 'WEBHOOK_URL_FORBIDDEN', detail: 'x' });
		expect(readProblem(422, corps).code).toBe('WEBHOOK_URL_FORBIDDEN');
		expect(readProblem(422, Buffer.from(corps)).code).toBe('WEBHOOK_URL_FORBIDDEN');
	});

	it("retombe sur l'ancienne forme error.code", () => {
		expect(readProblem(400, { error: { code: 'BCF_ODATA', message: 'm' } }).code).toBe('BCF_ODATA');
	});

	it('sans code lisible : HTTP_<status> et message générique', () => {
		const p = readProblem(502, '<html>Bad gateway</html>');
		expect(p).toEqual({ status: 502, code: 'HTTP_502' });
		expect(problemMessage(p)).toBe('Scenoptic API error 502 [HTTP_502]');
	});
});
