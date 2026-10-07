import type { IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Échanges directs avec le stockage, hors de l'API Scenoptic : URL présignées des parties d'un
 * dépôt, liens signés des artefacts. Ces URL portent leur propre signature ; elles sont appelées par `helpers.httpRequest`,
 * jamais avec le jeton d'accès, qui n'a rien à faire chez le stockage.
 *
 * ⛔ Une URL présignée ou un lien signé est un secret au porteur : elle n'apparaît dans aucun message d'erreur.
 */

/** Lot maximal d'URL demandées en un appel (`POST …/parts`, `count` ≤ 16). */
export const PARTS_PER_REQUEST = 16;

export interface UploadPlan {
	partSize: number;
	partCount: number;
}

export interface PresignedPart {
	n: number;
	url: string;
}

/**
 * Dépose `data` partie par partie selon le plan rendu par le serveur : URL par lots de
 * `PARTS_PER_REQUEST`, puis un `PUT` par partie, corps brut. La dernière partie porte le reste.
 * La longueur de chaque partie est signée par le serveur : un découpage faux est refusé par le
 * stockage, d'où la vérification du plan avant le premier envoi.
 */
export async function uploadParts(
	this: IExecuteFunctions,
	data: Buffer,
	plan: UploadPlan,
	presign: (from: number, count: number) => Promise<PresignedPart[]>,
	itemIndex: number,
): Promise<void> {
	const { partSize, partCount } = plan;
	const expected = partSize > 0 ? Math.max(1, Math.ceil(data.length / partSize)) : NaN;
	if (!Number.isInteger(partSize) || partCount !== expected) {
		throw new NodeOperationError(this.getNode(), 'Unexpected upload plan from Scenoptic', {
			itemIndex,
			description: `${data.length} bytes cannot be sent as ${partCount} parts of ${partSize} bytes`,
		});
	}

	for (let from = 1; from <= partCount; from += PARTS_PER_REQUEST) {
		const count = Math.min(PARTS_PER_REQUEST, partCount - from + 1);
		const urls = await presign(from, count);
		for (let n = from; n < from + count; n++) {
			const part = urls.find((p) => p.n === n);
			if (!part) {
				throw new NodeOperationError(this.getNode(), `Scenoptic did not sign part ${n}`, {
					itemIndex,
				});
			}
			const response = (await this.helpers.httpRequest({
				method: 'PUT',
				url: part.url,
				body: data.subarray((n - 1) * partSize, n * partSize),
				headers: { 'Content-Type': 'application/octet-stream' },
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			})) as IN8nHttpFullResponse;
			if (response.statusCode >= 400) {
				throw new NodeOperationError(
					this.getNode(),
					`Upload of part ${n}/${partCount} failed (HTTP ${response.statusCode})`,
					{
						itemIndex,
						description:
							'The storage refused the part. Run the node again: an upload that is never confirmed is deleted after 24 hours.',
					},
				);
			}
		}
	}
}

/**
 * Télécharge un artefact par son lien signé (rendu par `GET /conversions/{id}`), sans jeton.
 * `label` nomme l'artefact dans l'erreur, à la place du lien.
 */
export async function downloadSigned(
	this: IExecuteFunctions,
	url: string,
	label: string,
	itemIndex: number,
): Promise<Buffer> {
	const response = (await this.helpers.httpRequest({
		method: 'GET',
		url,
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as IN8nHttpFullResponse;
	if (response.statusCode >= 400) {
		throw new NodeOperationError(this.getNode(), `Download of ${label} failed (HTTP ${response.statusCode})`, {
			itemIndex,
			description: 'Signed links expire after a while: run the node again to get a fresh one.',
		});
	}
	return Buffer.from(response.body as ArrayBuffer);
}

/** Nom de fichier d'un lien d'artefact : dernier segment du chemin, sans la requête. */
export function fileNameFromUrl(url: string, fallback: string): string {
	try {
		const segment = new URL(url).pathname.split('/').pop() ?? '';
		return decodeURIComponent(segment) || fallback;
	} catch {
		return fallback;
	}
}
