import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ROUTES } from '../../shared/routes';
import { scenopticApiRequest } from '../../shared/transport';
import { bcfList, projectIdProperty, returnAllProperties } from './shared';

const showFor = (operation: string[]) => ({ show: { resource: ['comment'], operation } });

export const commentProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['comment'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Comment on a topic',
				action: 'Create a comment',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the comments of a topic',
				action: 'Get many comments',
			},
		],
		default: 'create',
	},
	projectIdProperty('comment'),
	{
		displayName: 'Topic ID',
		name: 'topicId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['comment'] } },
		description: 'GUID of the topic',
	},
	{
		displayName: 'Comment',
		name: 'comment',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: showFor(['create']),
		description: 'Text of the comment. Writing @email mentions and notifies a project member.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		options: [
			{
				displayName: 'Reply To Comment ID',
				name: 'replyToCommentGuid',
				type: 'string',
				default: '',
				description: 'GUID of the comment this one answers',
			},
			{
				displayName: 'Viewpoint ID',
				name: 'viewpointGuid',
				type: 'string',
				default: '',
				description: 'GUID of a viewpoint of the same topic',
			},
		],
	},
	...returnAllProperties('comment', 'getAll'),
	{
		displayName: 'Sort',
		name: 'orderBy',
		type: 'options',
		default: 'date asc',
		displayOptions: showFor(['getAll']),
		options: [
			{ name: 'Oldest First', value: 'date asc' },
			{ name: 'Newest First', value: 'date desc' },
		],
	},
];

export async function executeComment(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const params = {
		project_id: this.getNodeParameter('projectId', i) as string,
		topic_guid: this.getNodeParameter('topicId', i) as string,
	};

	if (operation === 'getAll') {
		const orderBy = this.getNodeParameter('orderBy', i, 'date asc') as string;
		return bcfList.call(this, ROUTES.listComments, params, { $orderby: orderBy }, i);
	}

	if (operation === 'create') {
		const comment = this.getNodeParameter('comment', i) as string;
		const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body: IDataObject = { comment };
		if (fields.replyToCommentGuid) body.reply_to_comment_guid = fields.replyToCommentGuid;
		if (fields.viewpointGuid) body.viewpoint_guid = fields.viewpointGuid;
		const created = await scenopticApiRequest.call(this, ROUTES.createComment, {
			params,
			body,
			itemIndex: i,
		});
		return [created as IDataObject];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported comment operation: ${operation}`, {
		itemIndex: i,
	});
}
