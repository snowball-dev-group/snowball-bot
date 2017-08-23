import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Guild } from "discord.js";
import { command, Category } from "./utils/help";
import { init, checkPremium, givePremium, deletePremium, isPremium as isPremiumUser } from "./utils/premium";
import { getLogger, EmbedType, escapeDiscordMarkdown, resolveGuildRole } from "./utils/utils";
import { generateLocalizedEmbed, localizeForUser } from "./utils/ez-i18n";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref, removePreference as delGuildPref } from "./utils/guildPrefs";
import { createConfirmationMessage } from "./utils/interactive";
import * as timestring from "timestring";
import * as moment from "moment-timezone";

const PREMIUMCTRL_PREFIX = `!premiumctl`;

let whoCan = [botConfig.botOwner];

function isAdm(msg: Message) {
    return isChat(msg) && whoCan.indexOf(msg.author.id) !== -1;
}

function checkServerAdmin(msg: Message) {
    return isChat(msg) && msg.member && msg.member.hasPermission(["ADMINISTRATOR", "MANAGE_CHANNELS", "MANAGE_GUILD", "MANAGE_ROLES"]);
}

function isChat(msg: Message) {
    return msg.channel.type === "text";
}

interface IPlgCfg {
    whoCanGive: string[];
}

@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} checkout`, "loc:PREMIUMCTL_META_CHECKOUT", {
    "loc:PREMIUMCTL_META_MENTION": {
        optional: true,
        description: "loc:PREMIUMCTL_META_CHECKOUT_ARG0_DESC",
        specialCheck: isAdm
    }
}, isChat)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} give`, "", {
    "loc:PREMIUMCTL_META_MENTION": {
        optional: false,
        description: "loc:PREMIUMCTL_META_GIVE_ARG0_DESC"
    },
    "loc:PREMIUMCTL_META_GIVE_ARG1": {
        optional: false,
        description: "loc:PREMIUMCTL_META_GIVE_ARG1_DESC"
    }
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} renew`, "loc:PREMIUMCTL_META_RENEW", {
    "loc:PREMIUMCTL_META_MENTION": {
        optional: false,
        description: "loc:PREMIUMCTL_META_RENEW_ARG0_DESC"
    },
    "loc:PREMIUMCTL_META_RENEW_ARG1": {
        optional: false,
        description: "loc:PREMIUMCTL_META_RENEW_ARG1_DESC"
    }
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} delete`, "loc:PREMIUMCTL_META_DELETE", {
    "loc:PREMIUMCTL_META_MENTION": {
        optional: false,
        description: "loc:PREMIUMCTL_META_DELETE_ARG0_DESC"
    }
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} role`, "loc:PREMIUMCTL_META_ROLE", {
    "loc:PREMIUMCTL_META_ROLE_ARG0": {
        optional: false,
        description: "loc:PREMIUMCTL_META_ROLE_ARG0_DESC",
        values: ["loc:PREMIUMCTL_META_ROLE_ARG0_VALUES0", "none"]
    }
}, checkServerAdmin)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} resync`, "loc:PREMIUMCTL_META_RESYNC", undefined, isAdm)
class PremiumControl extends Plugin implements IModule {
    log = getLogger("PremiumControl");

