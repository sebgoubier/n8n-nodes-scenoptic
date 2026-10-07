import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ROUTES } from '../../shared/routes';
import { scenopticApiRequest } from '../../shared/transport';
import { bcfList, odataString, projectIdProperty, returnAllProperties } from './shared';

const showFor = (operation: string[]) => ({ show: { resource: ['topic'], operation } });

/**
 * Champs d'un topic que le PUT BCF réécrit. Le PUT est un remplacement complet (« un champ omis
 * est effacé ») : la mise à jour relit le topic et renvoie TOUS ces champs, modifiés ou non.
 * `extended` en fait partie : le serveur attend l'objet lu par GET.
 */
export const TOPIC_WRITABLE_FIELDS = [
	'title',
	'topic_type',
	'topic_status',
	'priority',
	'stage',
	'assigned_to',
	'description',
	'due_date',
	'labels',
	'reference_links',
	'index',
	'bim_snippet',
	'extended',
] as const;

/** Nom du paramètre n8n → champ BCF. */
const FIELD_MAP: Record<string, string> = {
	title: 'title',
	type: 'topic_type',
	status: 'topic_status',
	priority: 'priority',
	stage: 'stage',
	assignedTo: 'assigned_to',
	description: 'description',
	dueDate: 'due_date',
	labels: 'labels',
};

const EXTENSIONS_HINT = 'Must be one of the values allowed by the project BCF extensions';

const topicFieldOptions: INodeProperties[] = [
	{
		displayName: 'Assigned To',
		name: 'assignedTo',
		type: 'string',
		placeholder: 'name@example.com',
		default: '',
		description: 'Email of a project member',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
	},
	{
		displayName: 'Due Date',
		name: 'dueDate',
		type: 'dateTime',
		default: '',
	},
	{
		displayName: 'Labels',
		name: 'labels',
		type: 'string',
		default: '',
		description: `Comma-separated list. ${EXTENSIONS_HINT}.`,
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'string',
		default: '',
		description: EXTENSIONS_HINT,
	},
	{
		displayName: 'Stage',
		name: 'stage',
		type: 'string',
		default: '',
		description: EXTENSIONS_HINT,
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'string',
		default: '',
		description: EXTENSIONS_HINT,
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'string',
		default: '',
		description: EXTENSIONS_HINT,
	},
];

export const topicProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['topic'] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create a topic', action: 'Create a topic' },
			{ name: 'Get', value: 'get', description: 'Get a topic', action: 'Get a topic' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the topics of a project',
				action: 'Get many topics',
			},
			{ name: 'Update', value: 'update', description: 'Update a topic', action: 'Update a topic' },
		],
		default: 'getAll',
	},
	projectIdProperty('topic'),
	{
		displayName: 'Topic ID',
		name: 'topicId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['get', 'update']),
		description: 'GUID of the topic',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		options: topicFieldOptions,
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['update']),
		description: 'Fields to change. Fields you do not add keep their value; an added field left empty is cleared.',
		options: [
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
			...topicFieldOptions,
		],
	},
	...returnAllProperties('topic', 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'Assigned To',
				name: 'assignedTo',
				type: 'string',
				placeholder: 'name@example.com',
				default: '',
			},
			{
				displayName: 'OData Filter',
				name: 'odataFilter',
				type: 'string',
				placeholder: "priority eq 'High' and creation_date gt '2026-01-01'",
				default: '',
				description:
					'Extra BCF API $filter, combined with the filters above using "and". Supported: eq, ne, lt, le, gt, ge joined by "and", on title, topic_type, topic_status, priority, stage, assigned_to, creation_author, creation_date, modified_date.',
			},
			{
				displayName: 'Sort',
				name: 'orderBy',
				type: 'options',
				default: 'creation_date desc',
				options: [
					{ name: 'Creation Date (Newest First)', value: 'creation_date desc' },
					{ name: 'Creation Date (Oldest First)', value: 'creation_date asc' },
					{ name: 'Index', value: 'index asc' },
					{ name: 'Modified Date (Newest First)', value: 'modified_date desc' },
					{ name: 'Modified Date (Oldest First)', value: 'modified_date asc' },
				],
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'string',
				default: '',
			},
		],
	},
];

/** Champs n8n → corps BCF. Une valeur vide devient `null` (effacement), les labels une liste. */
export function topicBody(fields: IDataObject): IDataObject {
	const body: IDataObject = {};
	for (const [name, value] of Object.entries(fields)) {
		const key = FIELD_MAP[name];
		if (!key) continue;
		if (key === 'labels') {
			const labels = String(value ?? '')
				.split(',')
				.map((l) => l.trim())
				.filter((l) => l !== '');
			body.labels = labels.length > 0 ? labels : null;
		} else {
			body[key] = value === '' || value === undefined ? null : value;
		}
	}
	return body;
}

/** Filtres n8n → `$filter` OData : conditions jointes par `and` (le serveur n'a ni `or` ni parenthèses). */
export function topicODataFilter(filters: IDataObject): string | undefined {
	const parts: string[] = [];
	if (filters.status) parts.push(`topic_status eq ${odataString(String(filters.status))}`);
	if (filters.assignedTo) parts.push(`assigned_to eq ${odataString(String(filters.assignedTo))}`);
	const extra = String(filters.odataFilter ?? '').trim();
	if (extra) parts.push(extra);
	return parts.length > 0 ? parts.join(' and ') : undefined;
}

export async function executeTopic(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const projectId = this.getNodeParameter('projectId', i) as string;

	if (operation === 'get') {
		const guid = this.getNodeParameter('topicId', i) as string;
		const topic = await scenopticApiRequest.call(this, ROUTES.getTopic, {
			params: { project_id: projectId, guid },
			itemIndex: i,
		});
		return [topic as IDataObject];
	}

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = { $orderby: filters.orderBy || 'creation_date desc' };
		const filter = topicODataFilter(filters);
		if (filter) qs.$filter = filter;
		return bcfList.call(this, ROUTES.listTopics, { project_id: projectId }, qs, i);
	}

	if (operation === 'create') {
		const title = this.getNodeParameter('title', i) as string;
		const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const topic = await scenopticApiRequest.call(this, ROUTES.createTopic, {
			params: { project_id: projectId },
			body: { ...topicBody(fields), title },
			itemIndex: i,
		});
		return [topic as IDataObject];
	}

	if (operation === 'update') {
		const guid = this.getNodeParameter('topicId', i) as string;
		const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const changes = topicBody(fields);
		if (Object.keys(changes).length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		if (changes.title === null) {
			throw new NodeOperationError(this.getNode(), 'The title cannot be empty', { itemIndex: i });
		}
		const current = (await scenopticApiRequest.call(this, ROUTES.getTopic, {
			params: { project_id: projectId, guid },
			itemIndex: i,
		})) as IDataObject;
		const body: IDataObject = {};
		for (const key of TOPIC_WRITABLE_FIELDS) {
			if (current[key] !== undefined) body[key] = current[key];
		}
		const topic = await scenopticApiRequest.call(this, ROUTES.updateTopic, {
			params: { project_id: projectId, guid },
			body: { ...body, ...changes },
			itemIndex: i,
		});
		return [topic as IDataObject];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported topic operation: ${operation}`, {
		itemIndex: i,
	});
}
