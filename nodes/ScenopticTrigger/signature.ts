import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérification de `Scenoptic-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + corps)>`,
 * le pendant consommateur de la signature des livraisons décrite par la spec publique.
 *
 * ⛔ Le HMAC se calcule sur les OCTETS reçus (`req.rawBody`), jamais sur un JSON re-sérialisé :
 * un espace, l'ordre des clés ou l'échappement d'un caractère non ASCII suffisent à changer
 * la signature. L'horodatage est signé avec le corps, et un `t` hors tolérance est refusé dans
 * les DEUX sens (passé : rejeu d'un corps capturé ; futur : horloge trafiquée).
 */

/** Tolérance d'horloge publiée par Scenoptic, en secondes. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
	| 'missing_secret'
	| 'missing_body'
	| 'missing_header'
	| 'malformed_header'
	| 'stale_timestamp'
	| 'bad_signature';

export type SignatureVerdict = { ok: true } | { ok: false; reason: SignatureFailure };

export interface SignatureInput {
	secret: unknown;
	header: string | string[] | undefined;
	rawBody: unknown;
	nowSeconds: number;
	toleranceSeconds?: number;
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

export function verifySignature(input: SignatureInput): SignatureVerdict {
	const { secret, header, rawBody, nowSeconds } = input;
	const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;

	if (typeof secret !== 'string' || secret === '') return { ok: false, reason: 'missing_secret' };
	if (!Buffer.isBuffer(rawBody)) return { ok: false, reason: 'missing_body' };
	if (typeof header !== 'string' || header.trim() === '') {
		return { ok: false, reason: 'missing_header' };
	}

	let t: number | undefined;
	const signatures: Buffer[] = [];
	for (const part of header.split(',')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		const key = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
		// Plusieurs `v1` sont admis (rotation de secret) : un seul doit correspondre.
		if (key === 'v1' && HEX_SHA256.test(value)) signatures.push(Buffer.from(value, 'hex'));
	}
	if (t === undefined || signatures.length === 0) return { ok: false, reason: 'malformed_header' };
	if (Math.abs(nowSeconds - t) > tolerance) return { ok: false, reason: 'stale_timestamp' };

	const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
	const match = signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
	return match ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
