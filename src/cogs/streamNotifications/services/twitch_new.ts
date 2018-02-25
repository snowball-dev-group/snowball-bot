import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError, StreamStatusChangedAction } from "../baseService";
import { IEmbed, sleep, escapeDiscordMarkdown, IEmbedOptionsField } from "../../utils/utils";
import { default as fetch } from "node-fetch";
import { chunk } from "lodash";
import { EventEmitter } from "events";
import { IHashMap, INullableHashMap } from "../../../types/Types";
import * as http from "http";
import * as getURL from "full-url";
import * as Knex from "knex";
import { parse as parseUrl, Url, URL } from "url";
import { randomString } from "../../utils/random";
import { createHmac } from "mz/crypto";
import { getDB } from "../../utils/db";
import * as getLogger from "loggy";

// customize
const TWITCH_ICON = "https://p.dafri.top/snowball/res/twitch_glitch.png";
const TWITCH_COLOR = 0x6441A4;
const TWITCH_USERNAME_REGEXP = /^[a-z0-9_]{3,24}$/;
const TWITCH_OFFLINE_BANNER = "https://pages.dafri.top/sb-res/offline_twitch.png";

// defaults
const DEFAULT_UPDATE_INTERVAL = 150000;
const DEFAULT_TABLENAME = "twitch_new-webhooks";
const DEFAULT_PORT = 5612; // 7

// shared data
const POSSIBLE_METADATA_GAMEIDS = [{ name: "Hearthstone", id: "138585" }, { name: "Overwatch", id: "488552" }];
const EMOJI_ID_REGEX = /[0-9]{17,19}/;
const EXLUDED_USER_PROPS_OFUPD = ["offline_banner"];
const BASE_API_URI = "https://api.twitch.tv/helix";
const TXT_HEADER = { "Content-Type": "text/plain" };

// cache works
const CACHEDIFF_GAME = 18000000; // 5 hours
const CACHEDIFF_USER = 1200000; // 20 minutes
const OFF_METADATA = 5000; // 5 seconds from updating interval
const STREAM_DEATHTIME = 120000; // time after which stream cache expires

// emoji names
const EMOJINAME_UNKNOWN_GAME = "unknown_game";
const EMOJINAME_STREAMING = "streaming";
const EMOJINAME_VODCAST = "vodcast";

// webhooks stuff
const HOOK_LIVETIME = 864000;
const TWITCH_DEATH = 300000;

interface IServiceOptions {
	/**
	 * Twitch Client ID
	 */
	clientId: string;
	/**
	 * Twitch OAuth token.
	 * To obtain use `https://api.twitch.tv/kraken/oauth2/authorize?response_type=token&client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI`.
	 * It generally busts most of requests ratelimits from 30/min. to 120/min.
	 */
	token: string;
	/**
	 * How many time passes after which stream cache dies.
	 * Recommended to leave as default minimum (120000).
	 * This option literally sets how many time required to check if stream is updated
	 */
	streamDeathTime: number;
	/**
	 * Long polling setting of what interval to use to pull updates.
	 * This option also sets metadata death time, calculated by (updatingInverval - 5000).
	 */
	updatingInterval: number;
	/**
	 * Sets the emoji used for game icons.
	 * Literally hash map <Twitch-GameID, Discord-EmojiID>
	 */
	emoji: IHashMap<string | undefined>;
	/**
	 * 
	 */
	useWebhooks: boolean;
	/**
	 * Settings for webhooks.
	 * This is required if `useWebhooks` set to `true`
	 */
	webhooksSettings?: IWebhookSettings;
	/**
	 * Do not set unless you know what it means.
	 * This sets API endpoint
	 */
	baseAPIEndpoint: string;
}

interface IWebhookSettings {
	/**
	 * How many time is hook alive
	 * After hook dies, this script renews it
	 * Recommended to leave to the default value
	 */
	aliveTime: number;
	/**
	 * Host of where this hosts in
	 */
	host: string;
	/**
	 * If you pass the domain here make sure your server has a local proxy to redirect request to this HTTP server.
	 * The flow will be looking like: Twitch (12.23.34.45) → Proxy server (snowball-twitch.example.com) → Webhook server ({host}:1337)
	 */
	domain?: string;
	/**
	 * Specify port
	 */
	port: number;
	/**
	 * Want to have a beautiful path in callback url? OK
	 */
	path: string;
	/**
	 * Is callback URL should be passed in HTTPS?
	 */
	secure: boolean;
	/**
	 * Database settings
	 */
	database: {
		use: boolean;
		tableName: string;
	};
}

class TwitchStreamingService extends EventEmitter implements IStreamingService {
	public get signature() {
		return "snowball.features.stream_notifications.twitch_new";
	}

	public name = "twitch_new";

	private readonly log = getLogger("TwitchNewStreamingService");

	private readonly options: IServiceOptions;

	private webhooksServer: http.Server;

	private _db: Knex;

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

		if(!options.streamDeathTime) {
			options.streamDeathTime = STREAM_DEATHTIME;
		} else {
			options.streamDeathTime = Math.max(options.streamDeathTime, STREAM_DEATHTIME);
		}

