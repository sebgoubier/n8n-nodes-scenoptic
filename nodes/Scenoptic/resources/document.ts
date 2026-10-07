import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { folderPaths, ROOT_FOLDER, subtreeIds, type ScenopticTree } from '../../shared/folders';
import { ROUTES } from '../../shared/routes';
import { scenopticApiRequest } from '../../shared/transport';
import { depositParts, projectIdProperty, readBinary } from './shared';

const showFor = (operation: string[]) => ({ show: { resource: ['document'], operation } });

export const documentProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['document'] } },
		options: [
			{
				name: 'Create Folder',
				value: 'createFolder',
				description: 'Create a folder in a project',
				action: 'Create a folder',
			},
			{ name: 'Get', value: 'get', description: 'Get a document and its artifacts', action: 'Get a document' },
			{
				name: 'Get Download URL',
				value: 'getDownloadUrl',
				description: 'Get a time-limited URL of the original file (project owner only)',
				action: 'Get the download URL of a document',
			},
			{
				name: 'Get Tree',
				value: 'getTree',
				description: 'List the folders and documents of a project',
				action: 'Get the tree of a project',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: 'Upload a binary file as a document in a folder',
				action: 'Upload a document',
			},
		],
		default: 'upload',
	},
	{
		...projectIdProperty('document'),
		displayOptions: showFor(['createFolder', 'getTree', 'upload']),
	},
	{
		displayName: 'Folder Name or ID',
		name: 'folderId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['projectId'] },
		default: ROOT_FOLDER,
		displayOptions: showFor(['upload']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Leave empty for the project root',
	},
	{
		displayName: 'Parent Folder Name or ID',
		name: 'parentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['projectId'] },
		default: ROOT_FOLDER,
		displayOptions: showFor(['createFolder']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Leave empty for the project root',
	},
	{
		displayName: 'Folder Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['createFolder']),
		description: 'Up to 200 characters, without "/"',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: showFor(['upload']),
		hint: 'The name of the input binary field containing the file to upload',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['upload']),
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description:
					'Name of the document, extension included: it selects the converter. Defaults to the name of the binary file.',
			},
		],
	},
	{
		displayName: 'Document ID',
		name: 'fileId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['get', 'getDownloadUrl']),
	},
	{
		displayName: 'Folder Name or ID',
		name: 'treeFolderId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['projectId'] },
		default: ROOT_FOLDER,
		displayOptions: showFor(['getTree']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only this folder and its subfolders are listed. Leave empty for the whole project.',
	},
];

/**
 * Arborescence → un élément par dossier puis par document, chacun avec `type` et `path`
 * (`Architecture/Plans/R+1.ifc`). Avec `folderId`, seulement ce dossier et ses descendants.
 */
export function treeItems(tree: ScenopticTree, folderId: string = ROOT_FOLDER): IDataObject[] {
	const paths = folderPaths(tree.folders);
	const keep = folderId === ROOT_FOLDER ? undefined : subtreeIds(tree.folders, folderId);
	const inScope = (id: unknown) => keep === undefined || (id != null && keep.has(String(id)));
	const pathOf = (parent: unknown, name: unknown) => {
		const base = parent ? paths.get(String(parent)) : undefined;
		return base ? `${base}/${String(name)}` : String(name);
	};
	return [
		...tree.folders
			.filter((f) => inScope(f.id))
			.map((f) => ({ type: 'folder', path: pathOf(f.parentId, f.name), ...f })),
		...tree.files
			.filter((f) => inScope(f.folderId))
			.map((f) => ({ type: 'document', path: pathOf(f.folderId, f.name), ...f })),
	];
}

export async function executeDocument(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	if (operation === 'get') {
		const id = this.getNodeParameter('fileId', i) as string;
		return [(await scenopticApiRequest.call(this, ROUTES.getFile, { params: { id }, itemIndex: i })) as IDataObject];
	}

	if (operation === 'getDownloadUrl') {
		const id = this.getNodeParameter('fileId', i) as string;
		const { url } = (await scenopticApiRequest.call(this, ROUTES.nativeDownloadUrl, {
			params: { id },
			itemIndex: i,
		})) as { url: string };
		return [{ fileId: id, url }];
	}

	const projectId = this.getNodeParameter('projectId', i) as string;

	if (operation === 'getTree') {
		const folderId = this.getNodeParameter('treeFolderId', i, ROOT_FOLDER) as string;
		const tree = (await scenopticApiRequest.call(this, ROUTES.getTree, {
			params: { id: projectId },
			itemIndex: i,
		})) as ScenopticTree;
		return treeItems(tree, folderId);
	}

	if (operation === 'createFolder') {
		const name = this.getNodeParameter('name', i) as string;
		const parentId = this.getNodeParameter('parentId', i, ROOT_FOLDER) as string;
		const folder = await scenopticApiRequest.call(this, ROUTES.createFolder, {
			params: { id: projectId },
			body: { name, parentId: parentId || null },
			itemIndex: i,
		});
		return [folder as IDataObject];
	}

	if (operation === 'upload') {
		const folderId = this.getNodeParameter('folderId', i, ROOT_FOLDER) as string;
		const { data, fileName } = await readBinary.call(this, i);
		const created = (await scenopticApiRequest.call(this, ROUTES.createFile, {
			params: { id: projectId },
			body: { name: fileName, sizeBytes: data.length, folderId: folderId || null },
			itemIndex: i,
		})) as { fileId: string; partSize: number; partCount: number };
		await depositParts.call(this, ROUTES.presignFileParts, created.fileId, data, created, i);
		const file = await scenopticApiRequest.call(this, ROUTES.confirmFileUpload, {
			params: { id: created.fileId },
			itemIndex: i,
		});
		return [file as IDataObject];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported document operation: ${operation}`, {
		itemIndex: i,
	});
}
