import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ROUTES } from '../../shared/routes';
import { scenopticApiRequest } from '../../shared/transport';

const showFor = (operation: string[]) => ({ show: { resource: ['project'], operation } });

export const projectProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['project'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the projects the access token can reach',
				action: 'Get many projects',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: showFor(['getAll']),
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: { show: { resource: ['project'], operation: ['getAll'], returnAll: [false] } },
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		description: 'Max number of results to return',
	},
];

export async function executeProject(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		if (returnAll) {
			return (await scenopticApiRequest.call(this, ROUTES.listProjects, { itemIndex: i })) as IDataObject[];
		}
		const limit = this.getNodeParameter('limit', i) as number;
		const page = (await scenopticApiRequest.call(this, ROUTES.listProjects, {
			qs: { limit },
			itemIndex: i,
		})) as { items: IDataObject[] };
		return page.items;
	}
	throw new NodeOperationError(this.getNode(), `Unsupported project operation: ${operation}`, {
		itemIndex: i,
	});
}
