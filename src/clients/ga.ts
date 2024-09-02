import axios, { AxiosInstance } from "axios";

interface GaOptions {
	id: string;
	secret: string;
}

interface TrackOpts {
	event: string;
	location: string;
	params: {
		[key: string]: string | number;
	};
	session: {
		id: string;
		startedAt: number;
		lastActiveAt: number;
	};
	userId: string;
}

export class GaClient {
	client: AxiosInstance;

	constructor(private options: GaOptions) {
		this.client = axios.create({
			baseURL: "https://www.google-analytics.com/mp",
			headers: {
				"Content-Type": "application/json",
			},
			params: {
				measurement_id: options.id,
				api_secret: options.secret,
			},
		});
	}

	async track(opts: TrackOpts) {
		if (!this.options.secret) {
			console.warn("No GA secret provided, skipping GA tracking");
			return;
		}

		const body = {
			client_id: opts.userId,
			user_id: opts.userId,
			events: [
				{
					name: opts.event,
					params: {
						page_location: opts.location,
						...opts.params,
						session_id: opts.session.id,
						timestamp_millis: opts.session.lastActiveAt,
						engagement_time_msec:
							opts.session.lastActiveAt - opts.session.startedAt,
					},
				},
			],
		};

		await this.client.post("/collect", body).catch((err) => {
			console.error(err);
		});
	}
}

export const gaClient = new GaClient({
	id: "G-HB0VNVBEDQ",
	secret: process.env["GA_SECRET"] as string,
});