		for(const gameId in options.emoji) {
			const id = options.emoji[gameId];
			if(!id) { continue; } // typescript magic!

			if(!EMOJI_ID_REGEX.test(id)) {
				throw new Error(`Invalid emoji ID provided for "${gameId}"`);
			}

			if(id.startsWith("raw:")) {
				options.emoji[gameId] = id.slice("raw:".length);
				continue;
			}

			const emoji = $discordBot.emojis.get(id);
			if(!emoji) {
				throw new Error(`Emoji for "${gameId}" with ID "${id}" not found`);
			}

			options.emoji[gameId] = emoji.toString();
		}

		if(!options.emoji[EMOJINAME_UNKNOWN_GAME]) {
			options.emoji[EMOJINAME_UNKNOWN_GAME] = "❔";
		}

		if(!options.emoji[EMOJINAME_STREAMING]) {
			options.emoji[EMOJINAME_STREAMING] = "🔴";
		}

		if(!options.emoji[EMOJINAME_VODCAST]) {
			options.emoji[EMOJINAME_VODCAST] = "🔵";
		}

		if(options.useWebhooks) {
			// WST: Checking if settings provided
			if(!options.webhooksSettings) {
				throw new Error(`You want to use webhooks but didn't provide the settings. You must provide at least domain in the settings. If your server doesn't has the domain, then use IP and port (you can specify yours by setting \`port\`, but don't forget to write it in the \`domain\` too).`);
			}
			if(!options.webhooksSettings.host) {
				throw new Error("You didn't provide your domain in the webhooks settings.");
			}

			// WST: Fixing path
			options.webhooksSettings.path = options.webhooksSettings.path ? options.webhooksSettings.path : "/";
			if(!options.webhooksSettings.path.startsWith("/")) {
				options.webhooksSettings.path = `/${options.webhooksSettings.path}`;
			}
			if(!options.webhooksSettings.path.endsWith("/")) {
				options.webhooksSettings.path = `${options.webhooksSettings.path}/`;
			}

			// WST: Fixing alive time
			options.webhooksSettings.aliveTime = options.webhooksSettings.aliveTime ? Math.min(Math.max(options.webhooksSettings.aliveTime, 120), HOOK_LIVETIME) : HOOK_LIVETIME;

			// WST: Fixing secure
			if(typeof options.webhooksSettings.secure !== "boolean") {
				options.webhooksSettings.secure = true;
			}

			// WST: Database
			const dbSettings = options.webhooksSettings.database;
			if(dbSettings && dbSettings.use) {
				if(!dbSettings.tableName) { dbSettings.tableName = DEFAULT_TABLENAME; }
				this._db = getDB();
			}

			// WST: Creating the server
			this._createWebhooksServer();
		}

		options.baseAPIEndpoint = options.baseAPIEndpoint ? options.baseAPIEndpoint : BASE_API_URI;

