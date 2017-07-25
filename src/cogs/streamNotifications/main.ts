import { IModule, ModuleLoader, convertToModulesMap, IModuleInfo } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember } from "discord.js";
import { getLogger } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import { simpleCmdParse } from "../utils/text";
import { generateLocalizedEmbed, getGuildLanguage } from "../utils/ez-i18n";
import { EmbedType, sleep, IEmbedOptionsField } from "../utils/utils";
import { IStreamingService, IStreamingServiceStreamer, StreamingServiceError } from "./baseService";
import { createConfirmationMessage } from "../utils/interactive";
import { command, Category as CommandCategory } from "../utils/help";

const PREFIX = "!streams";
const MAX_NOTIFIED_LIFE = 86400000; // ms

const TABLE = {
    subscriptions: "sn_subs",
    settings: "sn_settings"
};

interface ISubscriptionRawRow {
    provider:string;
    uid:string;
    username:string;
    subscribers:string;
    notified:string;
}

interface ISettingsRow {
    guild:string;
    channelId:string|"-"|null;
    /**
     * JSON with Array<IStreamingServiceStreamer>
     */
    mentionsEveryone:string;
    subscribedTo:string;
}

interface ISettingsParsedRow {
    channelId:string|null;
    guild:string;
    mentionsEveryone:IStreamingServiceStreamer[];
    subscribedTo:IStreamingServiceStreamer[];
}

interface ISubscriptionRow {
    /**
     * Provider if talking about module that fetches it, otherwise streaming service name
     */
    provider:string;
    /**
     * UID of the streamer
     */
    uid:string;
    /**
     * Username of the streamer
     */
    username:string;
    /**
     * Array of Guild IDs that subscribed to this channel
     */
    subscribers: string[];
    /**
     * Array of NotificationStatus'es
     */
    notified:INotificationStatus[];
}

interface INotificationStatus {
    /**
     * ID of the stream
     */
    id:string;
    /**
     * Date when notification arrived (only use to cleanup)
     */
    notifiedAt:number;
    /**
     * Notified guilds IDs
     */
    notifiedGuilds:string[];
}

const LOCALIZED = (str:string) => `STREAMING_${str.toUpperCase()}`;

