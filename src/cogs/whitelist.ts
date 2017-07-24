import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Guild, TextChannel, GuildMember } from "discord.js";
import { command, Category } from "./utils/help";
import { localizeForUser, generateLocalizedEmbed } from "./utils/ez-i18n";
import { simpleCmdParse, canBeSnowflake } from "./utils/text";
import { EmbedType, getLogger, escapeDiscordMarkdown } from "./utils/utils";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref, removePreference as delGuildPref } from "./utils/guildPrefs";
import * as parseTime from "timestring";
import * as moment from "moment-timezone";
import { createConfirmationMessage } from "./utils/interactive";

const POSSIBLE_CHAT_ROOMS = ["admins", "admin-channel", "admin_channel", "admins-chat", "admins_chat", "admin", "mod-channel", "mods-channel", "mods", "mods-chat", "mod_chat", "chat", "general"];

enum GUILD_STATE {
    /**
     * Guild is listed in plugin options and cannot be left by bot itself
     */
    IMMORTAL,
    /**
     * Guild is listed in options and cannot be left by bot iteself
     */
    UNLIMITED,
    /**
     * Guild has limited time that can expire, then bot should leave guild
     */
    LIMITED,
    /**
     * Guild has limited time (trial) that can expire, then bot should leave guild
     */
    TRIAL,
    /**
     * Guild had limited time (trial) that expired, so bot should leave guild
     */
    TRIAL_EXPIRED,
    /**
     * Guild had limited time that expired, so bot should leave guild
     */
    EXPIRED,
    /**
     * Guild is banned to join, bot should leave this guild immediately without any warnings
     */
    BANNED,
    /**
     * Guild has unknown status, so bot deciding to leave or stay on guild
     */
    UNKNOWN
};

function isBotAdmin(msg:Message) {
    return msg.author.id === botConfig.botOwner;
}

