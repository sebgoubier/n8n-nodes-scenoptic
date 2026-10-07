import { describe, expect, it } from 'vitest';

import { verifySignature } from '../nodes/ScenopticTrigger/signature';
import { signer } from './sign';

const SIGNING_FIXTURE = 'whsec_test_0123456789abcdef';
const NOW = 1_790_000_000;

/** Corps NON canonique : espaces, ordre de clés, caractère non ASCII. */
const RAW =
	'{ "type":"com.scenoptic.bcf.topic.created",  "id":"e1", "data":{"title":"Réservation"} }';

function verify(header: string | undefined, raw: unknown = Buffer.from(RAW, 'utf8'), now = NOW) {
	return verifySignature({ secret: SIGNING_FIXTURE, header, rawBody: raw, nowSeconds: now });
}

describe('verifySignature', () => {
	it('accepte la signature du serveur, calculée sur le corps brut', () => {
		expect(verify(signer(SIGNING_FIXTURE, NOW, RAW))).toEqual({ ok: true });
	});

	// Mutation « HMAC sur un JSON re-sérialisé » : ce corps ne survit pas à
	// JSON.stringify(JSON.parse(raw)), le test ci-dessus deviendrait rouge.
	it("le corps du test n'est pas canonique (garde-fou du test précédent)", () => {
		expect(JSON.stringify(JSON.parse(RAW))).not.toBe(RAW);
	});

	// Mutation « comparaison désactivée ».
	it('refuse un corps modifié, un autre secret, une signature altérée', () => {
		const header = signer(SIGNING_FIXTURE, NOW, RAW);
		expect(verify(header, Buffer.from(RAW.replace('e1', 'e2')))).toEqual({
			ok: false,
			reason: 'bad_signature',
		});
		expect(verify(signer('whsec_autre', NOW, RAW))).toEqual({ ok: false, reason: 'bad_signature' });
		const v1 = header.split('v1=')[1];
		const flipped = `t=${NOW},v1=${v1.slice(0, -1)}${v1.endsWith('0') ? '1' : '0'}`;
		expect(verify(flipped)).toEqual({ ok: false, reason: 'bad_signature' });
	});

	// Mutations « borne passée retirée » et « borne future retirée ».
	it('tolérance de 300 s dans les deux sens, pas au-delà', () => {
		expect(verify(signer(SIGNING_FIXTURE, NOW - 300, RAW))).toEqual({ ok: true });
		expect(verify(signer(SIGNING_FIXTURE, NOW + 300, RAW))).toEqual({ ok: true });
		expect(verify(signer(SIGNING_FIXTURE, NOW - 301, RAW))).toEqual({ ok: false, reason: 'stale_timestamp' });
		expect(verify(signer(SIGNING_FIXTURE, NOW + 301, RAW))).toEqual({ ok: false, reason: 'stale_timestamp' });
	});

	it('un horodatage déplacé casse la signature (t est signé)', () => {
		const v1 = signer(SIGNING_FIXTURE, NOW, RAW).split('v1=')[1];
		expect(verify(`t=${NOW - 10},v1=${v1}`)).toEqual({ ok: false, reason: 'bad_signature' });
	});

	it("accepte plusieurs v1 si l'un correspond (rotation)", () => {
		const v1 = signer(SIGNING_FIXTURE, NOW, RAW).split('v1=')[1];
		expect(verify(`t=${NOW},v1=${'0'.repeat(64)},v1=${v1}`)).toEqual({ ok: true });
	});

	it('refuse un en-tête absent ou mal formé', () => {
		expect(verify(undefined)).toEqual({ ok: false, reason: 'missing_header' });
		expect(verify('')).toEqual({ ok: false, reason: 'missing_header' });
		expect(verify(`t=${NOW}`)).toEqual({ ok: false, reason: 'malformed_header' });
		expect(verify(`v1=${'a'.repeat(64)}`)).toEqual({ ok: false, reason: 'malformed_header' });
		expect(verify(`t=abc,v1=${'a'.repeat(64)}`)).toEqual({ ok: false, reason: 'malformed_header' });
		expect(verify(`t=${NOW},v1=xyz`)).toEqual({ ok: false, reason: 'malformed_header' });
	});

	it('refuse sans corps brut (corps déjà analysé) ou sans secret', () => {
		const header = signer(SIGNING_FIXTURE, NOW, RAW);
		expect(verify(header, JSON.parse(RAW))).toEqual({ ok: false, reason: 'missing_body' });
		expect(verify(header, RAW)).toEqual({ ok: false, reason: 'missing_body' });
		expect(
			verifySignature({ secret: undefined, header, rawBody: Buffer.from(RAW), nowSeconds: NOW }),
		).toEqual({ ok: false, reason: 'missing_secret' });
	});
});
