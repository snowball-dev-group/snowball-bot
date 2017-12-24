import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError, StreamStatusChangedAction } from "../baseService";
import { IEmbed, sleep, getLogger, escapeDiscordMarkdown, IEmbedOptionsField } from "../../utils/utils";
import { default as fetch } from "node-fetch";
import { chunk } from "lodash";
import { EventEmitter } from "events";
import { IHashMap } from "../../../types/Interfaces";

const TWITCH_ICON = "https://i.imgur.com/2JHEBZk.png";
const TWITCH_COLOR = 0x6441A4;
const TWITCH_USERNAME_REGEXP = /^[a-zA-Z0-9_]{3,24}$/;
const TWITCH_OFFLINE_BANNER = "https://pages.dafri.top/sb-res/offline_twitch.png";

const DEFAULT_UPDATE_INTERVAL = 150000;
const POSSIBLE_METADATA_GAMEIDS = [{ // hardcoded stuff isn't okay ikr
	name: "Hearthstone",
	id: "138585"
}, {
	name: "Overwatch",
	id: "488552"
}];
const EMOJI_ID_REGEX = /[0-9]{17,19}/;
const EXLUDED_USER_PROPS_OFUPD = ["offline_banner"];

const CACHEDIFF_METADATA = 148888; // almost 2.5 minutes (fetching reason in not exactly count)
const CACHEDIFF_GAME = 7200000; // 2 hours
const CACHEDIFF_USER = 1200000; // 20 minutes

interface IServiceOptions {
	clientId: string;
	updatingInterval: number;
	emoji: IHashMap<string|undefined>;
}

interface ICacheItem<T> {
	fetchedAt: number;
	value: T;
}

