import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { ROUTES } from '../../shared/routes';
import { downloadSigned, fileNameFromUrl } from '../../shared/storage';
import { scenopticApiRequest } from '../../shared/transport';
import { waitForConversion } from '../../shared/wait';
import { depositParts, projectIdProperty, readBinary } from './shared';

const showFor = (operation: string[]) => ({ show: { resource: ['conversion'], operation } });

/** Plafond de l'attente, en secondes : au-delà, enchaîner sur le Scenoptic Trigger. */
export const MAX_WAIT_SECONDS = 3600;

/** Taille de page de « Return All » (maximum du serveur). */
export const CONVERSIONS_PAGE_SIZE = 200;

export const conversionProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversion'] } },
		options: [
			{
				name: 'Convert',
				value: 'convert',
				description: 'Upload a binary file and convert it, outside the project tree',
				action: 'Convert a file',
			},
			{
				name: 'Download Artifact',
				value: 'downloadArtifact',
				description: 'Download an artifact of a finished conversion as a binary file',
				action: 'Download a conversion artifact',
			},
			{ name: 'Get', value: 'get', description: 'Get a conversion and its artifacts', action: 'Get a conversion' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the conversions of a project',
				action: 'Get many conversions',
			},
		],
		default: 'convert',
	},
	{
		...projectIdProperty('conversion'),
		displayOptions: showFor(['convert', 'getAll']),
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: showFor(['convert']),
		hint: 'The name of the input binary field containing the file to convert',
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['convert']),
		description:
			'Whether to wait until the conversion is ready or failed before returning. Without it, the node returns once the upload is confirmed: continue the workflow with the Scenoptic Trigger (conversion.completed, conversion.failed).',
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWait',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: MAX_WAIT_SECONDS },
		default: 600,
		displayOptions: { show: { resource: ['conversion'], operation: ['convert'], waitForCompletion: [true] } },
		description: 'The node fails if the conversion is not finished after this time',
	},
	{
		displayName: 'Poll Interval (Seconds)',
		name: 'pollInterval',
		type: 'number',
		typeOptions: { minValue: 2, maxValue: 60 },
		default: 10,
		displayOptions: { show: { resource: ['conversion'], operation: ['convert'], waitForCompletion: [true] } },
		description: 'Time between two reads of the conversion status',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['convert']),
		options: [
			{
				displayName: 'External Reference',
				name: 'externalRef',
				type: 'string',
				default: '',
				description:
					'Free reference (case number, email Message-ID…), up to 200 characters. It comes back in conversion events and can be used to find the conversion.',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description:
					'Name of the file, extension included: it selects the converter. Defaults to the name of the binary file.',
			},
			{
				displayName: 'Keep Original File (Days)',
				name: 'retentionDays',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 365 },
				default: 30,
				description:
					'Days Scenoptic keeps the original file, to allow a new conversion. The artifacts are kept until the conversion is deleted.',
			},
		],
	},
	{
		displayName: 'Conversion ID',
		name: 'conversionId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['get', 'downloadArtifact']),
	},
	{
		displayName: 'Artifact Kind',
		name: 'artifactKind',
		type: 'string',
		required: true,
		default: 'glb',
		displayOptions: showFor(['downloadArtifact']),
		description:
			'Kind of the artifact to download, as listed in the conversion: glb, properties, structure, thumbnail, pdf… If several artifacts have this kind, one item is returned for each',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: showFor(['downloadArtifact']),
		hint: 'The name of the output binary field to put the file in',
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
		displayOptions: { show: { resource: ['conversion'], operation: ['getAll'], returnAll: [false] } },
		typeOptions: { minValue: 1, maxValue: CONVERSIONS_PAGE_SIZE },
		default: 50,
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'External Reference',
				name: 'externalRef',
				type: 'string',
				default: '',
				description: 'Exact match',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'ready',
				options: [
					{ name: 'Converting', value: 'converting' },
					{ name: 'Error', value: 'error' },
					{ name: 'Pending Upload', value: 'pending_upload' },
					{ name: 'Ready', value: 'ready' },
					{ name: 'Uploaded', value: 'uploaded' },
				],
			},
		],
	},
];

/** Options de Convert → champs du corps de création (seulement ceux renseignés). */
export function conversionBody(name: string, sizeBytes: number, options: IDataObject): IDataObject {
	const body: IDataObject = { name, size_bytes: sizeBytes };
	const externalRef = String(options.externalRef ?? '').trim();
	if (externalRef) body.external_ref = externalRef;
	if (options.retentionDays !== undefined) body.retention_days = options.retentionDays;
	return body;
}

async function getConversion(this: IExecuteFunctions, id: string, i: number): Promise<IDataObject> {
	return (await scenopticApiRequest.call(this, ROUTES.getConversion, {
		params: { id },
		itemIndex: i,
	})) as IDataObject;
}

