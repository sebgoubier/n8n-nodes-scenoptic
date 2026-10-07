import { createHmac } from 'node:crypto';

/**
 * Signe une livraison comme le serveur Scenoptic, selon la spec publique :
 * `Scenoptic-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + corps)>`.
 *
 * Écrit à part de `nodes/ScenopticTrigger/signature.ts` (qui vérifie) : un défaut commun aux deux
 * ne passerait pas inaperçu. Le dépôt Scenoptic vérifie que le serveur signe de même.
 */
export function signer(secret: string, t: number, body: string): string {
	const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	return `t=${t},v1=${v1}`;
}
