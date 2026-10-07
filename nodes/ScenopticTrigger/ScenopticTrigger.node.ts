import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getProjects } from '../shared/projects';
import { ROUTES } from '../shared/routes';
import { asNodeError, ScenopticApiError, scenopticApiRequest } from '../shared/transport';
import {
	isScenopticEvent,
	NOTIFICATION_KINDS,
	PING,
	flattenEvent,
	passesFilters,
	shortEventType,
	WEBHOOK_EVENT_TYPES,
	type EventFilters,
} from './envelope';
import { type SignatureVerdict, verifySignature } from './signature';

/**
 * Abonnements mémorisés dans le `staticData` du nœud, et NULLE PART ailleurs : le secret de
 * signature n'est rendu qu'une fois par Scenoptic (création), il ne doit apparaître ni dans
 * les journaux, ni dans une sortie, ni dans un message d'erreur.
 *
 * Rangés par URL de webhook : n8n déroule le même cycle de vie pour l'URL de test
 * (`/webhook-test/…`, « Listen for test event ») et pour celle de production. Un seul
 * emplacement ferait supprimer l'abonnement de production dès qu'on écoute un test.
 */
interface Subscription extends IDataObject {
	webhookId: string;
	webhookSecret: string;
	projectId: string;
}

interface SubscriptionState extends IDataObject {
	subscriptions?: Record<string, Subscription>;
}

interface WebhookResource {
	id: string;
	url: string;
	event_types: string[];
	active: boolean;
	secret?: string;
}

const SIGNATURE_HEADER = 'scenoptic-signature';

function subscriptions(ctx: IHookFunctions | IWebhookFunctions): Record<string, Subscription> {
	const state = ctx.getWorkflowStaticData('node') as SubscriptionState;
	state.subscriptions ??= {};
	return state.subscriptions;
}

function webhookUrl(ctx: IHookFunctions): string {
	const url = ctx.getNodeWebhookUrl('default');
	if (!url) throw new NodeOperationError(ctx.getNode(), 'n8n did not provide a webhook URL');
	return url;
}

function isNotFound(error: unknown): boolean {
	return error instanceof ScenopticApiError && error.problem.status === 404;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Supprime l'abonnement mémorisé pour cette URL ; un 404 (déjà supprimé côté Scenoptic)
 * compte comme un succès. En cas d'autre échec, l'entrée est gardée pour réessayer.
 */
async function deleteSubscription(this: IHookFunctions, url: string): Promise<boolean> {
	const subs = subscriptions(this);
	const sub = subs[url];
	if (sub) {
		try {
			await scenopticApiRequest.call(this, ROUTES.deleteWebhook, {
				params: { id: sub.projectId, wid: sub.webhookId },
			});
		} catch (error) {
			if (!isNotFound(error)) return false;
		}
	}
	delete subs[url];
	return true;
}

export class ScenopticTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scenoptic Trigger',
		name: 'scenopticTrigger',
		icon: { light: 'file:../../icons/scenoptic.svg', dark: 'file:../../icons/scenoptic.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Scenoptic sends a webhook event',
		defaults: { name: 'Scenoptic Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scenopticApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Project Name or ID',
				name: 'projectId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getProjects' },
				required: true,
				default: '',
				description:
					'Scenoptic project to listen to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				options: WEBHOOK_EVENT_TYPES.map((type) => ({ name: type, value: type })),
				description: 'Event types that start the workflow',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Assigned To',
						name: 'assignedTo',
						type: 'string',
						placeholder: 'name@example.com',
						default: '',
						description:
							'Only keep notification.created events sent to this email address. For topic.assigned notifications, this is the person the topic was assigned to. Other event types are not filtered.',
					},
					{
						displayName: 'Notification Kinds',
						name: 'notificationKinds',
						type: 'multiOptions',
						default: [],
						options: NOTIFICATION_KINDS.map((kind) => ({ name: kind, value: kind })),
						description:
							'Only keep notification.created events of these kinds. Empty keeps every kind. Other event types are not filtered.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: { getProjects },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = webhookUrl(this);
				const subs = subscriptions(this);
				const sub = subs[url];
				if (!sub) return false;

				let existing: WebhookResource;
				try {
					existing = (await scenopticApiRequest.call(this, ROUTES.getWebhook, {
						params: { id: sub.projectId, wid: sub.webhookId },
					})) as WebhookResource;
				} catch (error) {
					if (isNotFound(error)) {
						delete subs[url];
						return false;
					}
					throw asNodeError(this.getNode(), error, 0);
				}

				const projectId = this.getNodeParameter('projectId') as string;
				const events = this.getNodeParameter('events') as string[];
				const upToDate =
					!!sub.webhookSecret &&
					sub.projectId === projectId &&
					existing.url === url &&
					existing.active === true &&
					sameSet(existing.event_types, events);
				if (upToDate) return true;

				// Abonnement périmé (projet, URL ou événements changés, désactivé côté Scenoptic,
				// secret perdu) : on le supprime pour que `create` en refasse un propre.
				await deleteSubscription.call(this, url);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const projectId = this.getNodeParameter('projectId') as string;
				const events = this.getNodeParameter('events') as string[];
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Select at least one event');
				}
				const url = webhookUrl(this);

				const created = (await scenopticApiRequest.call(this, ROUTES.createWebhook, {
					params: { id: projectId },
					body: {
						url,
						event_types: events,
						description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 200),
					},
				})) as WebhookResource;

				if (typeof created?.id !== 'string' || typeof created.secret !== 'string' || !created.secret) {
					throw new NodeOperationError(
						this.getNode(),
						'Scenoptic did not return the webhook signing secret',
					);
				}
				subscriptions(this)[url] = {
					webhookId: created.id,
					webhookSecret: created.secret,
					projectId,
				};
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return deleteSubscription.call(this, webhookUrl(this));
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const header = this.getHeaderData()[SIGNATURE_HEADER];
		const nowSeconds = Math.floor(Date.now() / 1000);

		// Une signature valide pour l'un de NOS abonnements (test ou production) suffit.
		const secrets = Object.values(subscriptions(this)).map((sub) => sub.webhookSecret);
		let verdict: SignatureVerdict = { ok: false, reason: 'missing_secret' };
		for (const secret of secrets) {
			verdict = verifySignature({ secret, header, rawBody: req.rawBody, nowSeconds });
			if (verdict.ok) break;
		}
		if (!verdict.ok) {
			// Ni le secret, ni la signature attendue ne sortent : seulement la raison du refus.
			res.status(401).json({ message: 'Invalid Scenoptic signature', reason: verdict.reason });
			return { noWebhookResponse: true };
		}

		let event: unknown;
		try {
			event = JSON.parse((req.rawBody as Buffer).toString('utf8'));
		} catch {
			event = undefined;
		}
		if (!isScenopticEvent(event)) {
			res.status(400).json({ message: 'Not a Scenoptic CloudEvents envelope' });
			return { noWebhookResponse: true };
		}

		// Ping et événements écartés par les filtres : 200 sans déclencher. Un refus ferait
		// rejouer la livraison par Scenoptic pour rien.
		const filters = this.getNodeParameter('options', {}) as EventFilters;
		if (shortEventType(event.type) === PING || !passesFilters(event, filters)) {
			res.status(200).json({ received: true, triggered: false });
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray([flattenEvent(event)])] };
	}
}
