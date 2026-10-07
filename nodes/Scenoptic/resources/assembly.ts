import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ROUTES } from '../../shared/routes';
import { scenopticApiRequest } from '../../shared/transport';
import { projectIdProperty, returnAllProperties } from './shared';

const showFor = (operation: string[]) => ({ show: { resource: ['assembly'], operation } });

const FILE_IDS_DESCRIPTION =
	'Comma-separated IDs of documents of the same project tree (on-demand conversions are not accepted)';

export const assemblyProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['assembly'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create an assembly of documents',
				action: 'Create an assembly',
			},
			{ name: 'Get', value: 'get', description: 'Get an assembly', action: 'Get an assembly' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the assemblies of a project, most recent first',
				action: 'Get many assemblies',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Rename an assembly or replace its documents',
				action: 'Update an assembly',
			},
		],
		default: 'getAll',
	},
	{
		...projectIdProperty('assembly'),
		displayOptions: showFor(['create', 'getAll']),
	},
	{
		displayName: 'Assembly ID',
		name: 'assemblyId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['get', 'update']),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['create']),
	},
	{
		displayName: 'Document IDs',
		name: 'fileIds',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['create']),
		description: FILE_IDS_DESCRIPTION,
		hint: 'At least one document',
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['update']),
		options: [
			{
				displayName: 'Document IDs',
				name: 'fileIds',
				type: 'string',
				default: '',
				description: FILE_IDS_DESCRIPTION,
				hint: 'Replaces the whole list. Leave empty to remove every document.',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
			},
		],
	},
	...returnAllProperties('assembly', 'getAll'),
];

/**
 * Identifiants de documents : liste séparée par des virgules, ou tableau passé par une
 * expression (`{{ $json.fileIds }}`). Les valeurs vides sont écartées.
 */
export function parseFileIds(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
	return raw.map((id) => String(id).trim()).filter((id) => id !== '');
}

export async function executeAssembly(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	if (operation === 'get') {
		const id = this.getNodeParameter('assemblyId', i) as string;
		return [
			(await scenopticApiRequest.call(this, ROUTES.getAssembly, { params: { id }, itemIndex: i })) as IDataObject,
		];
	}

	if (operation === 'update') {
		const id = this.getNodeParameter('assemblyId', i) as string;
		const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		if (fields.name !== undefined) body.name = fields.name;
		if (fields.fileIds !== undefined) body.fileIds = parseFileIds(fields.fileIds);
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(this.getNode(), 'Nothing to update', {
				itemIndex: i,
				description: 'Add the "Name" or "Document IDs" field.',
			});
		}
		return [
			(await scenopticApiRequest.call(this, ROUTES.updateAssembly, {
				params: { id },
				body,
				itemIndex: i,
			})) as IDataObject,
		];
	}

	const projectId = this.getNodeParameter('projectId', i) as string;

	if (operation === 'getAll') {
		// Liste non paginée côté serveur : « Limit » coupe la réponse.
		const all = (await scenopticApiRequest.call(this, ROUTES.listAssemblies, {
			params: { id: projectId },
			itemIndex: i,
		})) as IDataObject[];
		if (this.getNodeParameter('returnAll', i) as boolean) return all;
		return all.slice(0, this.getNodeParameter('limit', i) as number);
	}

	if (operation === 'create') {
		const name = this.getNodeParameter('name', i) as string;
		const fileIds = parseFileIds(this.getNodeParameter('fileIds', i));
		if (fileIds.length === 0) {
			throw new NodeOperationError(this.getNode(), 'An assembly needs at least one document', {
				itemIndex: i,
			});
		}
		return [
			(await scenopticApiRequest.call(this, ROUTES.createAssembly, {
				params: { id: projectId },
				body: { name, fileIds },
				itemIndex: i,
			})) as IDataObject,
		];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported assembly operation: ${operation}`, {
		itemIndex: i,
	});
}
