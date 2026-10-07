import type { IDataObject } from 'n8n-workflow';

/** Statuts après lesquels une conversion ne bouge plus d'elle-même. */
export const FINAL_CONVERSION_STATUSES = ['ready', 'error'];

export interface WaitOptions {
	/** Attente maximale en millisecondes, comptée depuis l'appel. */
	maxWaitMs: number;
	/** Intervalle entre deux relectures, en millisecondes. */
	intervalMs: number;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

/**
 * Relit la conversion jusqu'à un statut final, sans jamais dépasser `maxWaitMs`. Le nombre de
 * relectures est AUSSI borné (`maxWaitMs / intervalMs` + 1) : une horloge qui n'avance pas, ou
 * un `sleep` qui rend la main tout de suite, ne peut pas faire tourner la boucle sans fin.
 */
export async function waitForConversion(
	read: () => Promise<IDataObject>,
	first: IDataObject,
	options: WaitOptions,
): Promise<{ conversion: IDataObject; timedOut: boolean }> {
	const { maxWaitMs, intervalMs, sleep, now } = options;
	const deadline = now() + maxWaitMs;
	const maxReads = Math.ceil(maxWaitMs / intervalMs) + 1;
	let conversion = first;
	for (let reads = 0; ; reads++) {
		if (FINAL_CONVERSION_STATUSES.includes(String(conversion.status))) {
			return { conversion, timedOut: false };
		}
		const left = deadline - now();
		if (left <= 0 || reads >= maxReads) return { conversion, timedOut: true };
		await sleep(Math.min(intervalMs, left));
		conversion = await read();
	}
}
