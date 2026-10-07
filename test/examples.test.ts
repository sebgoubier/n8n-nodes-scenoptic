import type { INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

// Import JSON relatif plutôt que `node:fs` : le lint n8n (mode strict) l'interdit, tests compris.
import emailToConversions from '../examples/email-attachments-to-documents-and-conversions.json';
import topicToEmail from '../examples/topic-assigned-to-email.json';
import { Scenoptic } from '../nodes/Scenoptic/Scenoptic.node';
import { ScenopticTrigger } from '../nodes/ScenopticTrigger/ScenopticTrigger.node';

interface ExampleNode {
	name: string;
	type: string;
	parameters: Record<string, unknown>;
	credentials?: Record<string, unknown>;
}

interface ExampleWorkflow {
	nodes: ExampleNode[];
	connections: Record<string, { main: Array<Array<{ node: string }>> }>;
}

const EXAMPLES: Array<[string, ExampleWorkflow]> = [
	['email-attachments-to-documents-and-conversions', emailToConversions as unknown as ExampleWorkflow],
	['topic-assigned-to-email', topicToEmail as unknown as ExampleWorkflow],
];

const DESCRIPTIONS: Record<string, INodeProperties[]> = {
	'n8n-nodes-scenoptic.scenoptic': new Scenoptic().description.properties,
	'n8n-nodes-scenoptic.scenopticTrigger': new ScenopticTrigger().description.properties,
};

/** Propriété affichée pour ces paramètres (toutes les conditions `show` satisfaites). */
function isShown(property: INodeProperties, parameters: Record<string, unknown>): boolean {
	const show = property.displayOptions?.show ?? {};
	return Object.entries(show).every(([name, values]) =>
		(values as unknown[]).includes(parameters[name] ?? defaultOf(name)),
	);
}

let currentProperties: INodeProperties[] = [];
function defaultOf(name: string): unknown {
	return currentProperties.find((p) => p.name === name)?.default;
}

const isExpression = (value: unknown) => typeof value === 'string' && value.startsWith('=');

/** Écarts entre les paramètres d'un nœud de l'exemple et la description du nœud. */
function problems(node: ExampleNode, properties: INodeProperties[]): string[] {
	currentProperties = properties;
	const out: string[] = [];
	for (const [name, value] of Object.entries(node.parameters)) {
		const property = properties.find((p) => p.name === name && isShown(p, node.parameters));
		if (!property) {
			out.push(`${node.name}: paramètre « ${name} » inconnu ou masqué`);
			continue;
		}
		const options = (property.options ?? []) as Array<{ name: string; value?: unknown }>;
		if (property.type === 'options' && !property.typeOptions?.loadOptionsMethod && !isExpression(value)) {
			if (!options.some((o) => o.value === value)) out.push(`${node.name}: ${name} = ${String(value)} invalide`);
		}
		if (property.type === 'multiOptions') {
			for (const v of value as unknown[]) {
				if (!options.some((o) => o.value === v)) out.push(`${node.name}: ${name} contient ${String(v)} invalide`);
			}
		}
		if (property.type === 'collection') {
			for (const key of Object.keys(value as object)) {
				if (!options.some((o) => o.name === key)) out.push(`${node.name}: ${name}.${key} inconnu`);
			}
		}
	}
	return out;
}

describe.each(EXAMPLES)('exemple %s', (_, workflow) => {
	const names = new Set(workflow.nodes.map((n) => n.name));

	it('les connexions relient des nœuds existants', () => {
		for (const [from, outputs] of Object.entries(workflow.connections)) {
			expect(names.has(from), from).toBe(true);
			for (const target of outputs.main.flat()) expect(names.has(target.node), target.node).toBe(true);
		}
	});

	it('les nœuds Scenoptic n’utilisent que des paramètres et valeurs qui existent', () => {
		const scenoptic = workflow.nodes.filter((n) => DESCRIPTIONS[n.type]);
		expect(scenoptic.length).toBeGreaterThan(0);
		for (const node of scenoptic) {
			expect(problems(node, DESCRIPTIONS[node.type])).toEqual([]);
			expect(Object.keys(node.credentials ?? {})).toEqual(['scenopticApi']);
		}
	});
});

describe('exemple e-mail → documents et conversions', () => {
	const workflow = EXAMPLES[0][1];
	const node = (name: string) => workflow.nodes.find((n) => n.name === name);

	it('la conversion porte la référence du mail et n’attend pas : la réponse part du Trigger', () => {
		expect(node('Convert the model')?.parameters).toMatchObject({
			waitForCompletion: false,
			options: { externalRef: '={{ $json.externalRef }}' },
		});
		expect(node('Conversion finished')?.parameters.events).toEqual([
			'conversion.completed',
			'conversion.failed',
		]);
	});

	it('aucun mail ne recopie le message d’erreur du serveur (#612), seulement son code', () => {
		const mails = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.emailSend');
		expect(mails).toHaveLength(2);
		for (const mail of mails) expect(JSON.stringify(mail.parameters)).not.toMatch(/error\.message|errorMessage/);
		expect(String(node('Reply: failed')?.parameters.html)).toContain('$json.error.code');
	});
});
