import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ScenopticRoute } from '../../shared/routes';
import { uploadParts, type PresignedPart, type UploadPlan } from '../../shared/storage';
import { scenopticApiRequest } from '../../shared/transport';

/** Taille de page des listes BCF (`$top`) quand « Return All » est coché. */
export const PAGE_SIZE = 100;

export const projectIdProperty = (resource: string): INodeProperties => ({
	displayName: 'Project Name or ID',
	name: 'projectId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getProjects' },
	required: true,
	default: '',
	displayOptions: { show: { resource: [resource] } },
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
});

/** Littéral de chaîne OData : apostrophes doublées (règle OData, reprise par le serveur). */
export function odataString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Liste BCF paginée par `$top` / `$skip`. « Return All » enchaîne des pages de `PAGE_SIZE`
 * jusqu'à une page incomplète ; sinon une seule page de `limit` éléments.
 */
export async function bcfList(
	this: IExecuteFunctions,
	route: ScenopticRoute,
	params: Record<string, string>,
	qs: IDataObject,
	i: number,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	if (!returnAll) {
		const limit = this.getNodeParameter('limit', i) as number;
		return (await scenopticApiRequest.call(this, route, {
			params,
			qs: { ...qs, $top: limit },
			itemIndex: i,
		})) as IDataObject[];
	}
	const all: IDataObject[] = [];
	for (let skip = 0; ; skip += PAGE_SIZE) {
		const page = (await scenopticApiRequest.call(this, route, {
			params,
			qs: { ...qs, $top: PAGE_SIZE, $skip: skip },
			itemIndex: i,
		})) as IDataObject[];
		all.push(...page);
		if (page.length < PAGE_SIZE) return all;
	}
}

export const returnAllProperties = (resource: string, operation: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: { show: { resource: [resource], operation: [operation] } },
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: { show: { resource: [resource], operation: [operation], returnAll: [false] } },
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
	},
];

/** Nom du fichier déposé : l'option « File Name », sinon le nom du binaire n8n. */
function uploadName(this: IExecuteFunctions, binaryName: string | undefined, i: number): string {
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const name = String(options.fileName ?? '').trim() || binaryName?.trim();
	if (!name) {
		throw new NodeOperationError(this.getNode(), 'The binary file has no name', {
			itemIndex: i,
			description: 'Set the "File Name" option, extension included: it selects the converter.',
		});
	}
	return name;
}

/** Binaire n8n de l'élément `i` : son contenu et son nom de fichier. */
export async function readBinary(
	this: IExecuteFunctions,
	i: number,
): Promise<{ data: Buffer; fileName: string }> {
	const property = this.getNodeParameter('binaryPropertyName', i) as string;
	const binary = this.helpers.assertBinaryData(i, property);
	const data = await this.helpers.getBinaryDataBuffer(i, property);
	return { data, fileName: uploadName.call(this, binary.fileName, i) };
}

/**
 * Dépôt par parties d'un fichier ou d'une conversion déjà créés : `partsRoute` signe les URL
 * (`POST …/{id}/parts`), `uploadParts` envoie. La confirmation reste à l'appelant.
 */
export async function depositParts(
	this: IExecuteFunctions,
	partsRoute: ScenopticRoute,
	id: string,
	data: Buffer,
	plan: UploadPlan,
	i: number,
): Promise<void> {
	const presign = async (from: number, count: number) => {
		const { parts } = (await scenopticApiRequest.call(this, partsRoute, {
			params: { id },
			body: { from, count },
			itemIndex: i,
		})) as { parts: PresignedPart[] };
		return parts;
	};
	await uploadParts.call(this, data, plan, presign, i);
}