		this.options = options;
		this.subscriptions = [];
	}

	// ========================================
	//            Subscriptions
	// ========================================

	private readonly subscriptions: IStreamingServiceStreamer[];

	public addSubscription(streamer: IStreamingServiceStreamer) {
		if(this.isSubscribed(streamer.uid)) {
			throw new Error(`Already subscribed to ${streamer.uid}`);
		}

		this.subscriptions.push(streamer);

		if(this.interval && ((this.lastFetchedAt + this.options.updatingInterval) - Date.now()) > 10000) { // i'm bad at math
			setTimeout(() => this.fetch([streamer]), 1);
		}

		if(this._allowWebhooks) {
			this.registerWebhook(streamer.uid);
		}
	}

	public removeSubscription(uid: string) {
		const index = this.findSubscriptionIndex(uid);

		if(index === -1) {
			throw new Error(`Not subscribed to ${uid}`);
		}

		this.subscriptions.splice(index, 1);

		const hookID = this._hooksIDs[uid];
		if(this._allowWebhooks && hookID) {
			this.unregisterWebhook(hookID);
		}
	}

	private getSubscription(uid: string) {
		return this.subscriptions.find(s => s.uid === uid);
	}

	private findSubscriptionIndex(uid: string) {
		return this.subscriptions.findIndex(s => s.uid === uid);
	}

	public isSubscribed(uid: string) {
		return this.findSubscriptionIndex(uid) !== -1;
	}

	// ========================================
	//            Fetching interval
	// ========================================

	private interval?: NodeJS.Timer;

	public async start() {
		this.interval = setInterval(() => this.fetch(this.subscriptions), this.options.updatingInterval);
		await this._webhooksLoadHandler();
		await this.fetch(this.subscriptions);
	}

	public async stop() {
		if(this.interval) {
			clearInterval(this.interval);
		}
	}

	// ========================================
	//                Fetching
	// ========================================

	private readonly streamsStore: INullableHashMap<ICacheItem<ITwitchStream | null>> = Object.create(null);
	private readonly gamesStore: INullableHashMap<ICacheItem<ITwitchGame>> = Object.create(null);
	private readonly metadataStore: INullableHashMap<ICacheItem<ITwitchMetadata>> = Object.create(null);
	private readonly usersStore: INullableHashMap<ICacheItem<ITwitchUser>> = Object.create(null);
	private readonly currentPayloadsStore: INullableHashMap<ICacheItem<ITwitchNewPluginPayload>> = Object.create(null);
	private lastFetchedAt: number = Date.now();

	public async createPayloads(uids: string[]): Promise<INullableHashMap<ITwitchNewPluginPayload>> {
		// to fetch:
		const fetchStreams: string[] = [];
		const fetchGames: string[] = [];
		const fetchMetadata: string[] = [];
		const fetchUsers: string[] = [];

		const ready: INullableHashMap<ITwitchNewPluginPayload> = Object.create(null);

		for(const uid of uids) {
			const streamCache = this.streamsStore[uid];
			if(!streamCache || (Date.now() - streamCache.fetchedAt) > this.options.streamDeathTime) {
				fetchStreams.push(uid);
			}
		}

		for(const _chunk of chunk(fetchStreams, 20)) { // small chunking in 20 users
			const fetchedStreams = await this.makeRequest<ITwitchPagenatedResponse<ITwitchStream>>(this.getAPIURL_Streams(_chunk, "all"));
			const fetchEndedAt = Date.now();

			// let's start the assignation process

			const streams: INullableHashMap<ITwitchStream> = Object.create(null);
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
				const metadata = this.metadataStore[uid];
				if(!metadata || (Date.now() - metadata.fetchedAt) > (this.options.updatingInterval - OFF_METADATA)) {
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
			const fetchedUsers = await this.makeRequest<ITwitchPagenatedResponse<ITwitchUser>>(this.getAPIURL_User(uids, true));
			const fetchedAt = Date.now();
			for(const user of fetchedUsers.data) {
				this.usersStore[user.id] = {
					fetchedAt, value: user
				};
			}
		}

		for(const uid of uids) {
			if(ready[uid] === null && ready[uid]) { continue; } // ignoring duplicates and nulls

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
			const emoji = game ? this.options.emoji[game.id] || this.options.emoji[EMOJINAME_UNKNOWN_GAME] : null;

			ready[uid] = {
				game: game ? (emoji ? { ...game, emoji } : game) : undefined,
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
				if(!activePayload) {
					this.emit("online", {
						id: createdPayload.id,
						streamer,
						status: "online",
						payload: createdPayload,
						noEveryone: createdPayload.type === "vodcast"
					});
				} else if(activePayload) {
					// check if stream is updated

					const isUpdated = (() => {
						if(createdPayload.title !== activePayload.title) {
							return true;
						}

						if(createdPayload.id !== activePayload.id) {
							return true;
						}

						if(createdPayload.type !== activePayload.type) {
							return true;
						}

						if(createdPayload.game && activePayload.game) {
							if(createdPayload.game.id !== activePayload.game.id) {
								return true;
							}
						}

						for(const prop in createdPayload.streamer) {
							if(EXLUDED_USER_PROPS_OFUPD.includes(prop)) { continue; }
							if(createdPayload.streamer[prop] !== activePayload.streamer[prop]) {
								return true;
							}
						}

						if(createdPayload.metadata && !activePayload.metadata) {
							return true;
						} if(!createdPayload.metadata && activePayload.metadata) {
							return true;
						} else if((createdPayload.metadata && activePayload.metadata) && !this._isMetadataEqual(createdPayload.metadata, activePayload.metadata)) {
							return true;
						}

						return false;
					})();

					if(isUpdated) {
						this.emit("updated", {
							updated: true,
							id: createdPayload.id,
							oldId: activePayload.id,
							payload: createdPayload,
							status: "online",
							streamer,
							noEveryone: createdPayload.type === "vodcast"
						});
					}
				}

				// updating active payload
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

		this.lastFetchedAt = createdAt;
	}

	// #region Metadata comprasion

	private _isMetadataEqual(a?: ITwitchMetadata, b?: ITwitchMetadata) {
		if((!a && !b) || (!a && b) || (a && !b)) { return true; }
		if(!a || !b) { return false; } // fucking ts
		if(a === b) { return true; } // woah?

		if(a.game_id !== b.game_id) { return false; }
		if(a.user_id !== b.user_id) { return false; }

		if(this._oneOfThemNull(a.hearthstone, b.hearthstone)) {
			return false;
		} else if(a.hearthstone && b.hearthstone) {
			// comprasion
			if(this._oneOfThemNull(a.hearthstone.broadcaster, b.hearthstone.broadcaster)) {
				return false;
			} else if(a.hearthstone.broadcaster && b.hearthstone.broadcaster) {
				if(!this._areTheseObjectsEqual(a.hearthstone.broadcaster, b.hearthstone.broadcaster)) {
					return false;
				}
			}

			if(this._oneOfThemNull(a.hearthstone.opponent, b.hearthstone.opponent)) {
				return false;
			} else {
				if(!this._areTheseObjectsEqual(a.hearthstone.opponent, b.hearthstone.opponent)) {
					return false;
				}
			}
		}

		if(this._oneOfThemNull(a.overwatch, b.overwatch)) {
			return false;
		} else if(a.overwatch && b.overwatch) {
			if(this._oneOfThemNull(a.overwatch.broadcaster, b.overwatch.broadcaster)) {
				return false;
			} else if(a.overwatch.broadcaster && b.overwatch.broadcaster) {
				if(!this._areTheseObjectsEqual(a.overwatch.broadcaster.hero, b.overwatch.broadcaster.hero)) {
					return false;
				}
			}
		}

		return true;
	}

	private _oneOfThemNull(a?: any, b?: any): boolean {
		return (!a && b) || (a && !b);
	}

	private _areTheseObjectsEqual(a: object, b: object) {
		if(!a || !b) {
			return (!a && !b) ? true : false; // if they both are undefined = they're the same
		}

		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);

		if(aKeys.length !== bKeys.length) { return false; }

		if(aKeys.find(key => !bKeys.includes(key))) { return false; }

		for(const key of aKeys) {
			if(a[key] !== b[key]) { return false; }
		}

		return true;
	}

	// #endregion

	// ========================================
	//                 Discord
	// ========================================

	// #region Discord

	public async getEmbed(streamStatus: IStreamStatus, lang: string): Promise<IEmbed> {
		const payload = <ITwitchNewPluginPayload>streamStatus.payload;
		if(!payload) { throw new StreamingServiceError("TWITCH_CACHEFAULT", "Failure"); }

		const game = payload.game;
		const gameName = game ? game.name : $localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN");
		const gameEmoji = game ? game.emoji : undefined;
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
				mature: isMature
			})
		}];

		const gameMetadata = payload.game ? payload.metadata : undefined;
		if(gameMetadata) { // not showing metadata if don't have game
			switch(gameMetadata.game_id) {
				case "488552": {
					const owMetadata = gameMetadata.overwatch;
					if(!owMetadata || !owMetadata.broadcaster || !owMetadata.broadcaster.hero) { break; }

					fields.push({
						inline: false,
						name: `${(gameEmoji ? `${gameEmoji} ` : "")}${gameName}`,
						value: $localizer.getFormattedString(lang, "STREAMING_GAME_VALUE_OVERWATCH", {
							name: this._getOverwatchHeroName(owMetadata.broadcaster.hero.name, lang),
							role: this._getOverwatchRoleName(owMetadata.broadcaster.hero.role, lang)
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
						str += `${$localizer.getFormattedString(lang, "STREAMING_GAME_VALUE_HEARTHSTONE", {
							target: "broadcaster",
							...hsMetadata.broadcaster.hero
						})}\n`;
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
				text: $localizer.getString(lang, "STREAMING_SERVICE@TWITCH_NEW")
			},
			description: streamStatus.status === "online" ? $localizer.getFormattedString(lang, "STREAMING_DESCRIPTION@TWITCH_NEW", {
				username: escapeDiscordMarkdown(payload.streamer.displayName, true),
				type: payload.type,
				emoji: this.options.emoji[payload.type === "vodcast" ? EMOJINAME_VODCAST : EMOJINAME_STREAMING]!
			}) : $localizer.getFormattedString(lang, "STREAMING_DESCRIPTION_OFFLINE", {
				username: escapeDiscordMarkdown(payload.streamer.displayName, true)
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
				url: streamStatus.status === "online" ? `${payload.previewUri.replace("{width}", "1280").replace("{height}", "720")}?ts=${Date.now()}` : (
					payload.streamer.offlineBanner || TWITCH_OFFLINE_BANNER
				)
			},
			fields
		};
	}

	private _getOverwatchHeroName(name: string, lang: string) {
		switch(name) {
			case "Soldier: 76": { name = "SOLDIER76"; } break;
			case "D. VA": { name = "DVA"; } break;
			default: { name = name.toUpperCase(); }
		}
		return $localizer.getString(lang, `OVERWATCH_HERO_${name}`);
	}

	private _getOverwatchRoleName(role: string, lang: string) {
		return $localizer.getString(lang, `OVERWATCH_ROLE_${role.toUpperCase()}`);
	}

	// #endregion

	// ========================================
	//                   API
	// ========================================

	public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
		username = username.toLowerCase();

		if(!TWITCH_USERNAME_REGEXP.test(username)) {
			throw new StreamingServiceError("TWITCH_INVALIDUSERNAME", "Invalid username.");
		}

		const foundUsers = await this.makeRequest<ITwitchPagenatedResponse<ITwitchUser>>(this.getAPIURL_User([username.toLowerCase()]));

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

	// #region API

	// #region URL Builders

	private getAPIURL_Streams(ids: string[], type?: PossibleTwitchStreamTypes | "all") {
		let apiUri = `${this.options.baseAPIEndpoint}/streams`;
		let i = 0;
		for(; i < ids.length; i++) {
			apiUri += `${(i === 0) ? "?" : "&"}user_id=${ids[i]}`;
		}
		if(type) {
			apiUri += `${(i === 0) ? "?" : "&"}type=${type}`;
		}
		return apiUri;
	}

	private getAPIURL_User(username: string[], ids = false) {
		let apiUri = `${this.options.baseAPIEndpoint}/users`;
		for(let i = 0; i < username.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}${ids ? "id" : "login"}=${username[i]}`;
		}
		return apiUri;
	}

	private getAPIURL_Metadata(ids: string[]) {
		let apiUri = `${this.options.baseAPIEndpoint}/streams/metadata`;
		for(let i = 0; i < ids.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}user_id=${ids[i]}`;
		}
		return apiUri;
	}

	private getAPIURL_Games(ids: string[]) {
		let apiUri = `${this.options.baseAPIEndpoint}/games`;
		for(let i = 0; i < ids.length; i++) {
			apiUri += `${(i === 0 ? "?" : "&")}id=${ids[i]}`;
		}
		return apiUri;
	}

	// #endregion

	private async makeRequest<T>(uri: string, method = "GET", isJson = true): Promise<T> {
		const loop = async (attempt: number = 0) => {
			if(attempt > 3) {
				throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
			}
			const headers = { "Client-ID": this.options.clientId };
			if(this.options.token) { headers["Authorization"] = `Bearer ${this.options.token}`; }
			const resp = await fetch(uri, { headers, method: method.toUpperCase() });
			if(resp.status === 429) {
				const resetAt = parseInt(resp.headers.get("ratelimit-reset"), 10);
				const sleepTime = ((resetAt * 1000) - Date.now()) + 5; // time problems
				this.log("info", `Request to "${uri}" was ratelimited. Sleeping for ${sleepTime}...`);
				await sleep(sleepTime);
				return loop(attempt + 1);
			} else if(resp.status !== 200 && resp.status !== 202) {
				throw new StreamingServiceError("TWITCH_REQ_ERROR", "Error has been received from Twitch", {
					status: resp.status,
					body: (await resp.text())
				});
			}
			return isJson ? resp.json() : resp.text();
		};
		return <T>(await loop());
	}

	// #endregion

	// ========================================
	//             Webhooks Stuff
	// ========================================

	// #region Webhooks Stuff

	private readonly _registeredHooks: INullableHashMap<IRegisteredWebhook> = Object.create(null);
	private readonly _hooksIDs: INullableHashMap<string> = Object.create(null);
	private _allowWebhooks = false;

	private initWebhooksServer() {
		return new Promise((res, rej) => {
			let settings: IWebhookSettings | undefined;
			if(!this.options.useWebhooks) {
				this.log("info", "[init] Initialization of the application is not required. Using longpolling only.");
				return;
			} else if(!(settings = this.options.webhooksSettings)) {
				this.log("err", "[init] `useWebhooks` set to `true`, but no settings provided. Wondering why it's happened... Did you changed the code?");
				return;
			}
			this.log("info", "[init] Please wait while we're initializing the application...");
			let whsrv = this.webhooksServer;
			if(!whsrv) {
				this.log("info", "[init] No application found, didn't constructor worked properly? Anyway...");
				whsrv = this._createWebhooksServer();
			}
			whsrv.listen({
				host: settings.host,
				port: settings.port || DEFAULT_PORT
			}, (err) => {
				if(err) {
					const eText = "Error initialization webhook server. Webhooks will not be accepted";
					this.log("err", eText, err);
					return rej(new Error(eText));
				}
				this._allowWebhooks = true;
				res();
			});
		});
	}

	private _createWebhooksServer() {
		return this.webhooksServer = http.createServer((req, resp) => this._serverHandler(req, resp));
	}

	private async _serverHandler(req: http.IncomingMessage, resp: http.ServerResponse) {
		if(!req.url || !req.method) { return; }

		const parsed = parseUrl(getURL(req), true);
		const whSettings = this.options.webhooksSettings!;
		const isLocalURL = [`${whSettings.host}`, `${whSettings.host}:${whSettings.port}`].includes(parsed.hostname || "");

		if(whSettings.domain && (parsed.hostname !== whSettings.domain && !isLocalURL)) {
			this.log("warn", `[Webhooks] Attempt to access host "${parsed.hostname}" (${req.url}) directly from ${req.connection.remoteAddress}`);
			return this._endResponse(resp, "Unpredicted magic happened. Probably server misconfiguration or you're calling server directly?", 400);
		} else if(!whSettings.domain && isLocalURL) {
			this.log("warn", `[Webhooks] Attempt to access from localhost ${req.connection.remoteAddress}`);
			return this._endResponse(resp, "But why?", 400);
		}

		if(!parsed.pathname) {
			return this._endResponse(resp, "Unknown location", 400);
		} else if(!parsed.pathname.startsWith(whSettings.path)) {
			return this._endResponse(resp, "Invalid path", 400);
		}

		parsed.pathname = parsed.pathname.slice(whSettings.path.length);

		switch(req.method.toLowerCase()) {
			case "post": return this._processTwitchUpdate(req, resp, parsed);
			case "get": return this._processTwitchConfirmation(req, resp, parsed);
			default: {
				resp.statusCode = 400;
				return resp.end("Invalid method specified");
			}
		}
	}

	private async _processTwitchUpdate(req: http.IncomingMessage, resp: http.ServerResponse, parsedURL: Url) {
		const id = (parsedURL.pathname || "");
		const hook = this._registeredHooks[id];
		const signature = req.headers["x-hub-signature"];

		if(!hook) {
			this.log("warn", `[Webhooks] Request about unknown hook "${id}", rejected "${req.url}" from "${req.connection.remoteAddress}"`);
			return this._endResponse(resp, "Unknown hook", 400);
		}

		if(!signature || typeof signature !== "string") {
			this.log("warn", `[Webhooks] Request with no signature, rejected "${req.url}" from "${req.connection.remoteAddress}"`);
			return this._endResponse(resp, "Signature is not provided or invalid");
		}

		const content = await (() => {
			// bad resolving
			return new Promise<string>(res => {
				let data = "";
				req.on("data", (b) => {
					data += b.toString();
				}).on("end", () => {
					res(data);
				});
			});
		})();

		const destructedSig = signature.split("=");
		// validation
		const hash = createHmac(destructedSig[0], hook.key).update(content).digest("hex");
		if(hash !== destructedSig[1]) {
			this.log("warn", `[Webhooks] Invalid hash provided, verification failed. "${req.url}" from "${req.connection.remoteAddress}"`);
			return this._endResponse(resp, "Verification failed");
		}

		let json: { data: ITwitchStream[] };
		try {
			json = JSON.parse(content);
		} catch(err) {
			return this._endResponse(resp, "Failed to parse JSON", 400);
		}

		const streamer = this.getSubscription(hook.uid);
		if(!streamer) {
			this.log("warn", `[Webhook] Not found subscription for "${id}" (${hook.uid})`);
			return;
		}

		if(json.data && json.data.length > 0) {
			for(const stream of json.data) {
				this.streamsStore[stream.user_id] = {
					fetchedAt: Date.now(),
					value: stream
				};
			}
		}

		this._endResponse(resp, "Thanks cutie!", 200);
		await this.fetch([streamer]);
	}

	private async _processTwitchConfirmation(req: http.IncomingMessage, resp: http.ServerResponse, parsedURL: Url) {
		const id = (parsedURL.pathname || "");
		const hook = this._registeredHooks[id];
		if(!hook) {
			this.log("info", `[Webhooks] Request about unknown hook "${id}", rejected "${req.url}"`);
			return this._endResponse(resp, "Unknown hook", 400);
		}
		if(!parsedURL.query) {
			this.log("info", `[Webhooks] Unknown request with no query passed, rejected "${req.url}"`);
			return this._endResponse(resp, "No query passed", 400);
		}
		switch(parsedURL.query["hub.mode"]) {
			case "subscribe": {
				this.log("ok", `[Webhooks] Created webhook for "${parsedURL.query["hub.topic"]}"`);
				hook.registeredAt = Date.now();
				hook.leaseSeconds = parseInt(parsedURL.query["hub.lease_seconds"], 10);
				this._scheduleWebhookRenew(hook, hook.leaseSeconds * 1000);
				return this._endResponse(resp, parsedURL.query["hub.challenge"], 202);
			}
			case "denied": {
				this.log("info", `[Webhooks] Failed to create webhook for "${parsedURL.query["hub.topic"]}"`);
				delete this._registeredHooks[id];
				return this._endResponse(resp);
			}
			case "unsubscribe": {
				this.log("info", `[Webhooks] Unsubscribed from "${parsedURL.query["hub.topic"]}"`);
				delete this._registeredHooks[id];
				return this._endResponse(resp);
			}
			default: {
				this.log("warn", `[Webhooks] Unknown hub mode - ${parsedURL.query["hub.mode"]}`);
				return this._endResponse(resp); // 👀
			}
		}
	}

	private async _endResponse(resp: http.ServerResponse, withContent?: string, statusCode: number = 200, headers?: IHashMap<string | number>) {
		resp.writeHead(statusCode, undefined, headers ? { ...TXT_HEADER, ...headers } : TXT_HEADER);
		return resp.end(withContent);
	}

	private async registerWebhook(uid: string) {
		if(!this.options.webhooksSettings) { throw new Error("No webhook settings found."); }
		const randID = Date.now().toString(16).split("").reverse().join("") + randomString(10, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
		const key = randomString(20, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя!;()$%^&");

		this.log("info", `[Webhooks] Started webhook registration for ${uid}\n\tID: ${randID}\n\tKey: ${key}`);
		this._registeredHooks[randID] = {
			registeredAt: -1,
			leaseSeconds: -1,
			uid, key,
		};
		this._hooksIDs[uid] = randID;

		const wst = this.options.webhooksSettings;
		const url = new URL(`${this.options.baseAPIEndpoint}/webhooks/hub`);
		url.searchParams.append("hub.callback", `${wst.secure ? "https" : "http"}://${wst.domain}${wst.path}/${randID}`);
		url.searchParams.append("hub.mode", "subscribe");
		url.searchParams.append("hub.topic", this.getAPIURL_Streams([uid]));
		url.searchParams.append("hub.lease_seconds", `${this.options.webhooksSettings.aliveTime}`);
		url.searchParams.append("hub.secret", key);

		try {
			const reqUri = url.toString();
			this.log("info", `[Webhooks] Sending request to ${reqUri}`);
			await this.makeRequest(reqUri, "post", false);
		} catch(err) {
			this.log("warn", `[Webhooks] Registration failed for ${uid}`, err);
			delete this._registeredHooks[randID];
			delete this._hooksIDs[uid];
			return;
		}

		this.log("info", "[Webhooks] Registration seems to progress, if everything is OK, Twitch will ask for confirmation");
	}

	private async unregisterWebhook(hookId: string, uid?: string, secret?: string) {
		if(!this.options.webhooksSettings) { throw new Error("No webhook settings found."); }

		const hook = this._registeredHooks[hookId];
		if(!hook && !uid) {
			throw new Error("Hook not found, UID not provided");
		}

		const resolvedUID = hook ? hook.uid : uid;
		if(!resolvedUID) {
			throw new Error("Could not determinate UID");
		}

		const scheduledRenew = this._scheduledRenews[resolvedUID];
		if(scheduledRenew) {
			this.log("info", "[Webhooks] Scheduled renew found, clearing...");
			clearTimeout(scheduledRenew);
		}

		const wst = this.options.webhooksSettings;
		const url = new URL(`${this.options.baseAPIEndpoint}/webhooks/hub`);
		url.searchParams.append("hub.callback", `${wst.secure ? "https" : "http"}://${wst.domain}${wst.path}/${hookId}`);
		url.searchParams.append("hub.mode", "unsubscribe");
		url.searchParams.append("hub.topic", this.getAPIURL_Streams([hook ? hook.uid : uid!]));

		if(hook) {
			url.searchParams.append("hub.secret", hook.key);
		} else if(secret) {
			url.searchParams.append("hub.secret", secret);
		}

		try {
			const reqUri = url.toString();
			this.log("info", `[Webhooks] Sending request to: ${reqUri}`);
			await this.makeRequest(reqUri, "POST", false);
		} catch(err) {
			this.log("err", `[Webhooks] Failed to unsubscribe from "${uid || hook!.uid}" on Twitch`);
		}

		delete this._registeredHooks[hookId];
		delete this._hooksIDs[resolvedUID];
	}

	private async _webhooksLoadHandler() {
		if(!this.options.useWebhooks) { return; }
		const whs = this.options.webhooksSettings;
		const registeredHooksFor: string[] = [];
		await (async () => {
			if(this._db && whs) {
				const dbSettings = whs.database;
				if(!dbSettings || !dbSettings.use) { return delete this._db; }

				const tableStatus = await this._db.schema.hasTable(dbSettings.tableName);
				if(!tableStatus) {
					await this._db.schema.createTable(dbSettings.tableName, (c) => {
						// UID, WEBHOOK_ID, KEY, CREATED_AT, LEASE_TIME, SAVED_AT
						c.string("uid").notNullable();
						c.string("id").notNullable();
						c.string("key").notNullable();
						c.bigInteger("registeredAt").notNullable();
						c.bigInteger("leaseTime").notNullable();
						c.bigInteger("savedAt").notNullable();
					});
				}

				const hooks = <IDBWebhook[]>await this._db(dbSettings.tableName).select("*");
				this.log("info", `Found ${(hooks || []).length} in database table!`);

				const invalidateHook = async (hook: IDBWebhook) => {
					await this._db(dbSettings.tableName).where(hook).delete();
					await this.unregisterWebhook(hook.id, hook.uid);
				};

				for(const hook of hooks) {
					if((Date.now() - hook.savedAt) > TWITCH_DEATH) {
						this.log("info", `Hook ${hook.id} (${hook.uid}) is already dead for Twitch and will not be recreated`);
						await invalidateHook(hook);
						continue;
					}

					if((hook.registeredAt + (hook.leaseTime * 1000)) < Date.now()) {
						this.log("info", `Hook ${hook.id} (${hook.uid}) is already expired and will not be recreated`);
						await invalidateHook(hook);
						continue;
					}

					this.log("ok", `Recreated hook ${hook.id} (${hook.uid})`);
					const registered = this._registeredHooks[hook.id] = {
						key: hook.key,
						registeredAt: hook.registeredAt,
						uid: hook.uid,
						leaseSeconds: hook.leaseTime
					};
					this._hooksIDs[hook.uid] = hook.id;
					this._scheduleWebhookRenew(registered, (hook.registeredAt + (hook.leaseTime * 1000)) - Date.now());
					registeredHooksFor.push(hook.uid);
				}
			}
		})();

		try {
			await this.initWebhooksServer();
			for(const subscription of this.subscriptions) {
				if(registeredHooksFor.includes(subscription.uid)) {
					this.log("ok", `We already have hook for ${subscription.uid}. Wow that's cool!`);
					continue;
				}
				try {
					await this.registerWebhook(subscription.uid);
					await sleep(1000);
				} catch(err) {
					this.log("err", `Failed to connect the webhook for ${subscription.uid} (${subscription.username})`, err);
				}
			}
		} catch(err) {
			this.log("err", "Failed to initialize the server", err);
		}
	}

	private async _webhooksUnloadHandler() {
		if(!this.options.useWebhooks) { return; }

		try {
			await (() => new Promise((res, rej) => {
				if(this.webhooksServer) {
					this.webhooksServer.close((err) => {
						if(err) { return rej(err); }
						return res();
					});
				} else { return res(); }
			}))();
		} catch(err) {
			this.log("err", "[unload] Could not stop the webhooks server", err);
		}

		const whs = this.options.webhooksSettings;
		if(whs && whs.database && whs.database.use && this._db) {
			this.log("info", "[unload] Using database, saving data...");

			for(const hookId in this._registeredHooks) {
				this.log("info", `[unload] [@${hookId}]`);
				const hook = this._registeredHooks[hookId];
				if(!hook) {
					this.log("warn", `[unload] [@${hookId}] Ignoring the hook!`);
					continue;
				}

				const hookEndsAt = hook.registeredAt + (hook.leaseSeconds * 1000);
				const isExpired = hookEndsAt < Date.now();

				if(isExpired) {
					this.log("warn", `[unload] This hook seems to be expired! (HE: ${hookEndsAt} => ${hook.registeredAt} + ${hook.leaseSeconds * 1000}`);
				}

				const current = <IDBWebhook>await this._db(whs.database.tableName).where({ uid: hook.uid }).first();
				const newDBHook = <IDBWebhook>{
					id: hookId,
					uid: hook.uid,
					key: hook.key,
					registeredAt: hook.registeredAt,
					leaseTime: hook.leaseSeconds,
					savedAt: Date.now()
				};

				if(current) {
					if(isExpired) {
						await this._db.where(current).delete();
						this.log("ok", `[unload] [@${hookId}] Entry removed as expired`);
						continue;
					}
					await this._db(whs.database.tableName).where(current).update(newDBHook);
					this.log("ok", `[unload] [@${hookId}] Updated old entry`);
				} else if(!isExpired) {
					await this._db(whs.database.tableName).insert(newDBHook);
					this.log("ok", `[unload] [@${hookId}] Saved new entry`);
				} else {
					this.log("warn", `[unload] [@${hookId}] ${isExpired ? "Entry expired" : "Unknown state!"}`);
				}
			}
		} else {
			this.log("info", "[unload] Woah, dude! You don't use database to save the webhooks. It could reduce start up time.");
			this.log("info", "[unload] Actually, we're unregistering these for you, so Twitch won't call us while we offline!");
			for(const hookId in this._registeredHooks) {
				this.log("info", `[unload] Unregistering ${hookId}`);
				await this.unregisterWebhook(hookId);
			}
		}
	}

	private readonly _scheduledRenews: IHashMap<NodeJS.Timer | undefined> = Object.create(null);

	private _scheduleWebhookRenew(hook: IRegisteredWebhook, leaseMs: number) {
		this._scheduledRenews[hook.uid] = setTimeout(() => this.registerWebhook(hook.uid), leaseMs);
		this.log("info", `[Webhooks] Scheduled renew for ${hook.uid} in ${leaseMs}ms`);
	}

	//#endregion

	// ========================================
	//              Module Stuff
	// ========================================

	public emit(type: StreamStatusChangedAction, update: IStreamStatus) {
		return super.emit(type, update);
	}

	async unload() {
		this.log("info", "[unload] Unloading...");

		await this._webhooksUnloadHandler();

		this.log("info", "[unload] Clearing cache...");
		for(const key in this.streamsStore) {
			delete this.streamsStore[key];
		}
		for(const uid in this.currentPayloadsStore) {
			delete this.currentPayloadsStore[uid];
		}
		return true;
	}
}

type PossibleTwitchStreamTypes = "live" | "vodcast" | "offline";
type PossibleTwitchUserTypes = "staff" | "admin" | "global_mod" | "";
type PossibleTwitchUserPartnershipStatus = "partner" | "affiliate" | "";

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
	type: PossibleTwitchUserTypes;
	broadcaster_type: PossibleTwitchUserPartnershipStatus;
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

interface IRegisteredWebhook {
	registeredAt: number;
	key: string;
	uid: string;
	leaseSeconds: number;
}

// UID, WEBHOOK_ID, KEY, CREATED_AT, LEASE_TIME, SAVED_AT
interface IDBWebhook {
	uid: string;
	id: string;
	key: string;
	registeredAt: number;
	leaseTime: number;
	savedAt: number;
}

interface ICacheItem<T> {
	fetchedAt: number;
	value: T;
}

module.exports = TwitchStreamingService;
