import { Whitelist } from "../whitelist/whitelist";
import { IModule, ModuleLoader, convertToModulesMap, IModuleInfo, ModuleBase, ModuleLoadState } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember, DiscordAPIError, User, DMChannel } from "discord.js";
import { escapeDiscordMarkdown, getLogger } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import { simpleCmdParse } from "../utils/text";
import { generateLocalizedEmbed, getGuildLanguage, getUserLanguage } from "../utils/ez-i18n";
import { EmbedType, sleep, IEmbedOptionsField, IEmbed } from "../utils/utils";
import { IStreamingService, IStreamingServiceStreamer, StreamingServiceError, IStreamStatus, StreamStatusChangedHandler, StreamStatusChangedAction } from "./baseService";
import { createConfirmationMessage } from "../utils/interactive";
import { command } from "../utils/help";
import { IHashMap } from "../../types/Interfaces";
import { messageToExtra } from "../utils/failToDetail";
import { isPremium } from "../utils/premium";

const PREFIX = "!streams";
const MAX_NOTIFIED_LIFE = 86400000; // ms

const TABLE = {
	subscriptions: "sn_subscriptions",
	settings: "sn_settings",
	notifications: "sn_notifications"
};

interface INotificationsModuleSettings {
	/**
	 * Streaming services
	 */
	services: IModuleInfo[];
	/**
	 * Limits for non-premium and not-partnered users
	 */
	limits: {
		guilds: number;
		users: number;
	};
}

interface ISubscriptionRawRow {
	provider: string;
	uid: string;
	username: string;
	subscribers: string;
}

interface ISettingsRow {
	guild: string;
	channelId: string | "-" | null;
	/**
	 * JSON with Array<IStreamingServiceStreamer>
	 */
	mentionsEveryone: string;
	subscribedTo: string;
}

interface ISettingsParsedRow {
	channelId: string | null;
	guild: string;
	mentionsEveryone: IStreamingServiceStreamer[];
	subscribedTo: IStreamingServiceStreamer[];
}

type SubscriptionFilter = {
	provider: string;
	uid?: string;
	username?: string;
};

interface ISubscriptionRow {
	/**
	 * Provider if talking about module that fetches it, otherwise streaming service name
	 */
	provider: string;
	/**
	 * UID of the streamer
	 */
	uid: string;
	/**
	 * Username of the streamer
	 */
	username: string;
	/**
	 * Array of Guild IDs that subscribed to this channel
	 */
	subscribers: string[];
}

interface INotification {
	guild: string;
	provider: string;
	channelId: string;
	streamId: string;
	streamerId: string;
	messageId: string;
	sentAt: number;
}

const LOCALIZED = (str: string) => `STREAMING_${str.toUpperCase()}`;
const HELP_CATEGORY = "HELPFUL";
const DEFAULT_LIMITS = {
	users: 20,
	guilds: 20
};

