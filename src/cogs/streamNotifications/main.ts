import { IModule, ModuleLoader, convertToModulesMap, IModuleInfo, ModuleBase, ModuleLoadState } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember, DiscordAPIError } from "discord.js";
import { getLogger } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import { simpleCmdParse } from "../utils/text";
import { generateLocalizedEmbed, getGuildLanguage } from "../utils/ez-i18n";
import { EmbedType, sleep, IEmbedOptionsField, IEmbed } from "../utils/utils";
import { IStreamingService, IStreamingServiceStreamer, StreamingServiceError, IStreamStatus, StreamStatusChangedHandler, StreamStatusChangedAction } from "./baseService";
import { createConfirmationMessage } from "../utils/interactive";
import { command } from "../utils/help";
import { IHashMap } from "../../types/Interfaces";
import { messageToExtra } from "../utils/failToDetail";

const PREFIX = "!streams";
const MAX_NOTIFIED_LIFE = 86400000; // ms

const TABLE = {
	subscriptions: "sn_subscriptions",
	settings: "sn_settings",
	notifications: "sn_notifications"
};

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

function rightsCheck(member: GuildMember) {
	return member.permissions.has(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.permissions.has(["ADMINISTRATOR"]) || member.id === $botConfig.botOwner;
}

function helpCheck(msg: Message) {
	return msg.channel.type === "text" && rightsCheck(msg.member);
}

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
@command(HELP_CATEGORY, `${PREFIX.slice(1)} remove`, `loc:${LOCALIZED("META_REMOVE")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_ADD_ARG0_DESC",
		optional: false
	},
	"loc:STREAMING_META_ADD_ARG1": {
		description: "loc:STREAMING_META_ADD_ARG1_DESC",
		optional: false
	}
}, helpCheck)
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
@command(HELP_CATEGORY, `${PREFIX.slice(1)} add`, `loc:${LOCALIZED("META_SETCHANNEL")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_SETCHANNEL_ARG0_DESC",
		optional: false
	}
}, helpCheck)
@command(HELP_CATEGORY, `${PREFIX.slice(1)}`, `loc:${LOCALIZED("META_LIST")}`, {
	"loc:STREAMING_META_ADD_ARG0": {
		description: "loc:STREAMING_META_LIST_ARG0_DESC",
		optional: true
	},
	"loc:STREAMING_META_LIST_ARG1": {
		description: "loc:STREAMING_META_LIST_ARG1_DESC",
		optional: false
	}
}, helpCheck)
class StreamNotifications extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.stream_notifications";
	}

	log = getLogger("StreamNotifications");
	db = getDB();
	servicesLoader: ModuleLoader;
	servicesList: IHashMap<IModuleInfo>;

	constructor(options) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);

		this.servicesList = convertToModulesMap(options);

		this.servicesLoader = new ModuleLoader({
			name: "StreamNotifications:Services",
			basePath: "./cogs/streamNotifications/services/",
			registry: this.servicesList,
			defaultSet: []
		});
	}

	// =======================================
	//  Message handling
	// =======================================

	async onMessage(msg: Message) {
		if(!msg.content.startsWith(PREFIX)) { return; }
		let cmd = simpleCmdParse(msg.content);
		try {
			switch(cmd.subCommand) {
				case "edit": await this.subcmd_edit(msg, cmd.args); break;
				case "add": await this.subcmd_add(msg, cmd.args); break;
				case "remove": await this.subcmd_remove(msg, cmd.args); break;
				case "set_channel": await this.subcmd_setChannel(msg, cmd.args); break;
				default: await this.cmd_list(msg, cmd.subCommand, cmd.args); break;
			}
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("CMD_ERROR"))
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

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 1) {
			msg.channel.send("", {
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
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGIDFORMAT"))
				});
				return;
			}

			// trying to find this channel?

			let channel = msg.guild.channels.get(channelId);
			if(!channel) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_CHANNELNOTFOUND"))
				});
				return;
			}

			if(channel.type !== "text") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("SETCHANNEL_FAULT_WRONGCHANNELTYPE"))
				});
				return;
			}

			settings.channelId = channel.id;
		} else {
			settings.channelId = null;
		}

		await this.updateSettings(settings);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("SETCHANNEL_DONE"))
		});
	}

	async subcmd_edit(msg: Message, args: string[] | undefined) {
		// !streams edit YouTube, ID, mention_everyone, true
		// args at this point: ["YouTube", "ID", "mention_everyone", "true"]

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 4) {
			msg.channel.send("", {
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
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_INVALIDARG0"))
					});
					return;
				}
			} break;
			default: {
				msg.channel.send("", {
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
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_SUBNOTFOUND"))
			});
			return;
		}

		// then getting settings

		let rawSettings = await this.createOrGetSettings(msg.guild);

		// parse settings

		let settings = this.convertToNormalSettings(rawSettings);

		// caching for our dear interval

		this.guildSettingsCache.set(settings.guild, settings);

		if(args[2] === "mention_everyone") {
			if(args[3] === "true") {
				// find current one?

				let current = settings.mentionsEveryone.find((s) => {
					return !!subscription && s.serviceName === subscription.provider && s.uid === subscription.uid && s.username === subscription.username;
				});

				if(current) {
					msg.channel.send("", {
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
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("EDIT_FAULT_ME_ALREADYNOTMENTIONS"))
					});
					return;
				}

				settings.mentionsEveryone.splice(index, 1);
			}
		}

		rawSettings = this.convertToRawSettings(settings);

		await this.updateSettings(rawSettings);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("EDIT_DONE"))
		});
	}

	async subcmd_add(msg: Message, args: string[] | undefined) {
		// !streams add YouTube, BlackSilverUfa
		// args at this point: ["YouTube", "BlackSilverUfa"]

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 2) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("ADD_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		let providerName = args[0].toLowerCase();
		let providerModule = this.servicesLoader.loadedModulesRegistry[providerName];
		if(!providerModule) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("ADD_FAULT_PROVIDERNOTFOUND"))
			});
			return;
		}

		let provider = providerModule.base as IStreamingService;
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
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED(err.stringKey))
					});
				} else {
					$snowball.captureException(err, { extra: messageToExtra(msg) });
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("ADD_FAULT_UNKNOWN"))
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

		let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: LOCALIZED("ADD_CONFIRMATION"),
			formatOptions: {
				streamerName: subscription.username,
				streamerId: subscription.uid
			}
		});

		let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, LOCALIZED("CANCELED"))
			});
			return;
		}

		// fetching subscription
		subscription = await this.getSubscription({
			provider: subscription.provider,
			uid: subscription.uid
		});

		if(!subscription) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("ADD_FAULT_DESTROYED"))
			});
			return;
		}

		let subscribers = JSON.parse(subscription.subscribers) as string[];

		if(subscribers.includes(msg.guild.id)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("ADD_FAULT_ALREADYSUBBED"))
			});
			return;
		}

		subscribers.push(msg.guild.id);
		subscription.subscribers = JSON.stringify(subscribers);

		let rawSettings = await this.getSettings(msg.guild);
		let settings = rawSettings ? await this.convertToNormalSettings(rawSettings) : undefined;

		if(settings) {
			let index = settings.subscribedTo.findIndex((streamer) => {
				return !!subscription && streamer.serviceName === providerName && streamer.uid === subscription.uid;
			});
			if(index === -1) {
				settings.subscribedTo.push({
					serviceName: providerName,
					uid: subscription.uid,
					username: subscription.username
				});

				rawSettings = this.convertToRawSettings(settings);
				await this.updateSettings(rawSettings);
			}
		}

		await this.updateSubscription(subscription);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: LOCALIZED("ADD_DONE"),
				formatOptions: {
					streamerName: subscription.username,
					streamerId: subscription.uid
				}
			})
		});
	}

	async subcmd_remove(msg: Message, args: string[] | undefined) {
		// !streams remove YouTube, ID
		// args at this point: ["YouTube", "ID"]

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!args || args.length !== 2) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: LOCALIZED("REMOVE_USAGE"),
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
			return;
		}

		let providerName = args[0].toLowerCase();
		let suid = args[1];

		let rawSubscription = await this.getSubscription({
			provider: providerName,
			uid: suid
		});

		if(!rawSubscription) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("REMOVE_FAULT_SUBNOTFOUND"))
			});
			return;
		}

		let subscription = this.convertToNormalSubscription(rawSubscription);

		if(!subscription.subscribers.includes(msg.guild.id)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("REMOVE_FAULT_NOTSUBBED"))
			});
			return;
		}

		let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: LOCALIZED("REMOVE_CONFIRMATION"),
			formatOptions: {
				streamerId: subscription.uid,
				streamerUsername: subscription.username
			}
		});

		let confirmation = await createConfirmationMessage(confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, LOCALIZED("REMOVE_CANCELED"))
			});
			return;
		}

		rawSubscription = await this.getSubscription({
			provider: providerName,
			uid: suid
		});

		if(!rawSubscription) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("REMOVE_FAULT_ALREADYDELETED"))
			});
			return;
		}

		subscription = this.convertToNormalSubscription(rawSubscription);

		let index = subscription.subscribers.indexOf(msg.guild.id);

		if(index === -1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("REMOVE_FAULT_ALREADYUNSUBBED"))
			});
			return;
		}

		subscription.subscribers.splice(index, 1);

		let rawSettings = await this.getSettings(msg.guild);
		let settings = rawSettings ? await this.convertToNormalSettings(rawSettings) : undefined;

		if(settings) {
			let index = settings.subscribedTo.findIndex((streamer) => {
				return streamer.serviceName === providerName && streamer.uid === suid;
			});
			if(index !== -1) {
				settings.subscribedTo.splice(index);
				rawSettings = this.convertToRawSettings(settings);
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

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, LOCALIZED("REMOVE_DONE"))
		});
	}

	async cmd_list(msg: Message, calledAs: string | undefined, args: string[] | undefined) {
		// !streams 2
		// !streams YouTube 2

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("NO_PERMISSIONS"))
			});
			return;
		}

		if(!calledAs) {
			calledAs = "1";
			args = undefined;
		}

		let page = 1;
		let provider = "any";

		if(args && args.length > 1) {
			msg.channel.send("", {
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
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, LOCALIZED("LIST_INVALIDPAGE"))
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

		let offset = (20 * page) - 20;
		let end = offset + 20;

		let rawSettings = await this.getSettings(msg.guild);
		if(!rawSettings) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, LOCALIZED("LIST_ISEMPTY"))
			});
			return;
		}
		let normalSettings = await this.convertToNormalSettings(rawSettings);

		let results = normalSettings.subscribedTo;

		if(provider !== "any") {
			results = results.filter(r => {
				return r.serviceName === provider;
			});
		}

		results = results.slice(offset, end);

		if(results.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, LOCALIZED("LIST_ISEMPTY"))
			});
			return;
		}

		const fields: IEmbedOptionsField[] = [];
		let c = 1;
		for(const result of results) {
			fields.push({
				inline: false,
				name: `${c++}. ${result.username}`,
				value: `**${result.serviceName}**, ID: **\`${result.uid}\`**`
			});
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: LOCALIZED("LIST_DESCRIPTION"),
				formatOptions: {
					count: results.length,
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
		let notifications = await this.getAllNotifications();
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

	guildSettingsCache = new Map<string, ISettingsParsedRow>();

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

			for(const subscribedGuildId of subscription.subscribers) {
				const notification = await this.getNotification(subscription.provider, subscription.uid, (status.updated && status.oldId ? status.oldId : status.id), subscribedGuildId);

				const guild = $discordBot.guilds.get(subscribedGuildId);

				if(!guild) {
					if(process.send) {
						process.send({
							type: "streams:push",
							payload: {
								ifYouHaveGuild: subscribedGuildId,
								notifyAbout: {
									subscription,
									notification,
									status
								}
							}
						});
					} else {
						this.log("warn", "Could not find subscribed guild and notify other shards", subscribedGuildId, "to", subscription.uid, `(${subscription.provider})`);
					}
					continue;
				}

				await this.pushNotification(guild, status, subscription, notification);
			}
		}
	}

	async pushNotification(guild: Guild, result: IStreamStatus, subscription: ISubscriptionRow, notification?: INotification) {
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

		const guildLanguage = await getGuildLanguage(guild);

		let embed: IEmbed | undefined = undefined;

		try {
			embed = await service.getEmbed(result, guildLanguage);
		} catch(err) {
			$snowball.captureException(err, {
				extra: {
					guildLanguage,
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

		let settings = this.guildSettingsCache.get(guild.id);
		if(!settings) {
			const dbSettings = await this.getSettings(guild);
			if(!dbSettings) {
				this.log("err", "Not found `dbSettings` for subscribed guild", guild.id, "to subscription", `${subscription.uid} (${providerName})`);
				return;
			}
			settings = this.convertToNormalSettings(dbSettings);
			this.guildSettingsCache.set(guild.id, settings);
		}

		if(!settings.channelId || settings.channelId === "-") { return; }

		const channel = guild.channels.get(settings.channelId);
		if(!channel) {
			this.log("err", "Not found channel for subscribed guild", guild.id, "to subscription", `${subscription.uid} (${providerName})`);
			return;
		}

		const mentionsEveryone = !!settings.mentionsEveryone.find(s => {
			return s.serviceName === providerName && (s.uid === subscription.uid || s.username === subscription.username);
		});

		if((result.updated || result.status === "offline") && (notification && notification.channelId === channel.id)) {
			const msg = await (async () => {
				try {
					return (await (channel as TextChannel).fetchMessage(notification.messageId));
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
				await msg.edit(mentionsEveryone ?
					"@everyone " + $localizer.getFormattedString(guildLanguage, result.status === "offline" ? LOCALIZED("NOTIFICATION_EVERYONE_OFFLINE") : LOCALIZED("NOTIFICATION_EVERYONE_UPDATED"), {
						username: subscription.username
					})
					: "", {
						embed: embed as any
					});
			} catch(err) {
				this.log("err", "Failed to update message with ID", notification.messageId, err);
				$snowball.captureException(err, {
					extra: { subscription, guildLanguage, result, channelId: channel.id }
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
			try {
				let msg = (await (channel as TextChannel).send(mentionsEveryone ?
					"@everyone " + $localizer.getFormattedString(guildLanguage, "STREAMING_NOTIFICATION_EVERYONE", {
						username: subscription.username
					})
					: "", {
						embed: embed as any
					})) as Message;
				messageId = msg.id;
			} catch(err) {
				$snowball.captureException(err, {
					extra: { subscription, guildLanguage, result, channelId: channel.id }
				});
				this.log("err", "Failed to send notification for stream of", `${subscription.uid} (${providerName})`, "to channel", `${channel.id}.`, "Error ocurred", err);
				return;
			}

			notification = {
				guild: guild.id,
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

	async createOrGetSettings(guild: Guild) {
		let settings = await this.getSettings(guild);
		if(!settings) {
			settings = await this.createSettings({
				channelId: null,
				guild: guild.id,
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

	async getSettings(guild: Guild): Promise<ISettingsRow | undefined> {
		return await this.db(TABLE.settings).where({
			guild: guild.id
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
					comment: "A list of channels with turned on everyone mention",
					default: "[]"
				},
				subscribedTo: {
					type: "TEXT",
					comment: "A list of subscriptions",
					default: "[]"
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