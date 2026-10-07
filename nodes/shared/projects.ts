import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { ROUTES } from './routes';
import { scenopticApiRequest } from './transport';

/** Sans `limit` ni `cursor`, `GET /api/v1/projects` rend le tableau complet. */
export async function getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const projects = (await scenopticApiRequest.call(this, ROUTES.listProjects)) as IDataObject[];
	return projects
		.map((p) => ({ name: String(p.name), value: String(p.id) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}