function rightsCheck(member: GuildMember) {
	return member.permissions.has(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.permissions.has(["ADMINISTRATOR"]) || member.id === $botConfig.botOwner;
}

function helpCheck(msg: Message) {
	return msg.channel.type === "text" && rightsCheck(msg.member);
}

@command(HELP_CATEGORY, `${PREFIX.slice(1)}`, `loc:${LOCALIZED("META_LIST")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_LIST_ARG0_DESC",
		optional: true
	},
	"loc:STREAMING_META_LIST_ARG1": {
		description: "loc:STREAMING_META_LIST_ARG1_DESC",
		optional: false
	}
}, (msg) => msg.channel.type === "dm" ? true : rightsCheck(msg.member))
@command(HELP_CATEGORY, `${PREFIX.slice(1)} add`, `loc:${LOCALIZED("META_ADD")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} subscribe`, `loc:${LOCALIZED("META_SUBSCRIBE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	}
})
@command(HELP_CATEGORY, `${PREFIX.slice(1)} remove`, `loc:${LOCALIZED("META_REMOVE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_REMOVE_ARG1": {
		description: "loc:STREAMING_META_REMOVE_ARG1_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} unsubscribe`, `loc:${LOCALIZED("META_UNSUBSCRIBE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_REMOVE_ARG1": {
		description: "loc:STREAMING_META_REMOVE_ARG1_DESC",
		optional: false
	}
})
@command(HELP_CATEGORY, `${PREFIX.slice(1)} edit`, `loc:${LOCALIZED("META_EDIT")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	},
	"loc:STREAMING_META_EDIT_ARG2": {
		description: "loc:STREAMING_META_EDIT_ARG2_DESC",
		optional: false
	},
	"loc:STREAMING_META_EDIT_ARG3": {
		description: "loc:STREAMING_META_EDIT_ARG3_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} set_channel`, `loc:${LOCALIZED("META_SETCHANNEL")}`, {
	"loc:STREAMING_META_SETCHANNEL_ARG0": {
		description: "loc:STREAMING_META_SETCHANNEL_ARG0_DESC",
		optional: false
	}
}, helpCheck)
class StreamNotifications extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.stream_notifications";
	}

	private log = getLogger("StreamNotifications");
	private db = getDB();
	private servicesLoader: ModuleLoader;
	private servicesList: IHashMap<IModuleInfo>;
	private whitelistModule: ModuleBase<Whitelist>;
	private options: INotificationsModuleSettings;

	constructor(options: INotificationsModuleSettings) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);

		this.servicesList = convertToModulesMap(options.services);

		this.servicesLoader = new ModuleLoader({
			name: "StreamNotifications:Services",
			basePath: "./cogs/streamNotifications/services/",
			registry: this.servicesList,
			defaultSet: []
		});

		if(!options.limits) {
			options.limits = DEFAULT_LIMITS;
		} else {
			for(const key of Object.keys(DEFAULT_LIMITS)) {
				if(typeof options.limits[key] !== "number") {
					options.limits[key] = DEFAULT_LIMITS[key];
				}
			}
		}

		this.options = options;
	}

	// =======================================
	//  Message handling
	// =======================================

	async onMessage(msg: Message) {
		if(!msg.content.startsWith(PREFIX)) { return; }
		const cmd = simpleCmdParse(msg.content);
		try {
			switch(cmd.subCommand) {
				case "edit": await this.subcmd_edit(msg, cmd.args); break;
				case "add": await this.subcmd_add(msg, cmd.args, "guild"); break;
				case "remove": await this.subcmd_remove(msg, cmd.args, "guild"); break;
				case "set_channel": await this.subcmd_setChannel(msg, cmd.args); break;
				case "subscribe": await this.subcmd_add(msg, cmd.args, "user"); break;
				case "unsubscribe": await this.subcmd_remove(msg, cmd.args, "user"); break;
				default: await this.subcmd_list(msg, cmd.subCommand, cmd.args); break;
			}
		} catch(err) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.author, LOCALIZED("CMD_ERROR"))
			});
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			this.log("err", `Error starting command "${msg.content}"`, err);
		}
	}


	// =======================================
	// Command handling
	// =======================================

	async subcmd_setChannel(msg: Message, args: string[] | undefined) {
		// !streams set_channel <#228174260307230721>
		// args at this point: ["<#228174260307230721>"]

		if(msg.channel.type !== "text") { return; }

		if(!rightsCheck(msg.member)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 1) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("SETCHANNEL_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		let settings = await this.createOrGetSettings(msg.guild);

		if(args[0] !== "NONE") {
			let matches = args[0].match(/[0-9]+/);
			let channelId = matches ? matches[0] : undefined;
			if(!channelId) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGIDFORMAT"))
				});
				return;
			}

			// trying to find this channel?

			let channel = msg.guild.channels.get(channelId);
			if(!channel) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_CHANNELNOTFOUND"))
				});
				return;
			}

			if(channel.type !== "text") {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGCHANNELTYPE"))
				});
				return;
			}

			settings.channelId = channel.id;
		} else {
			settings.channelId = null;
		}

		await this.updateSettings(settings);

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("SETCHANNEL_DONE"))
		});
	}

	async subcmd_edit(msg: Message, args: string[] | undefined) {
		// !streams edit YouTube, ID, mention_everyone, true
		// args at this point: ["YouTube", "ID", "mention_everyone", "true"]

		if(msg.channel.type !== "text") { return; }

		if(!rightsCheck(msg.member)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 4) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("EDIT_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		// checking arguments
		switch(args[2]) {
			case "mention_everyone": {
				if(!["true", "false"].includes(args[3])) {
					await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_INVALIDARG0"))
					});
					return;
				}
			} break;
			default: {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_INVALIDARG"))
				});
			} return;
		}

		// find this subscription to ensure that is exists

		let subscription = await this.getSubscription({
			provider: args[0].toLowerCase(),
			uid: args[1]
		});

		if(!subscription) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_SUBNOTFOUND"))
			});
			return;
		}

		// then getting settings

		let rawSettings = await this.createOrGetSettings(msg.guild);

		// parse settings

		let settings = this.convertToNormalSettings(rawSettings);

		// caching for our dear interval

		this.guildSettingsCache[settings.guild] = settings;

		if(args[2] === "mention_everyone") {
			if(args[3] === "true") {
				// find current one?

				let current = settings.mentionsEveryone.find((s) => {
					return !!subscription && s.serviceName === subscription.provider && s.uid === subscription.uid && s.username === subscription.username;
				});

				if(current) {
					await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_ME_ALREADYMENTIONS"))
					});
					return;
				}

				settings.mentionsEveryone.push({
					serviceName: subscription.provider,
					uid: subscription.uid,
					username: subscription.username
				});
			} else {
				let index = settings.mentionsEveryone.findIndex((s) => {
					return !!subscription && s.serviceName === subscription.provider && s.uid === subscription.uid && s.username === subscription.username;
				});

				if(index === -1) {
					await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_ME_ALREADYNOTMENTIONS"))
					});
					return;
				}

				settings.mentionsEveryone.splice(index, 1);
			}
		}

		rawSettings = this.convertToRawSettings(settings);

		await this.updateSettings(rawSettings);

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("EDIT_DONE"))
		});
	}

	/**
	 * [Subcommand Handler] Adds channel subscription
	 * @param msg Message
	 * @param args Arguments array
	 * @param scope Scope of calling. "user" if called to subscribe for user, or "user" if for guiild
	 */
	async subcmd_add(msg: Message, args: string[] | undefined, scope: "user" | "guild") {
		// !streams add YouTube, BlackSilverUfa
		// args at this point: ["YouTube", "BlackSilverUfa"]

		if(scope === "guild" && msg.channel.type !== "text") {
			return;
		}

		if(scope === "guild" && !rightsCheck(msg.member)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		const i18nSubject = msg.channel.type === "dm" ? msg.author : msg.member;

		if(!args || args.length !== 2) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, i18nSubject, {
					key: LOCALIZED(scope === "guild" ? "ADD_USAGE" : "ADD_USAGE_DM"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		const subject = scope === "guild" ? msg.guild : msg.author;

		const rawSettings = await this.createOrGetSettings(subject);
		const settings = rawSettings ? await this.convertToNormalSettings(rawSettings) : undefined;

		if(!settings) {
			throw new Error("Unexpected behavior. No `settings` passed");
		}

		if(scope === "user" && (this.options.limits.users && settings.subscribedTo.length >= this.options.limits.users) && !isPremium(msg.author)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, {
					key: LOCALIZED("ADD_FAULT_NOPREMIUM"),
					formatOptions: {
						limit: this.options.limits.users
					}
				})
			});
			return;
		} else if((this.whitelistModule && this.whitelistModule.base) && scope === "guild" && (this.options.limits.guilds &&  settings.subscribedTo.length >= this.options.limits.users)) {
			const whitelistStatus = await this.whitelistModule.base.isWhitelisted(msg.guild);
			if(whitelistStatus.state !== 0 && whitelistStatus.state === 1) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: LOCALIZED("ADD_FAULT_NOPARTNER"),
						formatOptions: {
							limit: this.options.limits.guilds
						}
					})
				});
				return;
			}
		}

		const providerName = args[0].toLowerCase();
		const providerModule = this.servicesLoader.loadedModulesRegistry[providerName];

		if(!providerModule || providerModule.state !== ModuleLoadState.Loaded || !providerModule.base) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_PROVIDERNOTFOUND"))
			});
			return;
		}

		const provider = providerModule.base as IStreamingService;

		let subscription = await this.getSubscription({
			provider: providerName,
			username: args[1]
		});

		let streamer: IStreamingServiceStreamer | undefined = undefined;
		if(!subscription) {
			try {
				streamer = await provider.getStreamer(args[1]);
			} catch(err) {
				if(err instanceof StreamingServiceError) {
					await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED(err.stringKey))
					});
				} else {
					$snowball.captureException(err, { extra: messageToExtra(msg) });
					await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_UNKNOWN"))
					});
				}
				return;
			}

			if(!streamer) { return; }
			subscription = await this.getSubscription({
				provider: streamer.serviceName,
				uid: streamer.uid
			});
		}

		if(!subscription) {
			if(!streamer) { return; }
			subscription = await this.createSubscription({
				provider: streamer.serviceName,
				uid: streamer.uid,
				username: streamer.username,
				subscribers: "[]"
			});
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, i18nSubject, {
			key: LOCALIZED(scope === "guild" ? "ADD_CONFIRMATION" : "ADD_CONFIRMATION_DM"),
			formatOptions: {
				streamerName: subscription.username,
				streamerId: subscription.uid
			}
		});

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("CANCELED"))
			});
			return;
		}

		// fetching subscription
		subscription = await this.getSubscription({
			provider: subscription.provider,
			uid: subscription.uid
		});

		if(!subscription) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_DESTROYED"))
			});
			return;
		}
		
		const subscriberId = scope === "guild" ? msg.guild.id : `u${msg.author.id}`;

		const subscribers = JSON.parse(subscription.subscribers) as string[];

		if(subscribers.includes(subscriberId)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("ADD_FAULT_ALREADYSUBBED"))
			});
			return;
		}

		subscribers.push(subscriberId);
		subscription.subscribers = JSON.stringify(subscribers);

		const index = settings.subscribedTo.findIndex((streamer) => {
			return !!subscription && streamer.serviceName === providerName && streamer.uid === subscription.uid;
		});

		if(index === -1) {
			settings.subscribedTo.push({
				serviceName: providerName,
				uid: subscription.uid,
				username: subscription.username
			});

			await this.updateSettings(this.convertToRawSettings(settings));
		}

		await this.updateSubscription(subscription);

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, i18nSubject, {
				key: LOCALIZED("ADD_DONE"),
				formatOptions: {
					streamerName: subscription.username,
					streamerId: subscription.uid
				}
			})
		});
	}

	async subcmd_remove(msg: Message, args: string[] | undefined, scope: "guild" | "user") {
		// !streams remove YouTube, ID
		// args at this point: ["YouTube", "ID"]

		if(scope === "guild" && msg.channel.type !== "text") {
			return;
		}

		if(scope === "guild" && !rightsCheck(msg.member)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		const i18nSubject = msg.channel.type === "dm" ? msg.author : msg.member;

		if(!args || args.length !== 2) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, i18nSubject, {
					key: LOCALIZED("REMOVE_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		const providerName = args[0].toLowerCase();
		const suid = args[1];

		let rawSubscription = await this.getSubscription({
			provider: providerName,
			uid: suid
		});

		if(!rawSubscription) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("REMOVE_FAULT_SUBNOTFOUND"))
			});
			return;
		}

		let subscription = this.convertToNormalSubscription(rawSubscription);

		const subscriber = scope === "guild" ? msg.guild : msg.author;
		
		const subscriberId = scope === "guild" ? subscriber.id : `u${subscriber.id}`;

		if(!subscription.subscribers.includes(subscriberId)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("REMOVE_FAULT_NOTSUBBED"))
			});
			return;
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, i18nSubject, {
			key: LOCALIZED("REMOVE_CONFIRMATION"),
			formatOptions: {
				streamerId: subscription.uid,
				streamerUsername: subscription.username
			}
		});

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

		if(!confirmation) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Warning, i18nSubject, LOCALIZED("REMOVE_CANCELED"))
			});
			return;
		}

		rawSubscription = await this.getSubscription({
			provider: providerName,
			uid: suid
		});

		if(!rawSubscription) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("REMOVE_FAULT_ALREADYDELETED"))
			});
			return;
		}

		subscription = this.convertToNormalSubscription(rawSubscription);

		const subscriptionIndex = subscription.subscribers.indexOf(subscriberId);

		if(subscriptionIndex === -1) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, i18nSubject, LOCALIZED("REMOVE_FAULT_ALREADYUNSUBBED"))
			});
			return;
		}

		subscription.subscribers.splice(subscriptionIndex, 1);

		let rawSettings = await this.createOrGetSettings(subscriber);
		const parsedSettings = rawSettings ? await this.convertToNormalSettings(rawSettings) : undefined;

		if(parsedSettings) {
			let index = parsedSettings.subscribedTo.findIndex((streamer) => {
				return streamer.serviceName === providerName && streamer.uid === suid;
			});
			if(index !== -1) {
				parsedSettings.subscribedTo.splice(index);
				rawSettings = this.convertToRawSettings(parsedSettings);
				await this.updateSettings(rawSettings);
			}
		}

		if(subscription.subscribers.length === 0) {
			// delete subscription
			await this.removeSubscription(rawSubscription);

			// we'll gonna notify provider that it can free cache for this subscription
			let providerModule = this.servicesLoader.loadedModulesRegistry[args[0].toLowerCase()];
			if(providerModule) {
				let provider = providerModule.base as IStreamingService;

				if($botConfig.mainShard) {
					provider.removeSubscribtion(subscription.uid);
				} else {
					if(process.send) { // notifying then
						process.send({
							type: "streams:free",
							payload: {
								provider: args[0].toLowerCase(),
								uid: subscription.uid
							}
						});
					}
				}
			}
		} else {
			// updating subscription
			rawSubscription = this.convertToRawSubscription(subscription);
			await this.updateSubscription(rawSubscription);
		}

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, i18nSubject, LOCALIZED("REMOVE_DONE"))
		});
	}

	async subcmd_list(msg: Message, calledAs: string | undefined, args: string[] | undefined) {
		// !streams 2
		// !streams YouTube 2

		if(msg.channel.type === "text" && !rightsCheck(msg.member)) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		const subject = msg.channel.type === "dm" ? msg.author : msg.member;

		if(!calledAs) {
			calledAs = "1";
			args = undefined;
		}

		let page = 1;
		let provider = "any";

		if(args && args.length > 1) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("LIST_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		} else if(args) {
			page = parseInt(args[0], 10);
			provider = calledAs.toLowerCase();
			if(isNaN(page) || page < 1) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_INVALIDPAGE"))
				});
				return;
			}
		} else if(!args) {
			if(/^[0-9]+$/.test(calledAs)) {
				page = parseInt(calledAs, 10);
			} else {
				page = 1;
				provider = calledAs.toLowerCase();
			}
		}

		const offset = (20 * page) - 20;
		const end = offset + 20;

		const rawSettings = await this.getSettings(msg.channel.type === "text" ? msg.guild : msg.author);

		if(!rawSettings) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_ISEMPTY"))
			});
			return;
		}

		const normalSettings = await this.convertToNormalSettings(rawSettings);

		let subscriptions = normalSettings.subscribedTo;

		if(provider !== "any") {
			subscriptions = subscriptions.filter(r => {
				return r.serviceName === provider;
			});
		}

		subscriptions = subscriptions.slice(offset, end);

		if(subscriptions.length === 0) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, subject, LOCALIZED("LIST_ISEMPTY"))
			});
			return;
		}

		const fields: IEmbedOptionsField[] = [];
		let c = 0;
		for(const result of subscriptions) {
			fields.push({
				inline: false,
				name: `${++c}. ${result.username}`,
				value: `**${result.serviceName}**, ID: **\`${result.uid}\`**`
			});
		}

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, subject, {
				key: LOCALIZED("LIST_DESCRIPTION"),
				formatOptions: {
					count: subscriptions.length,
					page
				}
			}, { fields })
		});
	}

	// =======================================
	// Interval functions
	// =======================================

	cleanupPromise: undefined | Promise<void> = undefined;

	cleanupInterval: NodeJS.Timer;

	async notificationsCleanup() {
		const notifications = await this.getAllNotifications();
		let resolveFunction: undefined | Function = undefined;
		this.cleanupPromise = new Promise((r) => {
			resolveFunction = r;
		});
		await sleep(100);

		for(const notification of notifications) {
			if((Date.now() - notification.sentAt) > MAX_NOTIFIED_LIFE) {
				await this.deleteNotification(notification);
			}
		}

		if(resolveFunction) {
			resolveFunction();
			this.cleanupPromise = undefined;
		}
	}

	guildSettingsCache: IHashMap<ISettingsParsedRow> = {};

	checknNotifyInterval: NodeJS.Timer;

	private _handlers: {
		online: IHashMap<StreamStatusChangedHandler[]>,
		updated: IHashMap<StreamStatusChangedHandler[]>,
		offline: IHashMap<StreamStatusChangedHandler[]>
	} = {
		online: {},
		updated: {},
		offline: {}
	};

	async handleNotifications() {
		for(const providerName in this.servicesLoader.loadedModulesRegistry) {
			const mod = this.servicesLoader.loadedModulesRegistry[providerName] as ModuleBase<IStreamingService> | undefined;

			if(!mod || !mod.base) {
				this.log("err", `${providerName} is still not loaded (?!)`);
				continue;
			}

			const provider = mod.base as IStreamingService;

			for(const a of ["online", "updated", "offline"]) {
				const action = a as StreamStatusChangedAction;
				const handler = (status) => {
					try {
						this.handleNotification(providerName, status);
					} catch(err) {
						this.log("err", "Failed to handle notification", err);
						$snowball.captureException(err, { extra: { providerName, status } });
					}
				};
				provider.on(action, handler);
				let handlersCollection = this._handlers[action][providerName];
				if(!handlersCollection) {
					handlersCollection = this._handlers[action][providerName] = [] as StreamStatusChangedHandler[];
				}
				handlersCollection.push(handler);
			}

			// loading subscriptions unto provider

			const subscriptions = await this.getSubscriptionsByFilter({
				provider: providerName
			});

			for(const subscription of subscriptions) {
				if(provider.isSubscribed(subscription.uid)) {
					continue;
				}

				provider.addSubscription({
					serviceName: providerName,
					uid: subscription.uid,
					username: subscription.username
				});
			}

			if(provider.start) {
				await provider.start();
			}
		}
	}

	async handleNotification(providerName: string, status: IStreamStatus) {
		const subscriptions = (await this.getSubscriptionsByFilter({
			provider: providerName,
			uid: status.streamer.uid
		})).map(this.convertToNormalSubscription);

		for(const subscription of subscriptions) {
			if(subscription.username !== status.streamer.username) {
				// for cases if streamer changed username (Twitch/Mixer)
				subscription.username = status.streamer.username;
			}

			for(const subscriberId of subscription.subscribers) {
				const notification = await this.getNotification(subscription.provider, subscription.uid, (status.updated && status.oldId ? status.oldId : status.id), subscriberId);

				if(subscriberId.startsWith("u")) {
					// user subscriber

					const userId = subscriberId.slice(1);
					const user = await $discordBot.fetchUser(userId);

					if(!user) {
						this.log("warn", "Could not find subscribed user", userId);
						continue;
					}

					await this.pushNotification(user, status, subscription, notification);
				} else {
					const guild = $discordBot.guilds.get(subscriberId);

					if(!guild && process.send) {
						process.send({
							type: "streams:push",
							payload: {
								ifYouHaveGuild: subscriberId,
								notifyAbout: {
									subscription,
									notification,
									status
								}
							}
						});
						continue;
					} else if(!guild && !process.send) {
						this.log("warn", `Could not find subscribed guild and notify other shards: ${subscriberId} to ${subscription.uid} (${subscription.provider})`);
					} else if(guild) {
						await this.pushNotification(guild, status, subscription, notification);
					}
				}
			}
		}
	}

	async pushNotification(scope: Guild | User, result: IStreamStatus, subscription: ISubscriptionRow, notification?: INotification) {
		const providerName = subscription.provider;

		const mod = this.servicesLoader.loadedModulesRegistry[providerName] as ModuleBase<IStreamingService> | undefined;

		if(!mod || !mod.base) {
			this.log("warn", "WARN:", providerName, "not found as loaded service");
			return;
		}

		const service = mod.base as IStreamingService;

		if((!result.updated && result.status !== "offline") && notification) {
			return;
		}

		const embedLanguage = scope instanceof User ? await getUserLanguage(scope) : await getGuildLanguage(scope);

		let embed: IEmbed | undefined = undefined;

		try {
			embed = await service.getEmbed(result, embedLanguage);
		} catch(err) {
			$snowball.captureException(err, {
				extra: {
					embedLanguage,
					result, providerName
				}
			});
			this.log("err", "Failed to get embed for stream of", `${subscription.uid} (${providerName})`, err);
			return;
		}

		if(!embed) {
			this.log("warn", "Embed was not returned for stream of", `${subscription.uid} (${providerName})`);
			return;
		}

		const isUser = scope instanceof User;

		let channel: undefined | TextChannel | DMChannel = undefined;

		if(isUser) {
			const user = scope as User;
			channel = user.dmChannel;
			if(!channel) {
				channel = await user.createDM();
			}
		}

		let settings = this.guildSettingsCache[scope.id];
		if(!settings) {
			const dbSettings = await this.getSettings(scope);
			if(!dbSettings) {
				this.log("err", "Not found `dbSettings` for subscribed subject", scope.id, "to subscription", `${subscription.uid} (${providerName})`);
				return;
			}
			settings = this.convertToNormalSettings(dbSettings);
			this.guildSettingsCache[scope.id] = settings;
		}

		if(!isUser) {
			if(!settings.channelId || settings.channelId === "-") { return; }

			const guild = scope as Guild;
			channel = guild.channels.get(settings.channelId) as TextChannel;
		}

		if(!channel) {
			this.log("err", `Not found channel for subscribed subject ${scope.id} to subscription ${subscription.uid} (${providerName}) (subject-type: ${isUser ? "user" : "guild"})`);
			return;
		}

		const shouldMentionEveryone = !!settings.mentionsEveryone.find(s => {
			return s.serviceName === providerName && (s.uid === subscription.uid || s.username === subscription.username);
		});

		if((result.updated || result.status === "offline") && (notification && notification.channelId === channel.id)) {
			const msg = await (async () => {
				try {
					return (await channel.fetchMessage(notification.messageId));
				} catch(err) {
					this.log("err", "Could not find message with ID", notification.messageId, "to update message", err);

					if(err instanceof DiscordAPIError) {
						// so we probably don't have access or something
						// we don't need to attempt updating message
						// so removing this notification :shrug:
						await this.deleteNotification(notification);
					}

					return undefined;
				}
			})();

			if(!msg) { return; }

			try {
				const escapedUsername = escapeDiscordMarkdown(subscription.username, true);
				await msg.edit(shouldMentionEveryone ?
					"@everyone " + $localizer.getFormattedString(embedLanguage, result.status === "offline" ? LOCALIZED("NOTIFICATION_EVERYONE_OFFLINE") : LOCALIZED("NOTIFICATION_EVERYONE_UPDATED"), {
						username: escapedUsername
					})
					: (
						isUser ? $localizer.getFormattedString(
							embedLanguage,
							result.status === "offline" ? LOCALIZED("NOTIFICATION_DM_OFFLINE") : LOCALIZED("NOTIFICATION_DM_UPDATED"), {
								username: escapedUsername,
								notice: $localizer.getFormattedString(embedLanguage, LOCALIZED(result.status === "offline" ? "NOTIFICATION_DM_NOTICE_OFFLINE" : "NOTIFICATION_DM_NOTICE"), {
									username: escapedUsername
								}),
								command: `${PREFIX} unsubscribe ${providerName}, ${subscription.uid}`
							}) : ""), {
						embed: embed as any
					});
			} catch(err) {
				this.log("err", "Failed to update message with ID", notification.messageId, err);
				$snowball.captureException(err, {
					extra: { subscription, embedLanguage, result, channel: channel }
				});
			}

			if(result.status === "offline") {
				await this.deleteNotification(notification);
				// we don't need it anymore
			} else {
				notification.streamId = result.id;
				notification.sentAt = Date.now();
				await this.updateNotification(notification);
			}
		} else if(result.status !== "offline") {
			let messageId = "";
			const escapedUsername = escapeDiscordMarkdown(subscription.username, true);
			try {
				const msg = (await channel.send(shouldMentionEveryone ?
					"@everyone " + $localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_EVERYONE"), {
						username: escapedUsername
					}) : (
						isUser ? $localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_DM_STARTED"), {
							username: escapedUsername,
							notice: $localizer.getFormattedString(embedLanguage, LOCALIZED("NOTIFICATION_DM_NOTICE"), {
								username: escapedUsername
							}),
							command: `${PREFIX} unsubscribe ${providerName}, ${subscription.uid}`
						}) : ""
					), {
						embed: embed as any
					})) as Message;
				messageId = msg.id;
			} catch(err) {
				$snowball.captureException(err, {
					extra: { subscription, embedLanguage, result, channelId: channel.id }
				});
				this.log("err", "Failed to send notification for stream of", `${subscription.uid} (${providerName})`, "to channel", `${channel.id}.`, "Error ocurred", err);
				return;
			}

			notification = {
				guild: isUser ? `u${scope.id}` : scope.id,
				channelId: channel.id,
				messageId,
				provider: subscription.provider,
				sentAt: Date.now(),
				streamerId: subscription.uid,
				streamId: result.id
			};

			await this.saveNotification(notification);
		}
	}

	// =======================================
	// Additional bridge functions
	// =======================================

	async createOrGetSettings(scope: Guild | User) {
		let settings = await this.getSettings(scope);
		if(!settings) {
			settings = await this.createSettings({
				channelId: null,
				guild: scope instanceof User ? `u${scope.id}` : scope.id,
				mentionsEveryone: "[]",
				subscribedTo: "[]"
			});
		}
		return settings;
	}

	// =======================================
	// Converting
	// =======================================

	convertToNormalSettings(raw: ISettingsRow): ISettingsParsedRow {
		return {
			channelId: raw.channelId,
			guild: raw.guild,
			mentionsEveryone: JSON.parse(raw.mentionsEveryone),
			subscribedTo: JSON.parse(raw.subscribedTo)
		};
	}

	convertToRawSettings(normal: ISettingsParsedRow): ISettingsRow {
		return {
			channelId: normal.channelId,
			guild: normal.guild,
			mentionsEveryone: JSON.stringify(normal.mentionsEveryone),
			subscribedTo: JSON.stringify(normal.subscribedTo)
		};
	}

	convertToMap<T>(toConvert: T[], key: string): Map<string, T> {
		const map = new Map<string, T>();
		for(const elem of toConvert) {
			map.set(elem[key], elem);
		}
		return map;
	}

	convertToNormalSubscription(raw: ISubscriptionRawRow): ISubscriptionRow {
		return {
			username: raw.username,
			uid: raw.uid,
			provider: raw.provider,
			subscribers: JSON.parse(raw.subscribers)
		};
	}

	convertToRawSubscription(normal: ISubscriptionRow): ISubscriptionRawRow {
		return {
			username: normal.username,
			uid: normal.uid,
			provider: normal.provider,
			subscribers: JSON.stringify(normal.subscribers)
		};
	}

	convertToStreamer(subscription: ISubscriptionRow): IStreamingServiceStreamer {
		return {
			serviceName: subscription.provider,
			uid: subscription.uid,
			username: subscription.username
		};
	}

	// =======================================
	// DB<>Plugin methods
	// =======================================

	async getAllNotifications() {
		return (await this.db(TABLE.notifications).select()) as INotification[];
	}

	async getSubscriptionsByFilter(filter: SubscriptionFilter): Promise<ISubscriptionRawRow[]> {
		return await this.db(TABLE.subscriptions).select().where(filter) as ISubscriptionRawRow[];
	}

	async getSubscription(filter: SubscriptionFilter): Promise<ISubscriptionRawRow | undefined> {
		if(!filter.uid && !filter.username) {
			throw new Error("Nor uid nor username provided");
		}
		return await this.db(TABLE.subscriptions).select().where(filter).first() as ISubscriptionRawRow;
	}

	async createSubscription(row: ISubscriptionRawRow) {
		await this.db(TABLE.subscriptions).insert(row);
		return row;
	}

	async updateSubscription(newSubscription: ISubscriptionRawRow) {
		return await this.db(TABLE.subscriptions).where({
			provider: newSubscription.provider,
			uid: newSubscription.uid,
			username: newSubscription.username
		}).update(newSubscription);
	}

	async removeSubscription(subscription: ISubscriptionRawRow) {
		return await this.db(TABLE.subscriptions).where({
			provider: subscription.provider,
			uid: subscription.uid,
			username: subscription.username
		}).delete();
	}

	async getSettings(scope: Guild | User): Promise<ISettingsRow | undefined> {
		return await this.db(TABLE.settings).where({
			guild: scope instanceof User ? `u${scope.id}` : scope.id
		}).first() as ISettingsRow;
	}

	async createSettings(row: ISettingsRow) {
		await this.db(TABLE.settings).insert(row);
		return row;
	}

	async updateSettings(newSettings: ISettingsRow) {
		return this.db(TABLE.settings).where({
			guild: newSettings.guild
		}).update(newSettings);
	}

	async saveNotification(notification: INotification) {
		return await this.db(TABLE.notifications).insert(notification);
	}

	async updateNotification(notification: INotification) {
		return await this.db(TABLE.notifications).where({
			guild: notification.guild,
			provider: notification.provider,
			streamerId: notification.streamerId
		} as INotification).update(notification);
	}

	async deleteNotification(notification: INotification) {
		return await this.db(TABLE.notifications).where(notification).delete();
	}

	async getNotification(provider: string, streamerId: string, streamId: string, guild: Guild | string) {
		return await this.db(TABLE.notifications).where({
			provider,
			streamerId,
			streamId,
			guild: guild instanceof Guild ? guild.id : guild
		} as INotification).first() as INotification;
	}

	// =======================================
	// Plugin init & unload
	// =======================================

	async init() {
		let subscriptionsTableCreated = await this.db.schema.hasTable(TABLE.subscriptions);
		if(!subscriptionsTableCreated) {
			this.log("info", "Table of subscriptions not found, going to create it right now");
			await createTableBySchema(TABLE.subscriptions, {
				provider: "string",
				uid: "string",
				username: "string",
				subscribers: {
					type: "MEDIUMTEXT"
				}
			});
		}

		let settingsTable = await this.db.schema.hasTable(TABLE.settings);
		if(!settingsTable) {
			this.log("info", "Table of settings not found, going to create it right now");
			await createTableBySchema(TABLE.settings, {
				guild: {
					type: "string",
					comment: "Guild ID that these settings used for"
				},
				channelId: {
					type: "string",
					comment: "Channel ID where notifications going to"
				},
				mentionsEveryone: {
					type: "TEXT",
					comment: "A list of channels with turned on everyone mention"
				},
				subscribedTo: {
					type: "TEXT",
					comment: "A list of subscriptions"
				}
			});
		}

		let notificationsTable = await this.db.schema.hasTable(TABLE.notifications);
		if(!notificationsTable) {
			this.log("info", "Table of notifications statuses not found, will be created in momento");
			await createTableBySchema(TABLE.notifications, {
				guild: {
					type: "string",
					comment: "ID of the guild that was notified"
				},
				provider: {
					type: "string",
					comment: "Provider stream comes from"
				},
				channelId: {
					type: "string",
					comment: "ID of channel that was notified"
				},
				streamId: {
					type: "string",
					comment: "ID of the stream"
				},
				streamerId: {
					type: "string",
					comment: "UID of channel on streaming service"
				},
				messageId: {
					type: "string",
					comment: "ID of message with notification"
				},
				sentAt: {
					type: "bignumber",
					comment: "Timestamp when guild was notified"
				}
			});
		}

		for(let serviceName in this.servicesList) {
			await this.servicesLoader.load(serviceName);
		}

		const whitelistModule = $modLoader.signaturesRegistry["snowball.core_features.whitelist"];
		if(!whitelistModule) {
			this.log("warn", "Whitelist module not found :CCCCC");
		} else {
			this.whitelistModule = whitelistModule as ModuleBase<Whitelist>;
		}

		if($botConfig.mainShard) {
			this.cleanupInterval = setInterval(() => this.notificationsCleanup(), 86400000);
			await this.notificationsCleanup();

			process.on("message", (msg) => {
				if(typeof msg !== "object") { return; }
				if(!msg.type || !msg.payload) { return; }
				if(msg.type !== "streams:free") { return; }

				this.log("info", "Received message", msg);

				let payload = msg.payload as {
					provider: string;
					uid: string;
				};

				let mod = this.servicesLoader.loadedModulesRegistry[payload.provider];
				if(!mod) { this.log("warn", "Provider not found", payload.provider, "- message ignored"); return; }
				if(mod.state !== ModuleLoadState.Loaded || !mod.base) { this.log("warn", "Provider isn't loaded", payload.provider, "- message ignored"); return; }

				let provider = mod.base as IStreamingService;

				if(msg.type === "streams:free") {
					provider.removeSubscribtion(payload.uid);
				}
			});

			await this.handleNotifications();
		} else {
			this.log("warn", "Working not in lead shard, waiting for messages");

			process.on("message", (msg) => {
				if(typeof msg !== "object") { return; }
				if(!msg.type || !msg.payload) { return; }
				if(msg.type !== "streams:push") { return; }

				this.log("info", "Received message", msg);
				if(msg.payload.ifYouHaveGuild && msg.payload.notifyAbout) {
					let guild = $discordBot.guilds.get(msg.payload.ifYouHaveGuild as string);
					if(guild) {
						// process
						let notifyAbout = msg.payload.notifyAbout as {
							subscription: ISubscriptionRow,
							notification: INotification,
							result: IStreamStatus
						};
						this.pushNotification(guild, notifyAbout.result, notifyAbout.subscription, notifyAbout.notification);
					}
				}
			});
		}

		this.handleEvents();
	}

	async unload() {
		if(this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		if(this.checknNotifyInterval) {
			clearInterval(this.checknNotifyInterval);
		}
		await this.servicesLoader.unloadAll();
		this.unhandleEvents();
		return true;
	}
}

module.exports = StreamNotifications;