import type { IDataObject } from 'n8n-workflow';

/**
 * Enveloppe CloudEvents 1.0 des webhooks Scenoptic, et ce que le Trigger en sort.
 * La spec publique
 * (`openapi.json`, section `webhooks`) fait foi, `test/envelope.test.ts` vérifie la parité.
 */

export const EVENT_TYPE_PREFIX = 'com.scenoptic.';

/** Types auxquels on s'abonne (noms courts). `ping` n'en fait pas partie : il part à la demande. */
export const WEBHOOK_EVENT_TYPES = [
	'bcf.topic.created',
	'bcf.topic.updated',
	'bcf.topic.deleted',
	'bcf.comment.created',
	'bcf.comment.updated',
	'bcf.comment.deleted',
	'bcf.viewpoint.created',
	'bcf.viewpoint.updated',
	'bcf.viewpoint.deleted',
	'file.created',
	'file.updated',
	'file.deleted',
	'file.ready',
	'file.failed',
	'conversion.started',
	'conversion.completed',
	'conversion.failed',
	'folder.created',
	'folder.updated',
	'folder.deleted',
	'member.added',
	'member.updated',
	'member.removed',
	'assembly.created',
	'assembly.updated',
	'assembly.deleted',
	'notification.created',
] as const;

export const NOTIFICATION_CREATED = 'notification.created';
export const PING = 'ping';

/** Genres de notification connus. La liste est ouverte côté serveur. */
export const NOTIFICATION_KINDS = [
	'topic.assigned',
	'topic.mentioned',
	'topic.commented',
	'topic.status_changed',
	'topic.due_date_passed',
] as const;

/** Attributs CloudEvents gardés tels quels en sortie, dans cet ordre. */
const ENVELOPE_ATTRIBUTES = [
	'specversion',
	'id',
	'type',
	'source',
	'subject',
	'time',
	'datacontenttype',
	'scenopticactor',
] as const;

export interface ScenopticEvent extends IDataObject {
	id: string;
	type: string;
	source: string;
	data: IDataObject;
}

export function isScenopticEvent(value: unknown): value is ScenopticEvent {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const v = value as IDataObject;
	return (
		typeof v.id === 'string' &&
		typeof v.type === 'string' &&
		typeof v.source === 'string' &&
		v.data !== null &&
		typeof v.data === 'object' &&
		!Array.isArray(v.data)
	);
}

/** `com.scenoptic.bcf.topic.created` → `bcf.topic.created`. */
export function shortEventType(type: string): string {
	return type.startsWith(EVENT_TYPE_PREFIX) ? type.slice(EVENT_TYPE_PREFIX.length) : type;
}

/** `source` vaut `/projects/<id>`. */
export function projectIdFromSource(source: string): string | undefined {
	const match = /^\/projects\/([^/]+)$/.exec(source);
	return match ? match[1] : undefined;
}

/**
 * Sortie du Trigger : attributs de l'enveloppe, `event` (type court), `project_id`, puis les
 * clés de `data` au premier niveau. Une clé de `data` qui entrerait en collision avec un
 * attribut est renommée `data_<clé>` plutôt que d'écraser l'attribut.
 */
export function flattenEvent(event: ScenopticEvent): IDataObject {
	const out: IDataObject = {};
	for (const key of ENVELOPE_ATTRIBUTES) {
		if (event[key] !== undefined) out[key] = event[key];
	}
	out.event = shortEventType(event.type);
	const projectId = projectIdFromSource(event.source);
	if (projectId) out.project_id = projectId;
	for (const [key, value] of Object.entries(event.data)) {
		out[key in out ? `data_${key}` : key] = value;
	}
	return out;
}

export interface EventFilters {
	/** Destinataire de la notification ; pour `topic.assigned`, la personne affectée. */
	assignedTo?: string;
	notificationKinds?: string[];
}

/**
 * Les filtres ne portent que sur `notification.created` : tout autre événement passe.
 * La comparaison d'e-mail ignore la casse et les espaces autour.
 */
export function passesFilters(event: ScenopticEvent, filters: EventFilters): boolean {
	if (shortEventType(event.type) !== NOTIFICATION_CREATED) return true;
	const notification = (event.data.notification ?? {}) as IDataObject;

	const kinds = filters.notificationKinds ?? [];
	if (kinds.length > 0 && !kinds.includes(String(notification.kind))) return false;

	const wanted = (filters.assignedTo ?? '').trim().toLowerCase();
	if (wanted) {
		const recipient = (notification.recipient ?? {}) as IDataObject;
		const email = typeof recipient.email === 'string' ? recipient.email.trim().toLowerCase() : '';
		if (email !== wanted) return false;
	}
	return true;
}
