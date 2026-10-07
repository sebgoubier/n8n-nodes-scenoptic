/**
 * Lecture des erreurs Scenoptic (`application/problem+json`, RFC 9457).
 *
 * ⛔ Toute décision se prend sur `code`, le code métier stable. `detail` est un texte libre que
 * le serveur peut reformuler à tout moment : on l'affiche en description, on ne le teste jamais.
 */

export interface ScenopticProblem {
	status: number;
	/** Code métier, ou `HTTP_<status>` si le corps n'en porte pas (proxy, page d'erreur HTML…). */
	code: string;
	/** Texte lisible du serveur, pour l'affichage seulement. */
	detail?: string;
	/** Scope manquant, rendu par `INSUFFICIENT_SCOPE` dans `details.required`. */
	requiredScope?: string;
}

/** Messages affichés dans n8n, par code. Un code absent retombe sur un message générique. */
export const PROBLEM_MESSAGES: Record<string, string> = {
	UNAUTHENTICATED: 'The access token is invalid, expired or revoked',
	INSUFFICIENT_SCOPE: 'The access token is missing a required scope',
	SESSION_REQUIRED: 'This Scenoptic route cannot be used with an access token',
	INSUFFICIENT_ROLE: 'Your role in this project does not allow this action',
	NOT_AUTHOR: 'Only the author can change this item',
	TOKEN_PROJECT_FORBIDDEN: 'The access token is not allowed on this project',
	PROJECT_NOT_FOUND: 'Project not found, or not reachable with this access token',
	TOPIC_NOT_FOUND: 'Topic not found',
	COMMENT_NOT_FOUND: 'Comment not found',
	WEBHOOK_NOT_FOUND: 'Webhook subscription not found',
	WEBHOOK_URL_FORBIDDEN:
		'Scenoptic refused the webhook URL: it must be public HTTPS (port 443 or 8443). Set WEBHOOK_URL on your n8n instance to a public HTTPS address.',
	WEBHOOK_LIMIT_REACHED: 'This project already has the maximum number of webhook subscriptions',
	WEBHOOK_EVENT_TYPE_INVALID: 'Unknown webhook event type',
	BCF_EXTENSIONS: 'A value is not allowed by the project BCF extensions (type, status, priority, stage or label)',
	BCF_ODATA: 'The filter or sort expression is not supported',
	BCF_COMMENT: 'The comment is invalid',
	RATE_LIMITED: 'Too many requests to Scenoptic, retry later',
	FILE_NOT_FOUND: 'Document not found',
	FOLDER_NOT_FOUND: 'Folder not found',
	WRONG_PROJECT: 'The folder belongs to another project',
	QUOTA_FILES: 'The project owner has reached their maximum number of documents',
	QUOTA_BYTES: 'The project owner has reached their storage quota',
	FILE_TOO_LARGE: 'The file is larger than Scenoptic accepts',
	BAD_SIZE: 'The file is empty or its size is invalid',
	UNSUPPORTED_FORMAT: 'Scenoptic cannot convert this file format',
	BAD_STATE: 'The document is not in a state that allows this action',
	NATIVE_MISSING: 'The original file is not in storage (yet)',
	NATIVE_NOT_HOSTED: 'The original file is kept by a third-party storage provider, not by Scenoptic',
	NATIVE_LOCAL: "The original file stayed on its author's computer",
	CONVERSION_NOT_FOUND: 'Conversion not found',
	INVALID_EXTERNAL_REF: 'The external reference is invalid (control characters are not allowed)',
};

function asObject(body: unknown): Record<string, unknown> | undefined {
	let value = body;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) value = value.toString('utf8');
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function readProblem(status: number, body: unknown): ScenopticProblem {
	const obj = asObject(body);
	const legacy = obj?.error as Record<string, unknown> | undefined;
	const code =
		typeof obj?.code === 'string'
			? obj.code
			: typeof legacy?.code === 'string'
				? legacy.code
				: `HTTP_${status}`;
	const problem: ScenopticProblem = { status, code };
	if (typeof obj?.detail === 'string') problem.detail = obj.detail;
	const details = obj?.details as Record<string, unknown> | undefined;
	if (typeof details?.required === 'string') problem.requiredScope = details.required;
	return problem;
}

export function problemMessage(problem: ScenopticProblem): string {
	const base = PROBLEM_MESSAGES[problem.code] ?? `Scenoptic API error ${problem.status}`;
	const scope = problem.requiredScope ? ` (${problem.requiredScope})` : '';
	return `${base}${scope} [${problem.code}]`;
}