function rightsCheck(member:GuildMember) {
    return member.hasPermission(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.hasPermission(["ADMINISTRATOR"]) || member.id === botConfig.botOwner;
}

function helpCheck(msg:Message) {
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
    servicesList:Map<string, IModuleInfo>;

    constructor(options) {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        }, true);

        this.servicesList = new Map<string, IModuleInfo>(convertToModulesMap(options));

        this.servicesLoader = new ModuleLoader({
            name: "StreamNotifications:Services",
            basePath: "./cogs/streamNotifications/services/",
            registry: this.servicesList,
            fastLoad: []
        });
    }

    // =======================================
    //  Message handling
    // =======================================

    async onMessage(msg:Message) {
        if(!msg.content.startsWith(PREFIX)) { return; }
        let cmd = simpleCmdParse(msg.content);
        try {
            switch(cmd.subCommand) {
                case "edit": await this.edit(msg, cmd.args); break;
                case "add": await this.add(msg, cmd.args); break;
                case "remove": await this.remove(msg, cmd.args); break;
                case "set_channel": await this.setChannel(msg, cmd.args); break;
                default: await this.list(msg, cmd.subCommand, cmd.args); break;
            }
        } catch (err) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, LOCALIZED("CMD_ERROR"))
            });
            this.log("err", `Error starting command "${msg.content}"`, err);
        }
    }


    // =======================================
    // Command handling
    // =======================================

    async setChannel(msg:Message, args:string[]|undefined) {
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

    async edit(msg:Message, args:string[]|undefined) {
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

    async add(msg:Message, args:string[]|undefined) {
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

        let streamer:IStreamingServiceStreamer|undefined = undefined;
        if(!subscription) {
            try {
                streamer = await provider.getStreamer(args[1]);
            } catch (err) {
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
                notified: "[]",
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
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("CANCELED"))
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

    async remove(msg:Message, args:string[]|undefined) {
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
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, LOCALIZED("REMOVE_CANCELED"))
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
                // well, provider isn't loaded
                let provider = providerModule.base as IStreamingService;
                if(provider.freed) { provider.freed(rawSubscription.uid); }
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

    async list(msg:Message, calledAs:string|undefined, args:string[]|undefined) {
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

        let offset = (10 * page) - 10;
        let end = offset + 10;

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

        let fields:IEmbedOptionsField[] = [];
        let c = 1;
        for(let result of results) {
            fields.push({
                inline: false,
                name: `${c++}. ${result.username}`,
                value: `${result.serviceName}, ID: \`${result.uid}\``
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

    cleanupPromise:undefined|Promise<void> = undefined;

    cleanupInterval:NodeJS.Timer;

    async notificationsCleanup() {
        let subscriptions = await this.getAllSubscriptions();
        let resolveFunction:undefined|Function = undefined;
        this.cleanupPromise = new Promise((r) => {
            resolveFunction = r;
        });
        await sleep(100);
        for(let rawSubscription of subscriptions) {
            let subscription = this.convertToNormalSubscription(rawSubscription);
            let toRemove:INotificationStatus[] = [];
            for(let notifiedStatus of subscription.notified) {
                if((Date.now() - notifiedStatus.notifiedAt) > MAX_NOTIFIED_LIFE) {
                    toRemove.push(notifiedStatus);
                }
            }
            for(let notifiedStatusToRemove of toRemove) {
                let index = subscription.notified.indexOf(notifiedStatusToRemove);
                subscription.notified.splice(index, 1);
            }
            rawSubscription = this.convertToRawSubscription(subscription);
            await this.updateSubscription(rawSubscription);
        }
        if(resolveFunction) {
            resolveFunction();
            this.cleanupPromise = undefined;
        }
    }

    guildSettingsCache = new Map<string, ISettingsParsedRow>();

    checknNotifyInterval:NodeJS.Timer;

    async checknNotify() {
        // 1) for (all providers)
        //   1.1) get all subscriptions for provider (WHERE provider=twitch)
        //   1.2) for (all subscriptions)
        //     1.2.1) provider#fetch(subscription)
        //     1.2.2) check who not notified => Array:notNotified
        //     1.2.3) generateEmbed(stream) ->
        //       1.2.3.1) notify(notNotified) ->
        //         1.2.3.1.1) put into notified array

        if(this.cleanupPromise) {
            await this.cleanupPromise;
        }

        for(let [providerName, mod] of this.servicesLoader.loadedModulesRegistry) {
            if(!mod.base) { continue; }
            let service = mod.base as IStreamingService;
            let subscriptions = (await this.getSubscriptionsForService(providerName)).map(this.convertToNormalSubscription);
            let toFetch = subscriptions.map(this.convertToStreamer);
            let results = await service.fetch(toFetch);
            for(let result of results) {
                if(result.status === "offline") { continue; }
                let streamerSubscriptions = subscriptions.filter(sub => {
                    return sub.uid === result.streamer.uid;
                });

                for(let subscription of streamerSubscriptions) {
                    for(let subscribedGuild of subscription.subscribers) {
                        let isNotified = subscription.notified.find((ns) => {
                            return ns.id === result.id;
                        });
                        if(isNotified && isNotified.notifiedGuilds.includes(subscribedGuild)) { continue; }

                        let guild = discordBot.guilds.get(subscribedGuild);
                        if(!guild) { continue; }
                        let embed = await service.getEmbed(result, await getGuildLanguage(guild));

                        let settings = this.guildSettingsCache.get(guild.id);
                        if(!settings) {
                            let dbSettings = await this.getSettings(guild);
                            if(!dbSettings) { continue; }
                            settings = this.convertToNormalSettings(dbSettings);
                            this.guildSettingsCache.set(guild.id, settings);
                        }

                        if(!settings.channelId || settings.channelId === "-") { continue; }

                        let channel = guild.channels.get(settings.channelId);
                        if(!channel) { continue; }

                        let mentionsEveryone = !!settings.mentionsEveryone.find(s => {
                            return s.serviceName === providerName && (s.uid === result.streamer.uid || s.username === result.streamer.username);
                        });

                        await (channel as TextChannel).send(mentionsEveryone ? "@everyone" : "", {
                            embed: embed as any
                        });

                        if(isNotified) {
                            isNotified.notifiedGuilds.push(subscribedGuild);
                        } else {
                            subscription.notified.push({
                                id: result.id,
                                notifiedAt: Date.now(),
                                notifiedGuilds: [subscribedGuild]
                            });
                        }
                    }
                }
            }
            let rSubscriptions = subscriptions.map(this.convertToRawSubscription);
            for(let rSubscription of rSubscriptions) {
                await this.updateSubscription(rSubscription);
            }
        }
    }

    // =======================================
    // Additional bridge functions
    // =======================================

    async createOrGetSettings(guild:Guild) {
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

    convertToNormalSettings(raw:ISettingsRow) : ISettingsParsedRow {
        return {
            channelId: raw.channelId,
            guild: raw.guild,
            mentionsEveryone: JSON.parse(raw.mentionsEveryone),
            subscribedTo: JSON.parse(raw.subscribedTo)
        };
    }

    convertToRawSettings(normal:ISettingsParsedRow) : ISettingsRow {
        return {
            channelId: normal.channelId,
            guild: normal.guild,
            mentionsEveryone: JSON.stringify(normal.mentionsEveryone),
            subscribedTo: JSON.stringify(normal.subscribedTo)
        };
    }

    convertToMap<T>(toConvert:T[], key:string) : Map<string, T> {
        let map = new Map<string, T>();
        for(let elem of toConvert) {
            map.set(elem[key], elem);
        }
        return map;
    }

    convertToNormalSubscription(raw:ISubscriptionRawRow) : ISubscriptionRow {
        return {
            username: raw.username,
            uid: raw.uid,
            notified: JSON.parse(raw.notified),
            provider: raw.provider,
            subscribers: JSON.parse(raw.subscribers)
        };
    }

    convertToRawSubscription(normal:ISubscriptionRow) : ISubscriptionRawRow  {
        return {
            username: normal.username,
            uid: normal.uid,
            notified: JSON.stringify(normal.notified),
            provider: normal.provider,
            subscribers: JSON.stringify(normal.subscribers)
        };
    }

    convertToStreamer(subscription:ISubscriptionRow) : IStreamingServiceStreamer {
        return {
            serviceName: subscription.provider,
            uid: subscription.uid,
            username: subscription.username
        };
    }

    // =======================================
    // DB<>Plugin methods
    // =======================================

    async getAllSubscriptions() {
        return (await this.db(TABLE.subscriptions).select().all()) as ISubscriptionRawRow[];
    }

    async getSubscriptionsForService(service:string) {
        return (await this.db(TABLE.subscriptions).select().where({
            provider: service
        })) as ISubscriptionRawRow[];
    }

    async getSubscription(filter:{
        provider:string,
        uid?:string,
        username?:string
    }) : Promise<ISubscriptionRawRow|undefined> {
        if(!filter.uid && !filter.username) {
            throw new Error("Nor uid nor username provided");
        }
        return await this.db(TABLE.subscriptions).where(filter).first() as ISubscriptionRawRow;
    }

    async createSubscription(row:ISubscriptionRawRow) {
        row.notified = "[]";
        await this.db(TABLE.subscriptions).insert(row);
        return row;
    }

    async updateSubscription(newSubscription:ISubscriptionRawRow) {
        return await this.db(TABLE.subscriptions).where({
            provider: newSubscription.provider,
            uid: newSubscription.uid,
            username: newSubscription.username
        }).update(newSubscription);
    }

    async removeSubscription(subscription:ISubscriptionRawRow) {
        return await this.db(TABLE.subscriptions).where({
            provider: subscription.provider,
            uid: subscription.uid,
            username: subscription.username
        }).delete();
    }

    async getSettings(guild:Guild) : Promise<ISettingsRow|undefined> {
        return await this.db(TABLE.settings).where({
            guild: guild.id
        }).first() as ISettingsRow;
    }

    async createSettings(row:ISettingsRow) {
        await this.db(TABLE.settings).insert(row);
        return row;
    }

    async updateSettings(newSettings:ISettingsRow) {
        return this.db(TABLE.settings).where({
            guild: newSettings.guild
        }).update(newSettings);
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
                },
                notified: { // [{ "id": "ZgCOA8_A9iI", "notifiedAt": 1500287047927, "notifiedGuilds": ["307494339662184449"] }]
                    type: "MEDIUMTEXT"
                }
            });
        }

        let settingsTable = await this.db.schema.hasTable(TABLE.settings);
        if(!settingsTable) {
            this.log("info", "Table of settings not found, going to create it right now");
            await createTableBySchema(TABLE.settings, {
                guild: "string",
                channelId: "string",
                mentionsEveryone: {
                    type: "TEXT"
                },
                subscribedTo: {
                    type: "TEXT"
                }
            });
        }

        for(let serviceName of this.servicesList.keys()) {
            await this.servicesLoader.load(serviceName);
        }

        await this.checknNotify();

        this.cleanupInterval = setInterval(() => this.notificationsCleanup(), 86400000);
        this.checknNotifyInterval = setInterval(() => this.checknNotify(), 60000);

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