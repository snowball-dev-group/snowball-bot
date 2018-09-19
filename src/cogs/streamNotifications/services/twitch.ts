import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError, StreamStatusChangedAction } from "../baseService";
import { IEmbed, sleep, escapeDiscordMarkdown } from "@utils/utils";
import { default as fetch } from "node-fetch";
import { chunk } from "lodash";
import { EventEmitter } from "events";
import { IHashMap } from "../../../types/Types";
import * as getLogger from "loggy";

/*
╔╦╗╔═╗╔═╗╦═╗╔═╗╔═╗╔═╗╔╦╗╔═╗╔╦╗
 ║║║╣ ╠═╝╠╦╝║╣ ║  ╠═╣ ║ ║╣  ║║
═╩╝╚═╝╩  ╩╚═╚═╝╚═╝╩ ╩ ╩ ╚═╝═╩╝

! WARNING !

THIS MODULE IS DEPRECATED AND NO LONGER SUPPORTED

PLEASE AVOID ITS FUTHER USAGE IN YOUR BOT AND CONSIDER SWITCH TO TWITCH_NEW MODULE

*/

const TWITCH_ICON = "https://i.imgur.com/2JHEBZk.png";
const TWITCH_COLOR = 0x6441A4;
const TWITCH_USERNAME_REGEXP = /^[a-zA-Z0-9_]{3,24}$/;
const TWITCH_OFFLINE_BANNER = "https://i.imgur.com/JZdUQZ4.png";

interface IServiceOptions {
	clientId: string;
	updatingInterval: number;
}

interface ICacheItem {
	fetchedAt: number;
	value: ITwitchStream;
}

