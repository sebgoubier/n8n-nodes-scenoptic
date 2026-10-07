import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Jeton d'accès personnel (`scn_pat_…`) envoyé en `Authorization: Bearer`. L'URL de base est
 * réglable pour une installation On-Premise ; la barre oblique finale est retirée partout.
 */
export class ScenopticApi implements ICredentialType {
	name = 'scenopticApi';

	displayName = 'Scenoptic API';

	icon: Icon = { light: 'file:../icons/scenoptic.svg', dark: 'file:../icons/scenoptic.dark.svg' };

	documentationUrl = 'https://cde.scenoptic.com/api/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://cde.scenoptic.com',
			placeholder: 'https://cde.example.com',
			required: true,
			description: 'Root URL of the Scenoptic CDE. Change it for an on-premise installation.',
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'scn_pat_…',
			description:
				'Personal access token, created in Scenoptic under My account > Access tokens. Grant the scopes the nodes need: projects:read, bcf:read, bcf:write, webhooks:manage.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.trim().replace(/\\/+$/, "")}}',
			url: '/foundation/1.1/current-user',
			method: 'GET',
		},
	};
}