class TwitchStreamingService extends EventEmitter implements IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.twitch_new";
	}

	public name = "twitch_new";

	private log = getLogger("TwitchNewStreamingService");

	private options: IServiceOptions;

	constructor(options: IServiceOptions) {
		super();

		if(!options) { throw new Error("No options passed"); }

		const missingProp = ["clientId", "emoji"].find(prop => !options[prop]);
		if(missingProp) {
			throw new Error(`Property "${missingProp}" seems to be missed in the options passed`);
		}

		if(!options.updatingInterval) {
			options.updatingInterval = DEFAULT_UPDATE_INTERVAL;
		} else {
			options.updatingInterval = Math.max(options.updatingInterval, DEFAULT_UPDATE_INTERVAL);
		}

		for(const gameId in options.emoji) {
			const id = options.emoji[gameId];
			if(!id) { continue; } // typescript magic!

			if(!EMOJI_ID_REGEX.test(id)) {
				throw new Error(`Invalid emoji ID provided for "${gameId}"`);
			}

			const emoji = $discordBot.emojis.get(id);
			if(!emoji) {
				throw new Error(`Emoji with ID "${id}" not found`);
			}

			options.emoji[gameId] = emoji.toString();
		}

		this.options = options;
		this.subscriptions = [];
	}

	// ========================================
	//            Subscriptions
	// ========================================

	private subscriptions: IStreamingServiceStreamer[];

	public addSubscription(streamer: IStreamingServiceStreamer) {
		if(this.isSubscribed(streamer.uid)) {
			throw new Error(`Already subscribed to ${streamer.uid}`);
		}
		this.subscriptions.push(streamer);
	}

	public removeSubscribtion(uid: string) {
		let index = this.findSubscriptionIndex(uid);
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
	//            Fetching interval
	// ========================================

	private interval?: NodeJS.Timer;
	private pendingStart?: NodeJS.Timer;

	public async start() {
		this.log("info", "Starting up with subsbriptions:", this.subscriptions);
		this.interval = setInterval(() => this.fetch(this.subscriptions), this.options.updatingInterval);
		await this.fetch(this.subscriptions);
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
	//                Fetching
	// ========================================

	private streamsStore: IHashMap<ICacheItem<ITwitchStream|null>|undefined> = {};
	private gamesStore: IHashMap<ICacheItem<ITwitchGame>|undefined> = {};
	private metadataStore: IHashMap<ICacheItem<ITwitchMetadata>|undefined> = {};
	private usersStore: IHashMap<ICacheItem<ITwitchUser>|undefined> = {};
	private currentPayloadsStore: IHashMap<ICacheItem<ITwitchNewPluginPayload|null>|undefined> = {};

	public async createPayloads(uids: string[]) : Promise<IHashMap<ITwitchNewPluginPayload|null|undefined>> {
		// to fetch:
		const fetchStreams: string[] = [];
		const fetchGames: string[] = [];
		const fetchMetadata: string[] = [];
		const fetchUsers: string[] = [];

		const ready: IHashMap<ITwitchNewPluginPayload|null|undefined> = {};

		for(const uid of uids) {
			const streamCache = this.streamsStore[uid];
			if(!streamCache || (Date.now() - streamCache.fetchedAt) > this.options.updatingInterval) {
				fetchStreams.push(uid);
			}
		}

		for(const _chunk of chunk(fetchStreams, 20)) { // small chunking in 20 users
			const fetchedStreams = await this.makeRequest<ITwitchPagenatedResponse<ITwitchStream>>(this.getAPIURL_Streams(_chunk));
			const fetchEndedAt = Date.now();

			// let's start the assignation process

			const streams: IHashMap<ITwitchStream|null|undefined> = {};
			for(const fetchedStream of fetchedStreams.data) {
				streams[fetchedStream.user_id] = fetchedStream;
			}

			for(const uid of _chunk) {
				const stream = streams[uid];
				if(!stream) {
					// was required in fetch, but not found in result
					// means it is "offline"
					this.streamsStore[uid] = {
						fetchedAt: fetchEndedAt,
						value: null
					};
					continue;
				}
				this.streamsStore[uid] = {
					fetchedAt: fetchEndedAt,
					value: stream
				};
			}
		}

		for(const uid of uids) {
			const streamCache = this.streamsStore[uid];
			const stream = streamCache ? streamCache.value : undefined;
			if(stream === null) { ready[uid] = null; continue; }
			else if(!stream) { continue; }
			
			if(stream.game_id) {
				const game = this.gamesStore[stream.game_id];
				if(!game || ((Date.now() - game.fetchedAt) > CACHEDIFF_GAME)) {
					fetchGames.push(stream.game_id);
				}
			}

			if(POSSIBLE_METADATA_GAMEIDS.find(g => g.id === stream.game_id)) {
				const metadata =  this.metadataStore[uid];
				if(!metadata || (Date.now() - metadata.fetchedAt) > CACHEDIFF_METADATA) {
					fetchMetadata.push(uid);
				}
			}

			const user = this.usersStore[stream.user_id];
			if(!user || ((Date.now() - user.fetchedAt) > CACHEDIFF_USER)) {
				fetchUsers.push(stream.user_id);
			}
		}

		for(const gameIds of chunk(fetchGames, 20)) {
			const fetchedGames = await this.makeRequest<ITwitchPagenatedResponse<ITwitchGame>>(this.getAPIURL_Games(gameIds));
			const fetchedAt = Date.now();
			for(const game of fetchedGames.data) {
				this.gamesStore[game.id] = {
					fetchedAt: fetchedAt, value: game
				};
			}
		}

		for(const uids of chunk(fetchMetadata, 20)) {
			const fetchedMetadata = await this.makeRequest<ITwitchPagenatedResponse<ITwitchMetadata>>(this.getAPIURL_Metadata(uids));
			const fetchedAt = Date.now();
			for(const metadata of fetchedMetadata.data) {
				this.metadataStore[metadata.user_id] = {
					fetchedAt, value: metadata
				};
			}
		}

		for(const uids of chunk(fetchUsers)) {
			const fetchedUsers = await this.makeRequest<ITwitchPagenatedResponse<ITwitchUser>> (this.getAPIURL_User(uids, true));
			const fetchedAt = Date.now();
			for(const user of fetchedUsers.data) {
				this.usersStore[user.id] = {
					fetchedAt, value: user
				};
			}
		}

		for(const uid of uids) {
			if(ready[uid] === null && !!ready[uid]) { continue; } // ignoring duplicates and nulls

			const streamCache = this.streamsStore[uid];
			const stream = streamCache ? streamCache.value : undefined;

			if(!stream) { continue; }

			const userCache = this.usersStore[stream.user_id];
			const user = userCache ? userCache.value : undefined;

			if(!user) { continue; }

			const gameCache = stream.game_id ? this.gamesStore[stream.game_id] : undefined;
			const game = gameCache ? gameCache.value : undefined;
			const metadataCache = game ? this.metadataStore[stream.user_id] : undefined;
			const metadata = metadataCache ? metadataCache.value : undefined;
			const emoji = game ? this.options.emoji[game.id] : undefined;

			ready[uid] = {
				game: game ? (emoji ? { emoji, ...game } : game) : undefined,
				metadata: metadata && (game && game.id === metadata.game_id) ? {
					...metadata
				} : undefined,
				id: stream.id,
				title: stream.title,
				previewUri: stream.thumbnail_url,
				startedAt: stream.started_at,
				streamer: {
					avatar: user.profile_image_url,
					displayName: user.display_name || user.login,
					id: user.id,
					login: user.login,
					offlineBanner: user.offline_image_url
				},
				type: stream.type,
				viewers: stream.viewer_count
			};
		}

		return ready;
	}

	public async fetch(streamers: IStreamingServiceStreamer[]): Promise<void> {
		if(streamers.length === 0) {
			this.log("warn", "Passed zero subscriptions!");
			return;
		}
		const createPayloads: string[] = [];
		for(const streamer of streamers) {
			createPayloads.push(streamer.uid);
		}
		
		const createdPayloads = await this.createPayloads(createPayloads);
		const createdAt = Date.now();

		for(const streamer of streamers) {
			const uid = streamer.uid;
			const activePayloadCache = this.currentPayloadsStore[uid];
			const activePayload = activePayloadCache ? activePayloadCache.value : undefined;
			const createdPayload = createdPayloads[uid];

			if(createdPayload) {
				if(createdPayload && !activePayload) {
					this.emit("online", {
						id: createdPayload.id,
						streamer,
						status: "online",
						payload: createdPayload
					});
				} else if(createdPayload && activePayload) {
					// check if stream is updated
					
					let _updated: string|undefined = undefined;
					const isUpdated = !!(_updated = (() => {
						if(createdPayload.title !== activePayload.title) {
							return "title";
						}

						if(createdPayload.id !== activePayload.id) {
							return "id";
						}

						if(createdPayload.type !== activePayload.type) {
							return "type";
						}

						if(createdPayload.game && activePayload.game) {
							if(createdPayload.game.id !== activePayload.game.id) {
								return "game:id";
							}
						}

						for(const prop in createdPayload.streamer) {
							if(EXLUDED_USER_PROPS_OFUPD.includes(prop)) { continue; }
							if(createdPayload.streamer[prop] !== activePayload.streamer[prop]) {
								return `streamer:${prop}`;
							}
						}

						if(createdPayload.metadata && !activePayload.metadata) {
							return "metadata#created";
						} else if(createdPayload.metadata && activePayload.metadata && createdPayload.metadata !== activePayload.metadata) {
							return "metadata#updated";
						} else if(!createdPayload.metadata && activePayload.metadata) {
							return "metadata#removed";
						}

						return undefined;
					})());

					if(isUpdated) {
						this.log("info", `Pushing update for streamer ${streamer.uid}: ${_updated}`);
						this.emit("updated", {
							updated: true,
							id: createdPayload.id,
							oldId: activePayload.id,
							payload: createdPayload,
							status: "online",
							streamer
						});
					}
				}

				this.currentPayloadsStore[uid] = {
					fetchedAt: createdAt,
					value: createdPayload
				};
			} else if(!createdPayload && activePayload) {
				// stream has gone offline or not fetched
				// null = offline, undefined = by some reason not created
				this.emit("offline", {
					id: activePayload.id,
					payload: activePayload,
					status: "offline",
					streamer
				});
				delete this.currentPayloadsStore[uid];
			}
		}
	}

	// ========================================
	//                 Discord
	// ========================================

	public async getEmbed(streamStatus: IStreamStatus, lang: string): Promise<IEmbed> {
		const payload = <ITwitchNewPluginPayload>streamStatus.payload;
		if(!payload) { throw new StreamingServiceError("TWITCH_CACHEFAULT", "Failure"); }

		const game = payload.game;
		const gameName = game ? game.name : $localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN");
		const gameEmoji = game ? this.options.emoji[game.id] : undefined;
		const streamUri = `https://twitch.tv/${payload.streamer.login}`;
		const isMature = payload.title.includes("[18+]");

		const fields: IEmbedOptionsField[] = [{
			inline: gameName.length < 25,
			name: $localizer.getString(lang, "STREAMING_GAME_NAME"),
			value: (gameEmoji ? `${gameEmoji} ` : "") + gameName
		}, {
			inline: true,
			name: $localizer.getString(lang, "STREAMING_MATURE_NAME"),
			value: $localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_TWITCH", {
				mature: isMature + ""
			})
		}];

		const gameMetadata = payload.game ? payload.metadata : undefined; // in case if metadata provided but game not
		if(gameMetadata) {                                              // yep such thing could happen
			switch(gameMetadata.game_id) {
				case "488552": {
					const owMetadata = gameMetadata.overwatch;
					if(!owMetadata || !owMetadata.broadcaster || !owMetadata.broadcaster.hero) { break; }

					fields.push({
						inline: false,
						name: `${(gameEmoji ? `${gameEmoji} ` : "")}${gameName}`,
						value: $localizer.getFormattedString(lang, "STREAMING_GAME_VALUE_OVERWATCH", {
							name: this.getOverwatchHeroName(owMetadata.broadcaster.hero.name, lang),
							role: this.getOverwatchRoleName(owMetadata.broadcaster.hero.role, lang)
						})
					});
				} break;
				case "138585": {
					const hsMetadata = gameMetadata.hearthstone;
					if(!hsMetadata) { break; }

					const providedMetadata = {
						broadcaster: (!hsMetadata.broadcaster || !hsMetadata.broadcaster.hero),
						opponent: (!hsMetadata.opponent || !hsMetadata.opponent.hero)
					};

					if(!providedMetadata.broadcaster && !providedMetadata.opponent) { break; }

					let str = "";

					if(providedMetadata.broadcaster) {
						str += $localizer.getFormattedString(lang, "STREAMING_GAME_VALUE_HEARTHSTONE", {
							target: "broadcaster",
							...hsMetadata.broadcaster.hero
						}) + "\n";
					}

					if(providedMetadata.opponent) {
						str += $localizer.getFormattedString(lang, "STREAMING_GAME_VALUE_HEARTHSTONE", {
							target: "opponent",
							...hsMetadata.broadcaster.hero
						});
					}

					if(str.length === 0) { break; }

					fields.push({
						inline: false,
						name: `${(gameEmoji ? `${gameEmoji} ` : "")}${gameName}`,
						value: str
					});
				} break;
			}
		}

		return {
			footer: {
				icon_url: TWITCH_ICON,
				text: "Twitch (beta)"
			},
			description: $localizer.getFormattedString(lang, streamStatus.status === "online" ? "STREAMING_DESCRIPTION_TWITCH" : "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(payload.streamer.displayName, true),
				type: payload.type
			}),
			timestamp: payload.startedAt,
			thumbnail: {
				url: payload.streamer.avatar,
				width: 128,
				height: 128
			},
			author: {
				icon_url: payload.streamer.avatar,
				name: payload.streamer.displayName,
				url: streamUri
			},
			title: payload.title,
			url: streamUri,
			color: TWITCH_COLOR,
			image: {
				url: streamStatus.status === "online" ? payload.previewUri.replace("{width}", "1280").replace("{height}", "720") + `?ts=${Date.now()}` : (
					payload.streamer.offlineBanner || TWITCH_OFFLINE_BANNER
				)
			},
			fields
		};
	}

	// ========================================
	//                   API
	// ========================================

	private getAPIURL_Streams(ids: string[]) {
		let apiUri = `https://api.twitch.tv/helix/streams?type=all`;
		for(const id of ids) { apiUri += `&user_id=${id}`; }
		return apiUri;
	}

	private getAPIURL_User(username: string[], ids = false) {
		let apiUri = `https://api.twitch.tv/helix/users`;
		for(let i = 0; i < username.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}${ids ? "id" : "login"}=${username[i]}`;
		}
		return apiUri;
	}

	private getAPIURL_Metadata(ids: string[]) {
		let apiUri = "https://api.twitch.tv/helix/streams/metadata";
		for(let i = 0; i < ids.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}user_id=${ids[i]}`;
		}
		return apiUri;
	}

	private getAPIURL_Games(ids: string[]) {
		let apiUri = "https://api.twitch.tv/helix/games";
		for(let i = 0; i < ids.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}id=${ids[i]}`;
		}
		return apiUri;
	}

	private getOverwatchHeroName(name: string, lang: string) {
		switch(name) {
			case "Soldier: 76": { name = "SOLDIER76"; }
			default: { name = name.toUpperCase(); }
		}
		return $localizer.getString(lang, `OVERWATCH_HERO_${name}`);
	}

	private getOverwatchRoleName(role: string, lang: string) {
		return $localizer.getString(lang, `OVERWATCH_ROLE_${role.toUpperCase()}`);
	}

	public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
		if(!TWITCH_USERNAME_REGEXP.test(username)) {
			throw new StreamingServiceError("TWITCH_INVALIDUSERNAME", "Invalid username.");
		}

		const foundUsers = await this.makeRequest<ITwitchPagenatedResponse<ITwitchUser>>(this.getAPIURL_User([username]));

		if(foundUsers.data.length === 0) {
			throw new StreamingServiceError("TWITCH_USERNOTFOUND", "User not found.");
		} else if(foundUsers.data.length > 1) {
			throw new StreamingServiceError("TWITCH_INVALIDRESPONSE", "Invalid response received.");
		}

		// this one is amazing <3
		const user = foundUsers.data[0];

		return {
			serviceName: this.name,
			uid: user.id,
			username: user.display_name || user.login
		};
	}

	private async makeRequest<T>(uri: string): Promise<T> {
		let loop = async (attempt: number = 0) => {
			if(attempt > 3) {
				throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
			}
			let resp = await fetch(uri, {
				headers: {
					"Client-ID": this.options.clientId
				}
			});
			if(resp.status === 429) {
				let delay = parseInt(resp.headers.get("retry-after") || "5000", 10);
				this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
				await sleep(delay);
				return await loop(attempt + 1);
			} else if(resp.status !== 200) {
				throw new StreamingServiceError("TWITCH_REQ_ERROR", "Error has been received from Twitch", {
					status: resp.status,
					body: (await resp.text())
				});
			}
			return await resp.json();
		};
		return <T>(await loop());
	}

	// ========================================
	//              Module Stuff
	// ========================================

	public emit(type: StreamStatusChangedAction, update: IStreamStatus) {
		return super.emit(type, update);
	}

	async unload() {
		for(let key in this.streamsStore) {
			delete this.streamsStore[key];
		}
		return true;
	}
}

type PossibleTwitchStreamTypes = "live" | "vodcast" | "offline";

interface ITwitchOverwatchMetadata {
	hero: {
		ability: string;
		name: string;
		role: string;
	};
}

interface ITwitchHearthstoneMetadata {
	hero: {
		class: string;
		name: string;
		type: string
	};
}

interface ITwitchNewPluginPayload {
	id: string;
	game?: ITwitchGame & {
		emoji?: string
	};
	viewers: string;
	startedAt: string;
	title: string;
	previewUri: string;
	streamer: {
		login: string;
		displayName: string;
		id: string;
		avatar: string;
		offlineBanner: string;
	};
	metadata?: ITwitchMetadata;
	type: PossibleTwitchStreamTypes;
}

interface ISharedMetadata {
	overwatch?: {
		broadcaster: ITwitchOverwatchMetadata
	};
	hearthstone?: {
		broadcaster: ITwitchHearthstoneMetadata;
		opponent: ITwitchHearthstoneMetadata;
	};
}

interface ITwitchMetadata extends ISharedMetadata {
	game_id: string;
	user_id: string;
}

interface ITwitchStream {
	id: string;
	user_id: string;
	game_id: string;
	community_ids: string[];
	type: PossibleTwitchStreamTypes;
	title: string;
	viewer_count: string;
	language?: string;
	thumbnail_url: string;
	started_at: string;
}

interface ITwitchUser {
	id: string;
	login: string;
	display_name: string;
	type: "staff" | "admin" | "global_mod" | "";
	broadcaster_type: "partner" | "affiliate" | "";
	description: string;
	profile_image_url: string;
	offline_image_url: string;
	view_count: number;
}

interface ITwitchPagenatedResponse<T> {
	data: T[];
	pagination?: { cursor: string };
}

interface ITwitchGame {
	id: string;
	name: string;
	box_art_url: string;
}

module.exports = TwitchStreamingService;