class TwitchStreamingService extends EventEmitter implements IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.twitch";
	}

	public name = "twitch";

	private readonly log = getLogger("TwitchStreamingService");

	private readonly options: IServiceOptions;

	constructor(options: string | IServiceOptions) {
		super();
		this.isTwitchV5Retired();
		this.options = typeof options === "object" ? options : {
			clientId: options,
			updatingInterval: 120000
		};
		this.log("err", "=== !!!DEPRECATED!!! ===");
		this.log("err", "This module is deprecated and unrecommended to use.");
		this.log("err", "Instead try `twitch_new`, it uses new Twitch API and supports some cool features");
		this.log("err", "Support for old API v5 will be removed on 12/31/2018, on December 30 this module should stop working");
	}

	private isTwitchV5Retired() {
		if (Date.now() > 1546102800000) {
			throw new Error("You cannot use this module anymore. Twitch API v5 is retired");
		}

		return false;
	}

	// ========================================
	//            Subscriptions
	// ========================================

	private readonly subscriptions: IStreamingServiceStreamer[] = [];

	public addSubscription(streamer: IStreamingServiceStreamer) {
		this.isTwitchV5Retired();
		if (this.isSubscribed(streamer.uid)) {
			throw new Error(`Already subscribed to ${streamer.uid}`);
		}

		return this.subscriptions.push(streamer);
	}

	public removeSubscription(uid: string) {
		const index = this.findSubscriptionIndex(uid);
		if (index === -1) {
			throw new Error(`Not subscribed to ${uid}`);
		}
		this.subscriptions.splice(index, 1);
	}

	private findSubscriptionIndex(uid: string) {
		return this.subscriptions.findIndex((s) => s.uid === uid);
	}

	public isSubscribed(uid: string) {
		return this.findSubscriptionIndex(uid) !== -1;
	}

	// ========================================
	//            Fetching interval
	// ========================================

	private interval?: NodeJS.Timer;
	private pendingStart?: NodeJS.Timer;

	public async start(delayed: number = 0) {
		this.isTwitchV5Retired();
		if (this.pendingStart) {
			throw new Error("There's a pending start delayed");
		} else if (this.interval) {
			throw new Error("There's already started fetch interval");
		}
		if (delayed < 0) {
			throw new Error("Invalid `delayed` value");
		} else if (delayed > 0) {
			this.pendingStart = setTimeout(() => {
				this.pendingStart = undefined;
				this.start();
			}, delayed);
		} else {
			this.interval = setInterval(() => this.fetch(this.subscriptions), this.options.updatingInterval);
			await this.fetch(this.subscriptions);
		}
	}

	public async stop() {
		if (!this.interval && !this.pendingStart) {
			throw new Error("There's nor interval nor delayed start");
		} else if (this.pendingStart) {
			clearTimeout(this.pendingStart);
		} else if (this.interval) {
			clearInterval(this.interval);
		}
	}

	// ========================================
	//                Fetching
	// ========================================

	private readonly streamsMap: IHashMap<ICacheItem> = Object.create(null);

	public async fetch(streamers: IStreamingServiceStreamer[]): Promise<void> {
		this.isTwitchV5Retired();

		if (streamers.length < 1) { return; }

		const processChunk = async (chunk: IStreamingServiceStreamer[]) => {
			let streamsResp: {
				streams?: ITwitchStream[]
			} = {};

			try {
				streamsResp = (await this.makeRequest(this.getAPIURL_Streams(chunk.map(s => s.uid))));
			} catch (err) {
				this.log("err", "Error has been received from Twitch, chunk processing failed", err);

				return;
			}

			if (!streamsResp.streams) {
				this.log("warn", "Got empty response from Twitch", streamsResp);

				return;
			}

			for (const streamer of chunk) {
				const stream = streamsResp.streams.find((stream) => {
					return (`${stream.channel._id}`) === streamer.uid;
				});
				const cacheItem = this.streamsMap[streamer.uid];
				if (stream) {
					if (cacheItem) {
						const cachedStream = cacheItem.value;
						let updated = false;
						// Stream name updated
						if (stream.channel.status !== cachedStream.channel.status) { updated = true; }
						// or game
						if (stream.game !== cachedStream.game) { updated = true; }
						// or stream_type (stream -> vodcast)
						if (stream.stream_type !== cachedStream.stream_type) { updated = true; }
						// or id???
						if (stream._id !== cachedStream._id) { updated = true; }
						// or username
						if ((stream.channel.name !== cachedStream.channel.name) || (stream.channel.display_name !== cachedStream.channel.display_name)) {
							// updating username in db too
							streamer.username = stream.channel.display_name || stream.channel.name;
							updated = true;
						}
						// or logo
						if (stream.channel.logo !== cachedStream.channel.logo) { updated = true; }
						// or probably author changed stream to (/from) 18+
						if (stream.channel.mature !== cachedStream.channel.mature) { updated = true; }

						// if yes, we pushing update
						if (updated) {
							this.emit("updated", {
								status: "online",
								streamer,
								id: `${stream._id}`,
								oldId: `${cacheItem.value._id}`,
								updated: true,
								payload: stream
							});
						}
					} else {
						this.emit("online", {
							status: "online",
							streamer,
							id: `${stream._id}`,
							payload: stream
						});
					}
					this.streamsMap[streamer.uid] = {
						fetchedAt: Date.now(),
						value: stream
					};
				} else if (cacheItem) {
					this.emit("offline", {
						status: "offline",
						streamer,
						id: `${cacheItem.value._id}`,
						payload: cacheItem.value
					});
				}
			}
		};

		const chunks = chunk(streamers, 50);
		for (const chunk of chunks) {
			try {
				await processChunk(chunk);
			} catch (err) {
				this.log("warn", "Failed to fetch chunk", err);
			}
		}
	}

	// ========================================
	//                 Discord
	// ========================================

	public async getEmbed(status: IStreamStatus, lang: string): Promise<IEmbed> {
		const stream = <ITwitchStream> status.payload;
		if (!stream) { throw new StreamingServiceError("TWITCH_CACHEFAULT", "Failure"); }
		const gameName = stream.game ? stream.game : $localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN");

		return {
			footer: {
				icon_url: TWITCH_ICON,
				text: "Twitch"
			},
			description: $localizer.getFormattedString(lang, status.status === "online" ? "STREAMING_DESCRIPTION_TWITCH" : "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(stream.channel.display_name || stream.channel.name, true),
				type: stream.stream_type
			}),
			timestamp: stream.created_at,
			thumbnail: {
				url: stream.channel.logo,
				width: 128,
				height: 128
			},
			author: {
				icon_url: stream.channel.logo,
				name: stream.channel.display_name || stream.channel.name,
				url: stream.channel.url
			},
			title: stream.channel.status,
			url: stream.channel.url,
			color: TWITCH_COLOR,
			image: {
				url: status.status === "online" ? `${stream.preview.template.replace("{width}", "1280").replace("{height}", "720")}?ts=${Date.now()}` : (
					stream.channel.video_banner || TWITCH_OFFLINE_BANNER
				)
			},
			fields: [{
				inline: gameName.length < 25,
				name: $localizer.getString(lang, "STREAMING_GAME_NAME"),
				value: gameName
			}, {
				inline: true,
				name: $localizer.getString(lang, "STREAMING_MATURE_NAME"),
				value: $localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_TWITCH", {
					mature: stream.channel.mature
				})
			}]
		};
	}

	// ========================================
	//                   API
	// ========================================

	private getAPIURL_Streams(ids: string[]) {
		return `https://api.twitch.tv/kraken/streams/?channel=${ids.join(",")}&stream_type=all&client_id=${this.options.clientId}&api_version=5`;
	}

	private getAPIURL_User(username: string | string[]) {
		const uidsStr = username instanceof Array ? username.join(",") : username;

		return `https://api.twitch.tv/kraken/users?login=${uidsStr}&client_id=${this.options.clientId}&api_version=5`;
	}

	public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
		this.isTwitchV5Retired();
		if (!TWITCH_USERNAME_REGEXP.test(username)) {
			throw new StreamingServiceError("TWITCH_INVALIDUSERNAME", "Invalid username.");
		}

		const foundUsers = (<{
			users: ITwitchUser[]
		}> await this.makeRequest(this.getAPIURL_User(username))).users;

		if (foundUsers.length === 0) {
			throw new StreamingServiceError("TWITCH_USERNOTFOUND", "User not found.");
		} else if (foundUsers.length > 1) {
			throw new StreamingServiceError("TWITCH_INVALIDRESPONSE", "Invalid response received.");
		}

		// this one is amazing <3
		const user = foundUsers[0];

		return {
			serviceName: this.name,
			uid: user._id,
			username: user.display_name || user.name
		};
	}

	private async makeRequest(uri: string): Promise<any> {
		const loop = async (attempt: number = 0) => {
			if (attempt > 3) {
				throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
			}
			const resp = await fetch(uri);
			if (resp.status === 429) {
				const delay = parseInt(resp.headers.get("retry-after") || "5000", 10);
				this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
				await sleep(delay);

				return loop(attempt + 1);
			} else if (resp.status !== 200) {
				throw new StreamingServiceError("TWITCH_REQ_ERROR", "Error has been received from Twitch", {
					status: resp.status,
					body: (await resp.text())
				});
			}

			return resp.json();
		};

		return loop();
	}

	// ========================================
	//              Module Stuff
	// ========================================

	public emit(type: StreamStatusChangedAction, update: IStreamStatus) {
		return super.emit(type, update);
	}

	public async unload() {
		for (const key in this.streamsMap) {
			delete this.streamsMap[key];
		}

		return true;
	}
}

