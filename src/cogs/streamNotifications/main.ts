import { IModule, ModuleLoader, convertToModulesMap, IModuleInfo } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember } from "discord.js";
import { getLogger } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import { simpleCmdParse } from "../utils/text";
import { generateLocalizedEmbed, getGuildLanguage } from "../utils/ez-i18n";
import { EmbedType, sleep, IEmbedOptionsField, IEmbed } from "../utils/utils";
import { IStreamingService, IStreamingServiceStreamer, StreamingServiceError, IStreamStatus } from "./baseService";
import { createConfirmationMessage } from "../utils/interactive";
import { command, Category as CommandCategory } from "../utils/help";

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

function rightsCheck(member: GuildMember) {
    return member.hasPermission(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.hasPermission(["ADMINISTRATOR"]) || member.id === botConfig.botOwner;
}

function helpCheck(msg: Message) {
    return msg.channel.type === "text" && rightsCheck(msg.member);
}

@command(CommandCategory.Helpful, `${PREFIX.slice(1)} add`, `loc:${LOCALIZED("META_ADD")}`, {
    "loc:STREAMING_META_ADD_ARG0": {
        description: "loc:STREAMING_META_ADD_ARG0_DESC",
        optional: false
    },
    "loc:STREAMING_META_ADD_ARG1": {
        description: "loc:STREAMING_META_ADD_ARG1_DESC",
        optional: false
    }
}, helpCheck)
@command(CommandCategory.Helpful, `${PREFIX.slice(1)} remove`, `loc:${LOCALIZED("META_REMOVE")}`, {
    "loc:STREAMING_META_ADD_ARG0": {
        description: "loc:STREAMING_META_ADD_ARG0_DESC",
        optional: false
    },
    "loc:STREAMING_META_ADD_ARG1": {
        description: "loc:STREAMING_META_ADD_ARG1_DESC",
        optional: false
    }
}, helpCheck)
@command(CommandCategory.Helpful, `${PREFIX.slice(1)} edit`, `loc:${LOCALIZED("META_EDIT")}`, {
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
@command(CommandCategory.Helpful, `${PREFIX.slice(1)} add`, `loc:${LOCALIZED("META_SETCHANNEL")}`, {
    "loc:STREAMING_META_ADD_ARG0": {
        description: "loc:STREAMING_META_SETCHANNEL_ARG0_DESC",
        optional: false
    }
}, helpCheck)
@command(CommandCategory.Helpful, `${PREFIX.slice(1)}`, `loc:${LOCALIZED("META_LIST")}`, {
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
    log = getLogger("StreamNotifications");
    db = getDB();
    servicesLoader: ModuleLoader;
    servicesList: Map<string, IModuleInfo>;

    constructor(options) {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        }, true);

        this.servicesList = new Map<string, IModuleInfo>(convertToModulesMap(options));

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
        let providerModule = this.servicesLoader.loadedModulesRegistry.get(providerName);
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

        if(subscription.subscribers.includes(msg.guild.id)) {
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
            let providerModule = this.servicesLoader.loadedModulesRegistry.get(args[0].toLowerCase());
            if(providerModule) {
                let provider = providerModule.base as IStreamingService;

                if(botConfig.mainShard) {
                    if(provider.freed) { provider.freed(rawSubscription.uid); }
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

        let fields: IEmbedOptionsField[] = [];
        let c = 1;
        for(let result of results) {
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
            }, {
                    fields
                })
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

        for(let notification of notifications) {
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

    private performingStreamsCheck = false;

    async checknNotify() {
        if(this.cleanupPromise) {
            await this.cleanupPromise;
        }

        if(this.performingStreamsCheck) {
            // for cases if checking goes for long time
            // by some reason it could happen in future
            // unlike cleanup this is not the Promise because we won't do check-after-check
            return;
        }

        this.performingStreamsCheck = true;

        for(let [providerName, mod] of this.servicesLoader.loadedModulesRegistry) {
            if(!mod.base) {
                this.log("warn", "Not found streaming service with name", providerName);
                continue;
            }
            let service = mod.base as IStreamingService;
            let subscriptions = (await this.getSubscriptionsForService(providerName)).map(this.convertToNormalSubscription);
            let toFetch = subscriptions.map(this.convertToStreamer);
            let results: IStreamStatus[] = [];

            try {
                results = await service.fetch(toFetch);
            } catch(err) {
                this.log("err", "Failed to fetch streams from", providerName, err);
                continue;
            }

            for(let result of results) {
                let streamerSubscriptions = subscriptions.filter(sub => {
                    return sub.uid === result.streamer.uid;
                });

                for(let subscription of streamerSubscriptions) {
                    if(subscription.username !== result.streamer.username) {
                        // for cases if streamer changed username (Twitch/Mixer)
                        subscription.username = result.streamer.username;
                    }

                    for(let subscribedGuildId of subscription.subscribers) {
                        let notification = await this.getNotification(subscription.provider, subscription.uid, (result.updated && result.oldId ? result.oldId : result.id), subscribedGuildId);

                        let guild = discordBot.guilds.get(subscribedGuildId);

                        if(!guild) {
                            if(process.send) {
                                process.send({
                                    type: "streams:push",
                                    payload: {
                                        ifYouHaveGuild: subscribedGuildId,
                                        notifyAbout: {
                                            subscription,
                                            notification,
                                            result
                                        }
                                    }
                                });
                            } else {
                                this.log("warn", "Could not find subscribed guild and notify other shards", subscribedGuildId, "to", subscription.uid, `(${subscription.provider})`);
                            }
                            continue;
                        }

                        await this.pushNotification(guild, result, subscription, notification);
                    }
                }
            }

            let rSubscriptions = subscriptions.map(this.convertToRawSubscription);
            for(let rSubscription of rSubscriptions) {
                await this.updateSubscription(rSubscription);
            }
        }

        this.performingStreamsCheck = false;
    }

    async pushNotification(guild:Guild, result: IStreamStatus, subscription:ISubscriptionRow, notification?:INotification) {
        let providerName = subscription.provider;
        let mod = this.servicesLoader.loadedModulesRegistry.get(providerName);
        if(!mod) {
            this.log("warn", "WARN:", providerName, "not found as loaded service");
            return;
        }
        let service = mod.base as IStreamingService;

        let guildLanguage = await getGuildLanguage(guild);

        let embed: IEmbed | undefined = undefined;

        try {
            embed = await service.getEmbed(result, guildLanguage);
        } catch(err) {
            this.log("err", "Failed to get embed for stream of", `${subscription.uid} (${providerName})`, err);
        }

        if(!embed) {
            this.log("warn", "Embed was not returned for stream of", `${subscription.uid} (${providerName})`);
            return;
        }

        let settings = this.guildSettingsCache.get(guild.id);
        if(!settings) {
            let dbSettings = await this.getSettings(guild);
            if(!dbSettings) {
                this.log("err", "Not found `dbSettings` for subscribed guild", guild.id, "to subscription", subscription.provider, subscription.uid);
                return;
            }
            settings = this.convertToNormalSettings(dbSettings);
            this.guildSettingsCache.set(guild.id, settings);
        }

        if(!settings.channelId || settings.channelId === "-") { return; }

        let channel = guild.channels.get(settings.channelId);
        if(!channel) {
            this.log("err", "Not found channel for subscribed guild", guild.id, "to subscription", subscription.provider, subscription.uid);
            return;
        }

        let mentionsEveryone = !!settings.mentionsEveryone.find(s => {
            return s.serviceName === providerName && (s.uid === subscription.uid || s.username === subscription.username);
        });

        if((result.updated || result.status === "offline") && (notification && notification.channelId === channel.id)) {
            let msg = await (async () => {
                try {
                    return (await (channel as TextChannel).fetchMessage(notification.messageId));
                } catch(err) {
                    this.log("err", "Could not find message with ID", notification.messageId, "to update", err);
                    return undefined;
                }
            })();

            if(!msg) { return; }

            try {
                await msg.edit(mentionsEveryone ?
                    "@everyone " + localizer.getFormattedString(guildLanguage, result.status === "offline" ? LOCALIZED("NOTIFICATION_EVERYONE_OFFLINE") : LOCALIZED("NOTIFICATION_EVERYONE_UPDATED"), {
                        username: subscription.username
                    })
                    : "", {
                        embed: embed as any
                    });
            } catch(err) {
                this.log("err", "Failed to update message with ID", notification.messageId, err);
            }

            if(result.status === "offline") {
                if(!botConfig.mainShard && process.send) {
                    process.send({
                        type: "streams:flush_offline",
                        payload: {
                            provider: subscription.provider,
                            uid: subscription.uid
                        }
                    });
                } else {
                    service.flushOfflineStream(subscription.uid);
                }
            }

            notification.streamId = result.id;
            notification.sentAt = Date.now();

            await this.updateNotification(notification);
        } else if(result.status !== "offline") {
            let messageId = "";
            try {
                let msg = (await (channel as TextChannel).send(mentionsEveryone ?
                    "@everyone " + localizer.getFormattedString(guildLanguage, "STREAMING_NOTIFICATION_EVERYONE", {
                        username: subscription.username
                    })
                    : "", {
                        embed: embed as any
                    })) as Message;
                messageId = msg.id;
            } catch(err) {
                this.log("err", "Failed to send notification for stream of", `${subscription.uid} (${providerName})`, "to channel", `${channel.id}.`, "Error ocurred", err);
                return;
            }

            if(!notification) {
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
        let map = new Map<string, T>();
        for(let elem of toConvert) {
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

    async getSubscriptionsForService(service: string) {
        return (await this.db(TABLE.subscriptions).select().where({
            provider: service
        })) as ISubscriptionRawRow[];
    }

    async getSubscription(filter: {
        provider: string,
        uid?: string,
        username?: string
    }): Promise<ISubscriptionRawRow | undefined> {
        if(!filter.uid && !filter.username) {
            throw new Error("Nor uid nor username provided");
        }
        return await this.db(TABLE.subscriptions).where(filter).first() as ISubscriptionRawRow;
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

    async getNotification(provider: string, streamerId: string, streamId: string, guild: Guild|string) {
        return await this.db(TABLE.notifications).where({
            provider,
            streamerId,
            streamId,
            guild: guild instanceof Guild ? guild.id : guild
        } as INotification) as INotification;
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

        for(let serviceName of this.servicesList.keys()) {
            await this.servicesLoader.load(serviceName);
        }

        await this.checknNotify();

        if(botConfig.mainShard) {
            this.cleanupInterval = setInterval(() => this.notificationsCleanup(), 86400000);
            await this.notificationsCleanup();
        } else {
            this.log("warn", "Working not in main shard!");
        }


        if(botConfig.mainShard) {
            this.checknNotifyInterval = setInterval(() => this.checknNotify(), 60000);
        } else {
            this.log("warn", "Not going to set notification fetching interval not in lead shard");
        }

        if(!botConfig.mainShard) {
            process.on("message", (msg) => {
                if(typeof msg !== "object") { return; }
                if(!msg.type || !msg.payload) { return; }
                if(msg.type !== "streams:push") { return; }

                this.log("info", "Received message", msg);
                if(msg.payload.ifYouHaveGuild && msg.payload.notifyAbout) {
                    let guild = discordBot.guilds.get(msg.payload.ifYouHaveGuild as string);
                    if(guild) {
                        // process
                        let notifyAbout = msg.payload.notifyAbout as {
                            subscription: ISubscriptionRow,
                            notification: INotification,
                            result: IStreamStatus
                        };
                        this.pushNotification(guild, notifyAbout.result,notifyAbout.subscription, notifyAbout.notification);
                    }
                }
            });
        } else {
            process.on("message", (msg) => {
                if(typeof msg !== "object") { return; }
                if(!msg.type || !msg.payload) { return; }
                if(msg.type !== "streams:flush_offline" && msg.type !== "streams:free") { return; }
                
                this.log("info", "Received message", msg);

                let payload = msg.payload as {
                    provider: string;
                    uid: string;
                };
                
                let mod = this.servicesLoader.loadedModulesRegistry.get(payload.provider);
                if(!mod) { this.log("warn", "Provider not found", payload.provider, "- message ignored"); return; }
                if(!mod.loaded) { this.log("warn", "Provider isn't loaded", payload.provider, "- message ignored"); return; }

                let provider = mod.base as IStreamingService;

                if(msg.type === "streams:flush_offline") {
                    provider.flushOfflineStream(payload.uid);
                } else if(msg.type === "streams:free" && provider.freed) {
                    provider.freed(payload.uid);
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