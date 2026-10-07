import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { problemMessage, readProblem, type ScenopticProblem } from './problem';
import { buildPath, normalizeBaseUrl, type ScenopticRoute } from './routes';

export const CREDENTIAL_NAME = 'scenopticApi';

type ScenopticContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export interface ScenopticRequest {
	params?: Record<string, string>;
	qs?: IDataObject;
	body?: IDataObject;
	itemIndex?: number;
}

/**
 * Erreur Scenoptic remontée dans n8n. Le message vient du `code` ; `detail` n'est qu'une
 * description affichée. `problem` reste lisible par l'appelant (ex. 404 toléré à la suppression).
 */
export class ScenopticApiError extends NodeApiError {
	readonly problem: ScenopticProblem;

	constructor(node: INode, problem: ScenopticProblem, itemIndex?: number) {
		super(node, { code: problem.code, status: problem.status } as JsonObject, {
			message: problemMessage(problem),
			description: problem.detail,
			httpCode: String(problem.status),
			itemIndex,
		});
		this.problem = problem;
	}
}

/**
 * Seul point de sortie réseau du paquet. Le statut HTTP est lu ici (pas d'exception du client
 * HTTP de n8n) pour que toute erreur passe par `readProblem`, donc par le `code`.
 */
export async function scenopticApiRequest(
	this: ScenopticContext,
	route: ScenopticRoute,
	request: ScenopticRequest = {},
): Promise<unknown> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const options: IHttpRequestOptions = {
		method: route.method,
		baseURL: normalizeBaseUrl(String(credentials.baseUrl ?? '')),
		url: buildPath(route, request.params),
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.qs) options.qs = request.qs;
	if (request.body) options.body = request.body;

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_NAME,
		options,
	)) as IN8nHttpFullResponse;

	if (response.statusCode >= 400) {
		throw new ScenopticApiError(
			this.getNode(),
			readProblem(response.statusCode, response.body),
			request.itemIndex,
		);
	}
	return response.body;
}

/**
 * Erreur à lever depuis un `catch` : une erreur n8n passe telle quelle (elle porte déjà son
 * message, issu du `code`), toute autre est enveloppée en `NodeOperationError`.
 */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error as Error, { itemIndex });
}