function isServerAdmin(msg:Message) {
    return msg.channel.type === "text" && (msg.member.hasPermission(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS"]) || msg.author.id === botConfig.botOwner);
}

@command(Category.Helpful, "sb_pstatus", "loc:WHITELIST_META_PSTATUS", undefined, isServerAdmin)
@command(Category.Helpful, "whitelist", "loc:WHITELIST_META_WHITELIST", {
    "loc:WHITELIST_META_WHITELIST_ARG0": {
        optional: false,
        description: "loc:WHITELIST_META_WHITELIST_ARG0_DESC",
        values: ["ban", "activate", "deactivate"]
    },
    "loc:WHITELIST_META_WHITELIST_ARG1": {
        optional: false,
        description: "loc:WHITELIST_META_WHITELIST_ARG1_DESC"
    }
}, isBotAdmin)
class Whitelist extends Plugin implements IModule {
    log = getLogger("Whitelist");
    alwaysWhitelisted:string[] = [];

    constructor(options) {
        super({
            "message": (msg:Message) => this.onMessage(msg),
            "guildCreate": (guild:Guild) => this.joinedGuild(guild)
        });
        if(options) {
            if(options["always_whitelisted"] && options["always_whitelisted"] instanceof Array) {
                for(let g of (options["always_whitelisted"] as string[])) {
                    this.alwaysWhitelisted.push(g);
                }
            }
        }
    }

    async joinedGuild(guild:Guild) {
        this.log("info", `Joined guild "${guild.name}" (${guild.members.size} members)`);
        let whitelistStatus = await this.isWhitelisted(guild);
        if(whitelistStatus.state === GUILD_STATE.UNKNOWN) {
            // how about to give guild limited time?
            await this.tryToGiveTrial(guild);
        } else if(whitelistStatus.state === GUILD_STATE.TRIAL_EXPIRED) {
            this.leaveGuild(guild, "WHITELIST_LEAVE_TRIALEXPIRED1");
        } else if(whitelistStatus.state === GUILD_STATE.EXPIRED) {
            this.leaveGuild(guild, "WHITELIST_LEAVE_EXPIRED1");
        } else if(whitelistStatus.state === GUILD_STATE.BANNED) {
            this.leaveGuild(guild);
        }
    }

    async isWhitelisted(guild:Guild) : Promise<{
        ok:boolean,
        state:GUILD_STATE,
        until:null|number;
    }> {
        if(this.alwaysWhitelisted.includes(guild.id)) {
            return {
                ok: true,
                state: GUILD_STATE.IMMORTAL,
                until: null
            };
        }
        let whitelistStatus = await getGuildPref(guild, "whitelist:status", true) as GUILD_STATE;
        let whitelistedUntil = await getGuildPref(guild, "whitelist:until", true) as number|null;
        if(!whitelistStatus) {
            return {
                ok: false,
                state: GUILD_STATE.UNKNOWN,
                until: null
            };
        }
        if(whitelistStatus === GUILD_STATE.UNLIMITED) {
            return {
                ok: true,
                state: GUILD_STATE.UNLIMITED,
                until: null
            };
        } else if(whitelistStatus === GUILD_STATE.BANNED) {
            return {
                ok: false,
                state: GUILD_STATE.BANNED,
                until: null
            };
        }
        if(whitelistedUntil && whitelistedUntil < Date.now()) {
            return {
                ok: false,
                state: whitelistStatus === GUILD_STATE.TRIAL ? GUILD_STATE.TRIAL_EXPIRED : GUILD_STATE.EXPIRED,
                until: whitelistedUntil
            };
        }
        return {
            ok: true,
            state: whitelistStatus,
            until: whitelistedUntil
        };
    }

    checkInterval:NodeJS.Timer;

    async init() {
        this.checkInterval = setInterval(() => this.checkGuilds(), 1800000);
        await this.checkGuilds();
    }

    async checkGuilds() {
        for(let g of discordBot.guilds.values()) {
            let whitelistStatus = await this.isWhitelisted(g);
            if(whitelistStatus.state === GUILD_STATE.EXPIRED) {
                await this.leaveGuild(g, "WHITELIST_LEAVE_EXPIRED");
            } else if(whitelistStatus.state === GUILD_STATE.TRIAL_EXPIRED) {
                await this.leaveGuild(g, "WHITELIST_LEAVE_TRIALEXPIRED");
            } else if(whitelistStatus.state === GUILD_STATE.BANNED) {
                await this.leaveGuild(g);
            } else if(whitelistStatus.state === GUILD_STATE.UNKNOWN) {
                await this.tryToGiveTrial(g);
            }
        }
    }

    calculateBotsPercentage(guild:Guild) {
        let bots = 0;
        
        for (let member of guild.members.values()) {
            if(member.user.bot) { bots++; }
        }

        return (bots / guild.members.size) * 100;
    }

    async tryToGiveTrial(guild:Guild) {
        let botPerc = this.calculateBotsPercentage(guild);
        if(botPerc > 70) {
            await this.leaveGuild(guild, "WHITELIST_LEAVE_BOTFARM");
            return;
        }
        if(guild.members.size < 20) {
            await this.leaveGuild(guild, "WHITELIST_LEAVE_NOMEMBERS");
            return;
        }
        if(guild.members.size > 1000) {
            await this.leaveGuild(guild, "WHITELIST_LEAVE_MANYMEMBERS");
            return;
        }
        await setGuildPref(guild, "whitelist:status", GUILD_STATE.TRIAL);
        let endDate = Date.now() + 86400000;
        await setGuildPref(guild, "whitelist:until", endDate);
        this.log("info", `Activated trial on guild "${guild.name}"`);
    }

    async sendMsg(guild:Guild, embed) {
        let chToSendMessage:TextChannel|undefined = undefined;
        
        for(let toCheck of POSSIBLE_CHAT_ROOMS) {
            chToSendMessage = (guild.channels.find((ch) => {
                return ch.name.includes(toCheck) && ch.type === "text";
            })) as TextChannel;
            if(chToSendMessage) { break; }
        }

        if(chToSendMessage) {
            try {
                await chToSendMessage.send("", { embed });
            } catch (err) {
                this.log("warn", `Failed to send message to channel ${chToSendMessage.name} (${chToSendMessage.id})`);
            }
        }
    }

    async leaveGuild(guild:Guild, reason?:string) {
        if(reason) {
            await this.sendMsg(guild, await generateLocalizedEmbed(EmbedType.Warning, guild.owner, {
                key: reason,
                formatOptions: {
                    serverName: escapeDiscordMarkdown(guild.name, true)
                }
            }));
        }

        await guild.leave();
        this.log("ok", `Left guild "${guild.name}"`);
    }

    isAdmin(m:GuildMember) {
        return m.hasPermission(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS"]) || m.id === botConfig.botOwner;
    }

    async onMessage(msg:Message) {
        if(msg.content === "!sb_pstatus" && this.isAdmin(msg.member)) {
            let whitelistInfo = await this.isWhitelisted(msg.guild);
            let str = "#" + (await localizeForUser(msg.member, "WHITELIST_INFO_HEADER", {
                guildName: escapeDiscordMarkdown(msg.guild.name, true)
            })) + "\n";
            str += (await localizeForUser(msg.member, "WHITELIST_INFO_STATUS")) + " ";
            switch(whitelistInfo.state) {
                case GUILD_STATE.BANNED: {
                    str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_BANNED");
                } break;
                case GUILD_STATE.IMMORTAL: {
                    str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_IMMORTAL");
                } break;
                case GUILD_STATE.LIMITED: {
                    str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_LIMITED");
                } break;
                case GUILD_STATE.TRIAL: {
                    str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_TRIAL");
                } break;
            }
            if(whitelistInfo.state === GUILD_STATE.LIMITED || whitelistInfo.state === GUILD_STATE.TRIAL) {
                str += "\n";
                let endString = moment(whitelistInfo.state, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
                str += await localizeForUser(msg.member, "WHITELIST_INFO_UNTIL", {
                    endDate: endString
                });
            }
            await msg.channel.send(str, {
                code: "md"
            });
            return;
        }

        if(msg.author.id !== botConfig.botOwner) { return; }

        let cmd = simpleCmdParse(msg.content);

        if(cmd.command !== "!whitelist") { return; }

        let u = msg.member || msg.author;

        if(cmd.subCommand === "activate") {
            if(cmd.args && cmd.args.length === 2) {
                if(!canBeSnowflake(cmd.args[0])) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
                    });
                    return;
                }
                if(cmd.args[1] === "forever") {
                    let confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
                        key: "WHITELIST_ACTIVATE_CONFIRM_FOREVER",
                        formatOptions: {
                            serverId: cmd.args[0]
                        }
                    }), msg);
                    if(!confirmation) {
                        msg.channel.send("", {
                            embed: await generateLocalizedEmbed(EmbedType.OK, u,  "WHITELIST_CANCELED")
                        });
                        return;
                    }
                    await setGuildPref(cmd.args[0], "whitelist:status", GUILD_STATE.UNLIMITED);
                } else {
                    let time = parseTime(cmd.args[1], "ms");
                    let endTime = new Date(Date.now() + time);

                    let endString = moment(endTime, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

                    let confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
                        key: "WHITELIST_ACTIVATE_CONFIRM_LIMITED",
                        formatOptions: {
                            timeString: endString,
                            serverId: cmd.args[0]
                        }
                    }), msg);

                    if(!confirmation) {
                        msg.channel.send("", {
                            embed: await generateLocalizedEmbed(EmbedType.OK, u,  "WHITELIST_CANCELED")
                        });
                        return;
                    }

                    await setGuildPref(cmd.args[0], "whitelist:until", endTime);
                    await setGuildPref(cmd.args[0], "whitelist:status", GUILD_STATE.LIMITED);
                }

                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.OK, u, {
                        key: "WHITELIST_ACTIVATED",
                        formatOptions: {
                            serverId: cmd.args[0]
                        }
                    })
                });
            } else {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_USAGE")
                });
            }
        } else if(cmd.subCommand === "deactivate") {
            if(cmd.args && cmd.args.length === 1) {
                if(!canBeSnowflake(cmd.args[0])) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
                    });
                    return;
                }

                let confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
                    key: "WHITELIST_DEACTIVATE_CONFIRM",
                    formatOptions: {
                        serverId: cmd.args[0]
                    }
                }), msg);

                if(!confirmation) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, u,  "WHITELIST_CANCELED")
                    });
                    return;
                }

                await delGuildPref(cmd.args[0], "whitelist:until");
                await delGuildPref(cmd.args[0], "whitelist:status");

                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.OK, u, {
                        key: "WHITELIST_DEACTIVATED",
                        formatOptions: {
                            serverId: cmd.args[0]
                        }
                    })
                });
            } else {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_DEACTIVATE_USAGE")
                });
            }
        } else if(cmd.subCommand === "ban") {
            if(cmd.args && cmd.args.length === 1) {
                if(!canBeSnowflake(cmd.args[0])) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
                    });
                    return;
                }

                let confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
                    key: "WHITELIST_BAN_CONFIRM",
                    formatOptions: {
                        serverId: cmd.args[0]
                    }
                }), msg);

                if(!confirmation) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, u,  "WHITELIST_CANCELED")
                    });
                    return;
                }

                await delGuildPref(cmd.args[0], "whitelist:until");
                await setGuildPref(cmd.args[0], "whitelist:status", GUILD_STATE.BANNED);

                let currentGuild = discordBot.guilds.get(cmd.args[0]);
                if(currentGuild) {
                    await currentGuild.leave();
                }

                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.OK, u, {
                        key: "WHITELIST_BANNED",
                        formatOptions: {
                            serverId: cmd.args[0]
                        }
                    })
                });
            } else {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_BAN_USAGE")
                });
            }
        }
    }

    async unload() {
        if(this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        this.unhandleEvents();
        return true;
    }
}

module.exports = Whitelist;