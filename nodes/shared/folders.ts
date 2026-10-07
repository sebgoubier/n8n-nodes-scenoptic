import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { ROUTES } from './routes';
import { scenopticApiRequest } from './transport';

/** Arborescence telle que rendue par `GET /api/v1/projects/{id}/tree`. */
export interface ScenopticTree {
	project: IDataObject;
	folders: IDataObject[];
	files: IDataObject[];
}

/** Valeur de la liste des dossiers qui désigne la racine du projet. */
export const ROOT_FOLDER = '';

/**
 * Chemin lisible de chaque dossier (`Architecture/Plans`), par id. Un parent inconnu ou un
 * cycle arrête la remontée : le chemin reste partiel plutôt que de boucler.
 */
export function folderPaths(folders: IDataObject[]): Map<string, string> {
	const byId = new Map(folders.map((f) => [String(f.id), f]));
	const paths = new Map<string, string>();
	for (const folder of folders) {
		const names: string[] = [];
		const seen = new Set<string>();
		let current: IDataObject | undefined = folder;
		while (current && !seen.has(String(current.id))) {
			seen.add(String(current.id));
			names.unshift(String(current.name));
			current = current.parentId ? byId.get(String(current.parentId)) : undefined;
		}
		paths.set(String(folder.id), names.join('/'));
	}
	return paths;
}

/** Dossier `folderId` et tous ses descendants. */
export function subtreeIds(folders: IDataObject[], folderId: string): Set<string> {
	const ids = new Set([folderId]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const f of folders) {
			if (f.parentId && ids.has(String(f.parentId)) && !ids.has(String(f.id))) {
				ids.add(String(f.id));
				grew = true;
			}
		}
	}
	return ids;
}

/** Liste dynamique des dossiers du projet choisi, racine en tête, triés par chemin. */
export async function getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const projectId = this.getCurrentNodeParameter('projectId') as string | undefined;
	if (!projectId) return [];
	const tree = (await scenopticApiRequest.call(this, ROUTES.getTree, {
		params: { id: projectId },
	})) as ScenopticTree;
	const paths = folderPaths(tree.folders);
	const options = tree.folders
		.map((f) => ({ name: paths.get(String(f.id)) ?? String(f.name), value: String(f.id) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return [{ name: '(Project Root)', value: ROOT_FOLDER }, ...options];
}
