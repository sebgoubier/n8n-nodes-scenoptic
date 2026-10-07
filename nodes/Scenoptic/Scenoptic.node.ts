import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getFolders } from '../shared/folders';
import { getProjects } from '../shared/projects';
import { asNodeError } from '../shared/transport';
import { assemblyProperties, executeAssembly } from './resources/assembly';
import { commentProperties, executeComment } from './resources/comment';
import { conversionProperties, executeConversion } from './resources/conversion';
import { documentProperties, executeDocument } from './resources/document';
import { executeProject, projectProperties } from './resources/project';
import { executeTopic, topicProperties } from './resources/topic';

/**
 * Nœud d'action Scenoptic. Style programmatique et non déclaratif : la mise à jour d'un topic
 * est un GET puis un PUT (le PUT BCF efface tout champ omis), et chaque erreur doit passer par
 * le `code` du problem+json, ce que le routage déclaratif ne permet pas.
 */
export class Scenoptic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scenoptic',
		name: 'scenoptic',
		icon: { light: 'file:../../icons/scenoptic.svg', dark: 'file:../../icons/scenoptic.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with Scenoptic CDE projects, documents, assemblies, conversions and BCF issues',
		defaults: { name: 'Scenoptic' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scenopticApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Assembly', value: 'assembly' },
					{ name: 'Comment', value: 'comment' },
					{ name: 'Conversion', value: 'conversion' },
					{ name: 'Document', value: 'document' },
					{ name: 'Project', value: 'project' },
					{ name: 'Topic', value: 'topic' },
				],
				default: 'topic',
			},
			...topicProperties,
			...commentProperties,
			...conversionProperties,
			...documentProperties,
			...projectProperties,
			...assemblyProperties,
		],
	};

	methods = {
		loadOptions: { getFolders, getProjects },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let results: IDataObject[];
				if (resource === 'conversion') {
					// Seule ressource qui rend des binaires (Download Artifact) : éléments n8n complets.
					const executed = await executeConversion.call(this, operation, i);
					for (const item of executed) returnData.push({ ...item, pairedItem: { item: i } });
					continue;
				}
				if (resource === 'topic') {
					results = await executeTopic.call(this, operation, i);
				} else if (resource === 'comment') {
					results = await executeComment.call(this, operation, i);
				} else if (resource === 'document') {
					results = await executeDocument.call(this, operation, i);
				} else if (resource === 'project') {
					results = await executeProject.call(this, operation, i);
				} else if (resource === 'assembly') {
					results = await executeAssembly.call(this, operation, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
						itemIndex: i,
					});
				}
				for (const json of results) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
