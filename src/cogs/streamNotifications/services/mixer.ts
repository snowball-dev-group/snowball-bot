import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError, StreamStatusChangedAction } from "../baseService";
import { IEmbed, sleep, getLogger, escapeDiscordMarkdown } from "../../utils/utils";
import { getUUIDByString } from "../../utils/text";
import { default as fetch } from "node-fetch";
import { Carina } from "carina";
import * as ws from "ws";
import { EventEmitter } from "events";
import { IHashMap } from "../../../types/Interfaces";

Carina.WebSocket = ws;

const MIXER_ICON = "https://i.imgur.com/fQsQPkd.png";
const MIXER_COLOR = 0x1FBAED;
const MIXER_OFFLINE_BANNER = "https://pages.dafri.top/sb-res/offline_mixer.png";

interface ICacheItem {
	startedAt: number;
	channel: IMixerChannel;
}

class MixerStreamingService extends EventEmitter implements IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.mixer";
	}

	public name = "mixer";

	private log = getLogger("MixerStreamingService");

	private ca: Carina;

	constructor(apiKey) {
		super();
		try {
			this.ca = new Carina({
				isBot: true,
				authToken: apiKey,
				autoReconnect: true
			}).on("error", (err) => {
				this.log("err", "Carina error", err);
			});
		} catch(err) {
			this.log("err", "Failed to run plugin", err);
		}
	}

	// ========================================
	//           Updates handlers
	// ========================================

	private _carinaListeners: IHashMap<((data) => void)> = {};
	private currentData: IHashMap<ICacheItem> = {};

	private generateID(cacheItem: ICacheItem) {
		return getUUIDByString(`${this.name.toUpperCase()}::{${cacheItem.startedAt}-${cacheItem.channel.id}}`);
	}

	public async subscribeTo(streamer: IStreamingServiceStreamer) {
		const listener = async (data: IMixerChannel) => {
			/**
			* Cached data to check updates
			*/
			let currentData = this.currentData[streamer.uid];
			if(data.online === true) {
				// stream goes online
				const channel = await this.fetchChannel(streamer.uid);
				if(!channel.online) {
					this.log("warn", "We were notified about starting stream of", streamer.uid, "but channel is offline");
					return;
				}
				// start time
				const startedAt = await this.getStreamStartTime(streamer.uid);
				if(!startedAt) {
					this.log("err", "Unknown error with streamer", streamer.uid);
					return;
				}
				currentData = this.currentData[streamer.uid] = {
					startedAt,
					channel
				};
				this.emit("online", {
					streamer,
					status: "online",
					id: this.generateID(currentData),
					payload: currentData
				});
			} else if(currentData) {
				if(data.online === false) {
					// stream goes offline
					this.emit("offline", {
						streamer,
						status: "offline",
						id: this.generateID(currentData),
						payload: currentData
					});

					delete this.currentData[streamer.uid];
				} else {
					const updated = !!data.name || !!data.audience || data.type !== undefined || (data.user && data.user.avatarUrl);
					if(updated) {
						// getting old id
						const oldId = this.generateID(currentData);

						// updating props
						for(const updated in data) {
							this.currentData[streamer.uid][updated] = data[updated];
						}

						// updating started at time
						const startedAt = await this.getStreamStartTime(streamer.uid);

						// updating cached
						this.currentData[streamer.uid].startedAt = startedAt;

						// updating var
						currentData = this.currentData[streamer.uid];

						// emittin'!
						this.emit("updated", {
							streamer,
							status: "online",
							id: this.generateID(currentData),
							oldId,
							updated: true,
							payload: currentData
						});
					}
				}
			}
		};

		this._carinaListeners[streamer.uid] = listener;
		this.ca.subscribe<IMixerChannel>(`channel:${streamer.uid}:update`, listener);
	}

	// ========================================
	//              Subscriptions
	// ========================================

	public addSubscription(streamer: IStreamingServiceStreamer) {
		if(this.isSubscribed(streamer.uid)) {
			throw new StreamingServiceError("ALREADY_SUBSCRIBED", "Already subscribed to this streamer");
		}
		this.subscribeTo(streamer);
	}

	public removeSubscription(uid: string) {
		const listener = this._carinaListeners[uid];
		if(listener) {
			this.ca.unsubscribe(`channel:${uid}:update`);
			delete this._carinaListeners[uid];
		}
	}

	public isSubscribed(uid: string) {
		return !!this._carinaListeners[uid];
	}

	// ========================================
	//                   API
	// ========================================

	public async fetchChannel(uid: string): Promise<IMixerChannel> {
		return (await this.makeRequest(this.getAPIURL_Channel(uid))) as IMixerChannel;
	}

	public async getStreamStartTime(uid: string): Promise<number> {
		return new Date(((await this.makeRequest(`${this.getAPIURL_Channel(uid)}/manifest.light2`)) as {
			now: string,
			startedAt: string
		}).startedAt).getTime();
	}

	public getAPIURL_Channel(username: string) {
		return `https://mixer.com/api/v1/channels/${username}`;
	}

	public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
		const json = (await this.makeRequest(this.getAPIURL_Channel(username))) as IMixerChannel;
		return {
			serviceName: this.name,
			uid: json.id + "",
			username: json.token
		};
	}

	private async makeRequest(uri: string, attempt: number = 0): Promise<any> {
		const resp = await fetch(uri);
		if(resp.status === 429) {
			const delay = parseInt(resp.headers.get("retry-after"), 10);
			this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
			await sleep(delay);
			return await this.makeRequest(uri, attempt + 1);
		} else if(resp.status === 404) {
			throw new StreamingServiceError("MIXER_NOTFOUND", "Resource not found");
		}
		return (await resp.json());
	}

	// ========================================
	//                 Discord
	// ========================================

	public async getEmbed(stream: IStreamStatus, lang: string): Promise<IEmbed> {
		const cache = stream.payload as ICacheItem;
		if(!cache) {
			throw new StreamingServiceError("MIXER_CACHEFAULT", "Failure: payload not found");
		}
		const gameName = cache.channel.type ? cache.channel.type.name : $localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN");
		return {
			footer: {
				icon_url: MIXER_ICON,
				text: "Mixer"
			},
			timestamp: cache.channel.updatedAt,
			author: {
				icon_url: cache.channel.user.avatarUrl,
				name: cache.channel.user.username,
				url: `https://mixer.com/${cache.channel.token}`
			},
			thumbnail: {
				width: 128,
				height: 128,
				url: cache.channel.user.avatarUrl || MIXER_ICON
			},
			description: $localizer.getFormattedString(lang, stream.status === "online" ? "STREAMING_DESCRIPTION" : "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(cache.channel.user.username, true)
			}),
			title: cache.channel.name,
			url: `https://mixer.com/${cache.channel.token}`,
			color: MIXER_COLOR,
			image: {
				url: stream.status === "online" ? `https://thumbs.beam.pro/channel/${cache.channel.id}.big.jpg?ts=${Date.now()}` : (
					cache.channel.bannerUrl || MIXER_OFFLINE_BANNER
				)
			},
			fields: [{
				inline: gameName.length < 25,
				name: $localizer.getString(lang, "STREAMING_GAME_NAME"),
				value: gameName
			}, {
				inline: true,
				name: $localizer.getString(lang, "STREAMING_MATURE_NAME"),
				value: $localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_MIXER", {
					audience: cache.channel.audience
				})
			}]
		};
	}

	// ========================================
	//              Module Stuff
	// ========================================

	public async start() {
		this.ca.open();
	}

	public emit(type: StreamStatusChangedAction, update: IStreamStatus) {
		return super.emit(type, update);
	}

	async unload() {
		for(const uid in this._carinaListeners) {
			this.removeSubscription(uid);
		}
		return true;
	}
}

interface IMixerChannel {
	/**
	 * Channel ID
	 */
	id: string;
	/**
	 * Channel name
	 */
	token: string;
	/**
	 * Name of the stream
	 */
	name: string;
	/**
	 * Viewers (current)
	 */
	viewersCurrent: number;
	/**
	 * Viewers (total)
	 */
	viewersTotal: number;
	/**
	 * Followers
	 */
	numFollowers: number;
	/**
	 * Latest time channel was updated (streaming also updates it)
	 */
	updatedAt: string;
	/**
	 * Details about game
	 */
	type: {
		/**
		 * Name of game
		 */
		name: string
	} | null;
	/**
	 * Online?
	 */
	online: boolean;
	/**
	 * User info
	 */
	user: {
		/**
		 * Avy url
		 */
		avatarUrl?: string;
		/**
		 * Username
		 */
		username: string;
	};
	/**
	 * Audience of stream
	 */
	audience: "teen" | "18+" | "family";

	/** Link to the banner */
	bannerUrl?: string;
}

module.exports = MixerStreamingService;
