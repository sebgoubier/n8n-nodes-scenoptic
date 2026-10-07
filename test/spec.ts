// Copie de la spec publique du CDE (`/api/openapi.json`) : la source de vérité. Une copie, pour
// que le paquet se teste seul hors du dépôt Scenoptic ; le dépôt Scenoptic en vérifie la fraîcheur.
// Import JSON relatif plutôt que `node:fs` : le lint n8n (mode strict) l'interdit, tests compris.
import openapi from './fixtures/openapi.json';

interface SpecOperation {
	security?: Array<Record<string, unknown>>;
}

interface SpecWebhook {
	post: {
		requestBody: { content: Record<string, { examples?: Record<string, { value: unknown }> }> };
	};
}

export interface OpenApiSpec {
	paths: Record<string, Record<string, SpecOperation>>;
	webhooks: Record<string, SpecWebhook>;
}

export function loadSpec(): OpenApiSpec {
	return openapi as unknown as OpenApiSpec;
}