interface ITwitchUser {
	/** Username with saved cAsE (to display) */
	display_name: string;
	/** ID */
	_id: string;
	/** Username */
	name: string;
}

interface ITwitchChannel extends ITwitchUser {
	/** Mature? */
	mature: boolean;
	/** Game name */
	game: string;
	/** Language */
	language?: string;
	/** Channel owner avy */
	logo: string;
	/** Banned */
	video_banner?: string;
	/** Url to stream */
	url: string;
	/** Current name of stream */
	status: string;
	/** Broadcaster language */
	broadcaster_language?: string;
}

interface ITwitchStream {
	/** Stream ID */
	"_id": number;
	/** Current game name */
	"game": string;
	/** Platform broadcaster streams at */
	"broadcast_platform": string;
	/** Current number of viewers */
	"viewers": number;
	/** Video height */
	"video_height": number;
	/** Average FPS */
	"average_fps": number;
	/** If streamer uses delay it would be here */
	"delay": number;
	/** ISO Date when stream started */
	"created_at": string;
	/** It's vodcast? */
	"is_playlist": boolean;
	/** Type of stream */
	"stream_type": "live" | "playlist" | "all";
	/** Previews */
	"preview": {
		"small": string;
		"medium": string;
		"large": string;
		"template": string;
	};
	/** Channel, lol */
	"channel": ITwitchChannel;
}

module.exports = TwitchStreamingService;
