import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, escapeDiscordMarkdown } from "../../utils/utils";
import { default as fetch } from "node-fetch";
import { EventEmitter } from "events";
import { IHashMap } from "../../../types/Interfaces";

const MAX_CHANNEL_CACHE_LIFE = 600000;  // ms
const YOUTUBE_ICON = "https://i.imgur.com/ZvRybuh.png";
const YOUTUBE_COLOR = 0xCD201F;
const YOUTUBE_OFFLINE_BANNER = "https://pages.dafri.top/sb-res/offline_youtube.png";
// const YOUTUBE_ID_REGEXP = /^[a-zA-Z0-9\_\-]{23,26}$/;

interface ICacheItem<T> {
	cachedAt: number;
	value: T;
}

interface IServiceOptions {
	apiKey: string;
	updatingInterval: number;
}

class YouTubeStreamingService extends EventEmitter implements IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.youtube";
	}

	public name = "youtube";

	private options: IServiceOptions;

	constructor(options: string | IServiceOptions) {
		super();
		this.options = typeof options === "object" ? options : {
			apiKey: options,
			updatingInterval: 300000
		};
	}

	// ========================================
	//             Subscriptions
	// ========================================

	private subscriptions: IStreamingServiceStreamer[] = [];

	public addSubscription(streamer: IStreamingServiceStreamer) {
		if(this.isSubscribed(streamer.uid)) {
			throw new Error(`Already subscribed to ${streamer.uid}`);
		}
		return this.subscriptions.push(streamer);
	}

	public removeSubscription(uid: string) {
		const index = this.findSubscriptionIndex(uid);
		if(index === -1) {
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
	//           Fetching interval
	// ========================================

	private interval?: NodeJS.Timer;
	private pendingStart?: NodeJS.Timer;

	public async start(delayed: number = 0) {
		if(this.pendingStart) {
			throw new Error("There's a pending start delayed");
		} else if(this.interval) {
			throw new Error("There's already started fetch interval");
		}
		if(delayed < 0) {
			throw new Error("Invalid `delayed` value");
		} else if(delayed > 0) {
			this.pendingStart = setTimeout(() => {
				this.pendingStart = undefined;
				this.start();
			}, delayed);
		} else {
			await this.fetch(this.subscriptions);
			this.interval = setInterval(() => this.fetch(this.subscriptions), this.options.updatingInterval);
		}
	}

	public async stop() {
		if(!this.interval && !this.pendingStart) {
			throw new Error("There's nor interval nor delayed start");
		} else if(this.pendingStart) {
			clearTimeout(this.pendingStart);
		} else if(this.interval) {
			clearInterval(this.interval);
		}
	}

	// ========================================
	//              Fetching
	// ========================================

	private streamsCache: IHashMap<ICacheItem<IYouTubeVideo>> = {};
	private channelCache: IHashMap<ICacheItem<IYouTubeChannel>> = {};

	public async fetch(streamers: IStreamingServiceStreamer[]): Promise<void> {
		for(const streamer of streamers) {
			const resp = await fetch(this.getAPIURL_Stream(streamer.uid));
			if(resp.status !== 200) { continue; }
			const videos = (await resp.json()) as IYouTubeListResponse<IYouTubeVideo>;
			if(videos.items.length === 0) {
				// probably we had stream before
				const cachedStream = this.streamsCache[streamer.uid];
				if(cachedStream) {
					this.emit("offline", {
						status: "offline",
						streamer,
						id: cachedStream.value.id.videoId,
						payload: cachedStream.value
					});
					// deleting old copy
					delete this.streamsCache[streamer.uid];
				}
			} else if(videos.items.length === 1) {
				// what if we had old version?
				const cachedVersion = this.streamsCache[streamer.uid];
				const newStream = videos.items[0];
				if(cachedVersion) {
					const cachedStream = cachedVersion.value;

					let updated = false;

					if(newStream.id.videoId !== cachedStream.id.videoId) { updated = true; }
					if(newStream.snippet.title !== cachedStream.snippet.title) { updated = true; }

					if(updated) {
						this.emit("updated", {
							status: "online",
							streamer,
							id: newStream.id.videoId,
							updated: true,
							oldId: cachedStream.id.videoId,
							payload: newStream
						});
					}
				} else {
					this.emit("updated", {
						status: "online",
						streamer,
						id: newStream.id.videoId,
						payload: newStream
					});
				}

				this.streamsCache[streamer.uid] = {
					cachedAt: Date.now(),
					value: newStream
				};
			} else if(videos.items.length > 1) {
				continue;
			}
		}
	}

	// ========================================
	//              Discord
	// ========================================

	public async getEmbed(stream: IStreamStatus, lang: string): Promise<IEmbed> {
		const cachedStream = stream.payload as IYouTubeVideo;
		if(!cachedStream) {
			throw new StreamingServiceError("YOUTUBE_CACHENOTFOUND", `Stream cache for channel with ID "${stream.streamer.uid}" not found`);
		}

		let cachedChannel = this.channelCache[stream.streamer.uid];
		if(!cachedChannel || ((Date.now() - cachedChannel.cachedAt) > MAX_CHANNEL_CACHE_LIFE)) {
			const resp = await fetch(this.getAPIURL_Channels(stream.streamer.uid, false));
			if(resp.status !== 200) {
				throw new StreamingServiceError("YOUTUBE_CHANNELFETCH_FAILED", "Fething failed");
			}
			const channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;
			if(channels.length !== 1) {
				throw new StreamingServiceError("YOUTUBE_CHANNELNOTFOUND", "Channel not found");
			}
			cachedChannel = this.channelCache[stream.streamer.uid] = {
				cachedAt: Date.now(),
				value: channels[0]
			};
		}

		if(!cachedChannel) { throw new StreamingServiceError("YOUTUBE_CODEERROR", "Error in caching code. Something went wrong"); }

		const channel = cachedChannel.value;

		return {
			footer: {
				icon_url: YOUTUBE_ICON,
				text: "YouTube"
			},
			thumbnail: {
				url: channel.snippet.thumbnails.high.url,
				width: 128,
				height: 128
			},
			timestamp: cachedStream.snippet.publishedAt,
			author: {
				icon_url: channel.snippet.thumbnails.default.url,
				name: channel.snippet.title,
				url: `https://youtube.com/channel/${channel.id}`
			},
			title: cachedStream.snippet.title,
			url: `https://youtu.be/${cachedStream.id.videoId}`,
			description: $localizer.getFormattedString(lang, stream.status === "online" ? "STREAMING_DESCRIPTION" : "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(channel.snippet.title, true)
			}),
			color: YOUTUBE_COLOR,
			image: {
				url: stream.status === "online" ? cachedStream.snippet.thumbnails.high.url : YOUTUBE_OFFLINE_BANNER
			}
		};
	}

	// ========================================
	//                  API
	// ========================================

	private getAPIURL_Stream(channelId: string) {
		let str = "https://www.googleapis.com/youtube/v3/search";
		str += "?part=snippet";
		str += `&channelId=${channelId}`;
		str += "&type=video";
		str += "&eventType=live";
		str += `&key=${this.options.apiKey}`;
		return str;
	}

	private getAPIURL_Channels(id: string, isUsername = false) {
		let str = "https://www.googleapis.com/youtube/v3/channels";
		str += isUsername ? `?forUsername=${id}` : `?id=${id}`;
		str += "&part=snippet";
		str += `&key=${this.options.apiKey}`;
		return str;
	}

	public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
		const isId = username.startsWith("channel/");
		if(isId) {
			username = username.slice("channel/".length);
		}

		const resp = await fetch(this.getAPIURL_Channels(username, !isId));

		if(resp.status !== 200) {
			throw new StreamingServiceError("YOUTUBE_UNSUCCESSFUL_RESP", "YouTube respond with wrong code, means");
		}

		const channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;
		if(channels.length !== 1) {
			throw new StreamingServiceError("YOUTUBE_USERNOTFOUND", "User not found.");
		}

		const channel = channels[0];
		this.channelCache[channel.id] = {
			cachedAt: Date.now(),
			value: channel
		};

		return {
			serviceName: this.name,
			uid: channel.id,
			username: channel.snippet.title
		};
	}

	// ========================================
	//             Module Stuff
	// ========================================

	async unload() {
		for(const key in this.streamsCache) {
			delete this.streamsCache[key];
		}
		for(const key in this.channelCache) {
			delete this.channelCache[key];
		}
		return true;
	}
}

interface IYouTubeChannel {
	"kind": string;
	"etag": string;
	"id": string;
	"snippet": {
		"title": string;
		"description": string;
		"customUrl": string;
		"publishedAt": string;
		"thumbnails": {
			"default": {
				"url": string;
			};
			"medium": {
				"url": string;
			};
			"high": {
				"url": string;
			};
		};
		"localized": {
			"title": string;
			"description": string;
		};
	};
}

interface IYouTubeListResponse<T> {
	"kind": string;
	"pageInfo": {
		"totalResults": number;
		"resultsPerPage": number;
	};
	"items": T[];
}

interface IYouTubeVideo {
	"kind": string;
	"id": {
		"kind": string;
		"videoId": string;
	};
	"snippet": {
		"publishedAt": string;
		"channelId": string;
		"title": string;
		"description": string;
		"thumbnails": {
			"default": {
				"url": string;
				"width": number;
				"height": number;
			};
			"medium": {
				"url": string;
				"width": number;
				"height": number;
			};
			"high": {
				"url": string;
				"width": number;
				"height": number;
			};
		};
		"channelTitle": string;
		"liveBroadcastContent": string;
	};
}

module.exports = YouTubeStreamingService;