async function convert(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const projectId = this.getNodeParameter('projectId', i) as string;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const { data, fileName } = await readBinary.call(this, i);

	const created = (await scenopticApiRequest.call(this, ROUTES.createConversion, {
		params: { id: projectId },
		body: conversionBody(fileName, data.length, options),
		itemIndex: i,
	})) as IDataObject & { id: string; upload: { part_size: number; part_count: number } };
	const plan = { partSize: created.upload.part_size, partCount: created.upload.part_count };
	await depositParts.call(this, ROUTES.presignConversionParts, created.id, data, plan, i);
	const uploaded = (await scenopticApiRequest.call(this, ROUTES.confirmConversionUpload, {
		params: { id: created.id },
		itemIndex: i,
	})) as IDataObject;

	if (!(this.getNodeParameter('waitForCompletion', i, false) as boolean)) return uploaded;

	const maxWait = Math.min(this.getNodeParameter('maxWait', i) as number, MAX_WAIT_SECONDS);
	const interval = this.getNodeParameter('pollInterval', i) as number;
	const { conversion, timedOut } = await waitForConversion(
		async () => await getConversion.call(this, created.id, i),
		uploaded,
		{ maxWaitMs: maxWait * 1000, intervalMs: interval * 1000, sleep, now: () => Date.now() },
	);
	if (timedOut) {
		throw new NodeOperationError(
			this.getNode(),
			`Conversion is still "${String(conversion.status)}" after ${maxWait} s`,
			{
				itemIndex: i,
				description: `Conversion ${created.id} goes on in Scenoptic. Raise "Max Wait", or continue the workflow with the Scenoptic Trigger (conversion.completed, conversion.failed).`,
			},
		);
	}
	return conversion;
}

async function getMany(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const projectId = this.getNodeParameter('projectId', i) as string;
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const qs: IDataObject = {};
	if (filters.externalRef) qs.external_ref = filters.externalRef;
	if (filters.status) qs.status = filters.status;

	const page = async (limit: number, cursor?: string) =>
		(await scenopticApiRequest.call(this, ROUTES.listConversions, {
			params: { id: projectId },
			qs: cursor ? { ...qs, limit, cursor } : { ...qs, limit },
			itemIndex: i,
		})) as { items: IDataObject[]; next_cursor: string | null };

	if (!returnAll) return (await page(this.getNodeParameter('limit', i) as number)).items;
	const all: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const result = await page(CONVERSIONS_PAGE_SIZE, cursor);
		all.push(...result.items);
		cursor = result.next_cursor ?? undefined;
	} while (cursor);
	return all;
}

async function downloadArtifact(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const id = this.getNodeParameter('conversionId', i) as string;
	const kind = String(this.getNodeParameter('artifactKind', i)).trim();
	const property = this.getNodeParameter('binaryPropertyName', i) as string;
	const conversion = await getConversion.call(this, id, i);
	if (conversion.status !== 'ready') {
		throw new NodeOperationError(this.getNode(), `Conversion is "${String(conversion.status)}", not ready`, {
			itemIndex: i,
			description: 'Artifacts can be downloaded once the conversion is ready.',
		});
	}
	const artifacts = (conversion.artifacts ?? []) as Array<{ kind: string; size_bytes: number; url: string }>;
	const matching = artifacts.filter((a) => a.kind === kind);
	if (matching.length === 0) {
		const available = [...new Set(artifacts.map((a) => a.kind))].join(', ') || 'none';
		throw new NodeOperationError(this.getNode(), `This conversion has no "${kind}" artifact`, {
			itemIndex: i,
			description: `Available kinds: ${available}`,
		});
	}
	const items: INodeExecutionData[] = [];
	for (const artifact of matching) {
		const data = await downloadSigned.call(this, artifact.url, `the "${kind}" artifact`, i);
		const fileName = fileNameFromUrl(artifact.url, `${String(conversion.name)}.${kind}`);
		items.push({
			json: { conversionId: id, kind, size_bytes: artifact.size_bytes, fileName },
			binary: { [property]: await this.helpers.prepareBinaryData(data, fileName) },
		});
	}
	return items;
}

export async function executeConversion(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'convert') return [{ json: await convert.call(this, i) }];
	if (operation === 'get') {
		const id = this.getNodeParameter('conversionId', i) as string;
		return [{ json: await getConversion.call(this, id, i) }];
	}
	if (operation === 'getAll') return (await getMany.call(this, i)).map((json) => ({ json }));
	if (operation === 'downloadArtifact') return downloadArtifact.call(this, i);
	throw new NodeOperationError(this.getNode(), `Unsupported conversion operation: ${operation}`, {
		itemIndex: i,
	});
}