    constructor(cfg) {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        }, true);

        if(cfg) {
            (cfg as IPlgCfg).whoCanGive.forEach(w => whoCan.push(w));
        }

        // this.init();
    }

    // ================================
    // MESSAGE HANDLING
    // ================================

    async onMessage(msg: Message) {
        if(msg.channel.type !== "text") { return; }
        if(!msg.content || !msg.content.startsWith(PREMIUMCTRL_PREFIX)) { return; }
        let args = msg.content.split(" ");
        if(args.length === 1 && args[0] === PREMIUMCTRL_PREFIX) {
            return;
        }
        args.shift();
        try {
            switch(args.shift()) {
                // give <#12345678901234>, 1mth
                case "give": return await this.givePremium(msg, args);
                // remove <#12345678901234>
                case "remove": return await this.removePremium(msg);
                // renew <#12345678901234>, 1mth
                case "renew": return await this.renewPremium(msg, args);
                // checkout <#12345678901234>
                case "checkout": return await this.checkoutPremium(msg);
                // resync
                case "resync": return await this.runResync(msg);
                // role
                case "role": return await this.setPremiumRole(msg, args);
            }
        } catch(err) {
            this.log("err", "Error due running command `", msg.content + "`:", err);
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_STARTFAILED")
            });
        }
    }

    // ================================
    // MAIN COMMANDS
    // ================================

    async setPremiumRole(msg: Message, args: string[]) {
        if(!checkServerAdmin(msg)) {
            // NO PERMISSIONS
            return;
        }
        // premiumctl:role
        if(args[0].toLowerCase() !== "none") {
            let role = await resolveGuildRole(args[0], msg.guild, false);
            if(!role) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_NOTFOUND")
                });
                return;
            }

            let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
                key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
                formatOptions: {
                    roleName: escapeDiscordMarkdown(role.name, true)
                }
            });
            let confirmation = await createConfirmationMessage(confirmationEmbed, msg);

            if(!confirmation) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
                });
                return;
            }

            let currentPremiumRole = await getGuildPref(msg.guild, "premiumctl:role");
            if(currentPremiumRole) {
                let premiumRole = msg.guild.roles.get(currentPremiumRole);
                if(premiumRole) {
                    let progMsg = (await msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
                    })) as Message;
                    for(let member of msg.guild.members.values()) {
                        try {
                            await member.removeRole(premiumRole);
                        } catch(err) {
                            this.log("err", `Failed to unassign current premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
                        }
                    }
                    await progMsg.delete();
                }
            }

            await setGuildPref(msg.guild, "premiumctl:role", role.id);

            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_SETROLE_DONE")
            });

            this.performGuildSync(msg.guild);
        } else {
            let currentPremiumRole = await getGuildPref(msg.guild, "premiumctl:role");
            if(!currentPremiumRole) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_SETROLE_ERR_NOTSET")
                });
                return;
            }

            let premiumRole = msg.guild.roles.get(currentPremiumRole);
            if(premiumRole) {
                let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
                    key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
                    formatOptions: {
                        roleName: escapeDiscordMarkdown(premiumRole.name, true)
                    }
                });
                let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
                if(!confirmation) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
                    });
                    return;
                }

                let removingMsg = (await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
                })) as Message;

                for(let member of msg.guild.members.values()) {
                    try {
                        await member.removeRole(premiumRole);
                    } catch(err) {
                        this.log("err", `Failed to unassign premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
                    }
                }

                await removingMsg.delete();
            }

            await delGuildPref(msg.guild, "premiumctl:role");
        }
    }

    async runResync(msg: Message) {
        let _pgMsg = (await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SYNCING")
        })) as Message;
        await this.performGuildsSync();
        _pgMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_SYNC_DONE")
        });
    }

    async givePremium(msg: Message, args: string[], internalCall = false) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_PERMS")
            });
            return;
        }
        // args: ["<#12345678901234>,", "1mth"]
        if(!internalCall) {
            args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
            if(args.length !== 2) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
                        key: "PREMIUMCTL_GIVE_USAGE",
                        formatOptions: {
                            prefix: PREMIUMCTRL_PREFIX
                        }
                    })
                });
                return;
            }
            if(msg.mentions.users.size !== 1) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
                });
                return;
            }
        }

        let subscriber = msg.mentions.users.first();
        let currentPremium = await checkPremium(subscriber);
        if(currentPremium) {
            let dtString = moment(currentPremium.due_to, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
            let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
                key: "PREMIUMCTL_GIVE_CONFIRMATION",
                formatOptions: {
                    untilDate: dtString,
                    prefix: PREMIUMCTRL_PREFIX
                }
            });
            let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
            if(!confirmation) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
                });
                return;
            }
        }

        let cDate = new Date(Date.now() + (timestring(args[1]) * 1000));
        let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
            key: "PREMIUMCTL_GIVE_CONFIRMATION1",
            formatOptions: {
                username: escapeDiscordMarkdown(subscriber.username),
                untilDate: dtString
            }
        });
        let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
        if(!confirmation) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
            });
            return;
        }

        let _cMsg = (await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_PLSWAIT")
        })) as Message;

        let complete = await givePremium(subscriber, cDate, true);

        if(!complete) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_CONSOLE")
            });
            return;
        }

        await _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
        });

        currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_INTERNAL")
            });
            return;
        }

        dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
            subscribedAt: dtSubString
        })) + "\n";
        msgStr += await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
            validUntil: dtString
        });

        await _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
        });
        confirmationEmbed = await generateLocalizedEmbed(EmbedType.Information, msg.member, {
            custom: true,
            string: msgStr
        });
        confirmation = await createConfirmationMessage(confirmationEmbed, msg);
        if(!confirmation) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
            });
            return;
        }
        _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_GIVE_DONE")
        });
    }

    async renewPremium(msg: Message, args: string[]) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
            });
            return;
        }
        // args: ["<#12345678901234>,", "1mth"]
        args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
        if(args.length !== 2) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
                    key: "PREMIUMCTL_RENEW_USAGE",
                    formatOptions: {
                        prefix: PREMIUMCTRL_PREFIX
                    }
                })
            });
            return;
        }
        if(msg.mentions.users.size !== 1) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
            });
            return;
        }

        let subscriber = msg.mentions.users.first();
        let currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            let _redirectMsg = await (msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_GIVE_REDIRECT")
            })) as Message;
            setTimeout(() => _redirectMsg.delete(), 5000);
            await this.givePremium(msg, args, true);
            return;
        }

        let cDate = new Date(currentPremium.due_to.getTime() + (timestring(args[1]) * 1000));
        let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
            key: "PREMIUMCTL_RENEW_CONFIRMATION",
            formatOptions: {
                username: escapeDiscordMarkdown(subscriber.username),
                untilDate: dtString
            }
        });
        let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
        if(!confirmation) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
            });
            return;
        }

        let complete = false;
        try {
            complete = await givePremium(subscriber, cDate, false);
        } catch(err) {
            if((err as Error).name === "ERR_PREMIUM_DIFFLOW") {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_TIMEDIFF0")
                });
            }
            return;
        }

        let _cMsg = (await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_RENEW_PROGRESS_STARTED")
        })) as Message;

        if(!complete) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_CONSOLE")
            });
            return;
        }

        await _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
        });

        currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_UNKNOWN")
            });
            return;
        }

        dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
            subscribedAt: dtSubString
        })) + "\n";
        msgStr += await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
            validUntil: dtString
        });

        await _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
        });
        confirmationEmbed = await generateLocalizedEmbed(EmbedType.Information, msg.member, {
            custom: true,
            string: msgStr
        });
        confirmation = await createConfirmationMessage(confirmationEmbed, msg);
        if(!confirmation) {
            _cMsg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
            });
            return;
        }
        _cMsg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_RENEW_DONE")
        });
    }

    async checkoutPremium(msg: Message) {
        if(isAdm(msg) && msg.mentions.users.size > 1) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_MENTIONS")
            });
            return;
        } else if(!isAdm(msg) && msg.mentions.users.size !== 0) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTADM")
            });
            return;
        }

        let subscriber = msg.mentions.users.size === 0 ? msg.author : msg.mentions.users.first();

        let currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTPREMIUMUSER")
            });
            return;
        }

        let dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let durString = this.humanize(currentPremium.due_to.getTime() - Date.now(), await localizeForUser(msg.member, "+SHORT_CODE"));

        let msgStr = "";
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
            subscribedAt: dtSubString
        })) + "\n";
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
            validUntil: dtString
        })) + "\n";
        msgStr += await localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
            validTime: durString
        });

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
                custom: true,
                string: msgStr
            }, {
                    author: {
                        name: subscriber.tag
                    }
                })
        });
    }

    async removePremium(msg: Message) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
            });
            return;
        }
        if(msg.mentions.users.size !== 1) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_MENTION")
            });
            return;
        }

        let subscriber = msg.mentions.users.first();

        let currentPremium = await checkPremium(subscriber);
        if(!currentPremium) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_NOTPREMIUMUSER")
            });
            return;
        }

        let dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let durString = this.humanize(currentPremium.due_to.getTime() - Date.now(), await localizeForUser(msg.member, "+SHORT_CODE"));

        let sep = "----------------";
        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n${sep}\n`;
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
            subscribedAt: dtSubString
        })) + "\n";
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
            validUntil: dtString
        })) + "\n";
        msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
            validTime: durString
        })) + "\n";
        msgStr += `${sep}\n`;
        msgStr += await localizeForUser(msg.member, "PREMIUMCTL_REMOVE_CONFIRMATION");

        let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
            custom: true,
            string: msgStr
        });
        let confirmation = await createConfirmationMessage(confirmationEmbed, msg);

        if(!confirmation) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
            });
            return;
        }

        try {
            await deletePremium(subscriber);
        } catch(err) {
            if((err as Error).name === "PREMIUM_ALRDYNTSUB") {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_ALREADYUNSUBBED")
                });
            }
            return;
        }

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_REMOVE_DONE")
        });
    }

    // ================================
    // MISC STUFF
    // ================================

    async performGuildSync(guild: Guild, noLog = false) {
        if(!noLog) { this.log("info", `Started role sync on guild "${guild.name}"`); }
        let guildPremiumRole = await getGuildPref(guild, "premiumctl:role");
        if(!guildPremiumRole) {
            if(!noLog) { this.log("warn", "Guild doesn't has premium role"); }
            return {
                done: false,
                err: "noPremiumRole"
            };
        }

        let done = 0;

        for(let member of guild.members.values()) {
            let isPremium = await isPremiumUser(member);
            if(isPremium && !member.roles.has(guildPremiumRole)) {
                try {
                    await member.addRole(guildPremiumRole);
                    done++;
                } catch(err) {
                    this.log("err", `Failed to assign premium role to member "${member.displayName}"...`);
                }
            } else if(!isPremium && member.roles.has(guildPremiumRole)) {
                try {
                    await member.removeRole(guildPremiumRole);
                    done++;
                } catch(err) {
                    this.log("err", `Failed to unassign premium role from member "${member.displayName}"...`);
                }
            } else {
                done++;
            }
        }

        let donePerc = (done / guild.members.size) * 100;
        if(donePerc < 50) {
            if(!noLog) { this.log("warn", "Errors due syncing for more than 50% members of guild"); }
            return {
                done: false,
                err: "moreThan50PercFailed"
            };
        }

        if(!noLog) { this.log("ok", "Sync complete without errors"); }
        return {
            done: true,
            err: undefined
        };
    }

    async performGuildsSync(noLog = false) {
        this.log("info", "Performing role sync in guilds...");
        for(let guild of discordBot.guilds.values()) {
            try {
                await this.performGuildSync(guild, noLog);
            } catch(err) {
                this.log("err", `Role sync failed at guild "${guild.name}"`, err);
            }
        }
    }

    // ================================
    // PLUGIN FUNCTIONS
    // ================================

    humanize(duration: number, language = localizer.sourceLanguage, largest: number = 2, round: boolean = true) {
        return localizer.humanizeDuration(language, duration, undefined, { largest, round });
    }

    roleSyncInterval: NodeJS.Timer;

    async init() {
        let subpluginInit = await init();
        if(!subpluginInit) {
            this.log("err", "Subplugin initalization failed");
            return;
        }
        this.roleSyncInterval = setInterval(() => this.performGuildsSync(true), 3600000);
        await this.performGuildsSync();
        this.handleEvents();
    }

    async unload() {
        clearInterval(this.roleSyncInterval);
        this.unhandleEvents();
        return true;
    }
}

module.exports = PremiumControl;