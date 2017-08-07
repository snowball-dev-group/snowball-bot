import { IModule } from "./../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Guild, GuildMember, Role, TextChannel, DMChannel } from "discord.js";
import { getLogger, EmbedType, IEmbedOptionsField, resolveGuildRole, escapeDiscordMarkdown } from "./utils/utils";
import { getDB, createTableBySchema } from "./utils/db";
import { default as fetch } from "node-fetch";
import { createConfirmationMessage, waitForMessages } from "./utils/interactive";
import * as ua from "universal-analytics";
import { parse as parseURI } from "url";
import { replaceAll } from "./utils/text";
import { Category, command } from "./utils/help";
import { localizeForUser, generateLocalizedEmbed } from "./utils/ez-i18n";

const TABLE_NAME = "guilds";

const TABLE_SCHEMA = {
    // unique guild id
    "gid": "string",
    // discord guild snowflake
    "guildId": "string",
    // guild role id
    "roleId": "string",
    // owner discord id
    "ownerId": "string",
    // guild name
    "name": "string",
    // description
    "description": "string",
    // guild styles
    "customize": {
        type: "TEXT"
    }
};

const BANNED_HOSTS = ["goo.gl", "grabify.link"];

function isHostBanned(host:string) {
    if(host.startsWith("www.")) {
        host = host.slice("www.".length);
    }
    return BANNED_HOSTS.includes(host);
}

interface IGuildRow {
    /**
     * Discord Guild SNOWFLAKE
     */
    guildId:string;
    /**
     * Discord Role SNOWFLAKE
     */
    roleId:string;
    /**
     * Name of Guild
     */
    name:string;
    /**
     * Description of guild
     */
    description:string;
    /**
     * Customize JSON
     */
    customize:string|any;
    /**
     * Unique Guild ID
     */
    gid:string;
    /**
     * Owner ID
     */
    ownerId:string;
}

interface IGuildCustomize {
    /**
     * Guild admins who can control it
     */
    admins:string[];
    /**
     * Is this guild private?
     */
    invite_only?:boolean;
    /**
     * Google Analystic key
    */
    ua?:string;
    /**
     * Welcome message
     */
    welcome_msg?:string;
    /**
     * Channel for welcome message
     */
    welcome_msg_channel?:string;
    /**
     * Guild invites
     * (for private guilds)
     */
    invites?:string[];
    /**
     * Big image in information block
     */
    image_url?:string;
    /**
     * Icon URL
     */
    icon_url?:string;
    /**
     * Guild rules
     */
    rules?:string;
}

const BASE_PREFIX = "!guilds";
const CMD_GUILDS_LIST = `${BASE_PREFIX} list`;
const CMD_GUILDS_CREATE = `${BASE_PREFIX} create`;
const CMD_GUILDS_EDIT = `${BASE_PREFIX} edit`;
const CMD_GUILDS_DELETE = `${BASE_PREFIX} delete`;
const CMD_GUILDS_INFO = `${BASE_PREFIX} info`;
const CMD_GUILDS_INVITE = `${BASE_PREFIX} invite`;
const CMD_GUILDS_MEMBERS = `${BASE_PREFIX} members`;
const DEFAULT_ROLE_PREFIX = `!`;

function rightsCheck(member:GuildMember, row?:IGuildRow, noAdmins = false) {
    let checkA = member.hasPermission(["MANAGE_CHANNELS", "MANAGE_ROLES_OR_PERMISSIONS"], undefined, false, true);
    let checkB = false;
    if(row) {
        let cz = JSON.parse(row.customize) as IGuildCustomize;
        checkB = row.ownerId === member.id || member.id === botConfig.botOwner;
        if(!noAdmins) {
            checkB = checkB || (cz.admins && cz.admins.includes(member.id));
        }
    }
    return checkA || checkB;
}

function helpCheck(msg:Message) {
    return msg.channel.type === "text" && rightsCheck(msg.member);
}

function defHelpCheck(msg:Message) {
    return msg.channel.type === "text";
}

@command(Category.Guilds, BASE_PREFIX.slice(1), "loc:GUILDS_META_JOINLEAVE", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: false,
        description: "loc:GUILDS_META_JOINLEAVE_ARG0_DESC"
    }
}, defHelpCheck)
@command(Category.Guilds, CMD_GUILDS_CREATE.slice(1), "создать новую гильдию", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: false,
        description: "loc:GUILDS_META_CREATE_ARG0_DESC"
    },
    "loc:GUILDS_META_CREATE_ARG1": {
        optional: true,
        description: "loc:GUILDS_META_CREATE_ARG1_DESC"
    }
}, helpCheck)
@command(Category.Guilds, CMD_GUILDS_EDIT.slice(1), "loc:GUILDS_META_EDIT", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: false,
        description: "loc:GUILDS_META_EDIT_ARG0_DESC"
    },
    "loc:GUILDS_META_EDIT_ARG1": {
        optional: false,
        description: "loc:GUILDS_META_EDIT_ARG1_DESC"
    },
    "loc:GUILDS_META_EDIT_ARG2": {
        optional: false,
        description: "loc:GUILDS_META_EDIT_ARG2_DESC"
    }
}, helpCheck)
@command(Category.Guilds, CMD_GUILDS_INVITE.slice(1), "loc:GUILDS_META_INVITE", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: false,
        description: "loc:GUILDS_META_INVITE_ARG0_DESC"
    },
    "loc:GUILDS_META_INVITE_ARG1": {
        optional: true,
        description: "loc:GUILDS_META_INVITE_ARG1_DESC"
    },
    "loc:GUILDS_META_INVITE_ARG2": {
        optional: false,
        description: "loc:GUILDS_META_INVITE_ARG2_DESC"
    }
})
@command(Category.Guilds, CMD_GUILDS_DELETE.slice(1), "loc:GUILDS_META_DELETE", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: false,
        description: "loc:GUILDS_META_DELETE_ARG0_DESC"
    }
}, helpCheck)
@command(Category.Guilds, CMD_GUILDS_LIST.slice(1), "loc:GUILDS_META_LIST", {
    "loc:GUILDS_META_LIST_ARG0": {
        optional: true,
        description: "loc:GUILDS_META_LIST_ARG0_DESC"
    }
}, defHelpCheck)
@command(Category.Guilds, CMD_GUILDS_INFO.slice(1), "loc:GUILDS_META_INFO", {
    "loc:GUILDS_META_GUILDNAME": {
        optional: true,
        description: "loc:GUILDS_META_INFO_ARG0_DESC"
    }
}, defHelpCheck)
class Guilds extends Plugin implements IModule {
    log = getLogger("Guilds");
    db = getDB();

    constructor() {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        }, true);

        // this.init();
    }

    // ==============================
    // Messages handling
    // ==============================

    async onMessage(msg:Message) {
        if(msg.channel.type !== "text") {
            return;
        }
        try {
            if(msg.content === BASE_PREFIX) {
                await this.sendHelp(msg.channel as TextChannel, undefined, msg.member);
            } else if(msg.content.startsWith(BASE_PREFIX)) {
                if(this.startsOrEqual(msg.content, CMD_GUILDS_LIST)) {
                    await this.getGuildsList(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_CREATE)) {
                    await this.createGuild(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_EDIT)) {
                    await this.editGuild(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_DELETE)) {
                    await this.deleteGuild(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_INFO)) {
                    await this.getGuildInfo(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_INVITE)) {
                    await this.inviteToGuild(msg);
                } else if(this.startsOrEqual(msg.content, CMD_GUILDS_MEMBERS)) {
                    await this.membersControl(msg);
                } else {
                    await this.joinLeaveGuild(msg);
                }
            }
        } catch (err) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_RUNNINGFAILED")
            });
            this.log("err", "Error at running cmd", msg.content, "\n", err);
        }
    }

    startsOrEqual(str:string, to:string) {
        return str === to || str.startsWith(to);
    }

    // ==============================
    // Handlers
    // ==============================

    async sendHelp(channel:TextChannel, article:string = "guilds", member:GuildMember) {
        let str = "";
        switch(article) {
            case "guilds": {
                str = await localizeForUser(member, "GUILDS_ARTICLE_GENERAL", {
                    prefix: BASE_PREFIX
                });
            } break;
            case CMD_GUILDS_CREATE: {
                str = await localizeForUser(member, "GUILDS_ARTICLE_CREATE", {
                    prefix: CMD_GUILDS_CREATE
                });
            } break;
            case CMD_GUILDS_EDIT: {
                str = await localizeForUser(member, "GUILDS_ARTICLE_EDIT", {
                    prefix: CMD_GUILDS_EDIT
                });
            } break;
            case CMD_GUILDS_INFO: {
                str = await localizeForUser(member, "GUILDS_ARTICLE_INFO", {
                    prefix: CMD_GUILDS_INFO
                });
            } break;
            case CMD_GUILDS_LIST: {
                str = await localizeForUser(member, "GUILDS_ARTICLE_LIST", {
                    prefix: CMD_GUILDS_LIST
                });
            } break;
            case CMD_GUILDS_DELETE: {
                str = await localizeForUser(member, "GUILDS_ARTICLE_DELETE", {
                    prefix: CMD_GUILDS_DELETE
                });
            } break;
        }
        return await channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Information, member, {
                custom: true,
                string: str
            })
        });
    }

    async createGuild(msg:Message) {
        // !guilds create Overwatch, !Overwatch
        if(msg.content === CMD_GUILDS_CREATE) {
            this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_CREATE, msg.member);
            return;
        }

        if(!rightsCheck(msg.member)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
            });
            return;
        }

        let args = msg.content.slice(CMD_GUILDS_CREATE.length).split(",").map(arg => arg.trim());
        if(args.length > 2) {
            // Overwatch, Overwatch, friends!
            let fields:IEmbedOptionsField[] = [];
            if((msg.content.match(/\,/g) || []).length > 1) {
                fields.push({
                    name: await localizeForUser(msg.member, "GUILDS_CREATE_FIELD_TIP"),
                    value: await localizeForUser(msg.member, "GUILDS_CREATE_FILED_TIP_TEXT"),
                });
            }
            fields.push({
                name: await localizeForUser(msg.member, "GUILDS_CREATE_FIELDS_USAGE"),
                value: await localizeForUser(msg.member, "GUILDS_CREATE_FIELDS_USAGE_TEXT", {
                    prefix: CMD_GUILDS_CREATE
                })
            });
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_WRONGARGSCOUNT", {
                    fields: []
                })
            });
            return;
        }

        if(["create", "edit", "invite", "delete", "list", "info"].includes(args[0].toLowerCase())) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESERVEDNAME")
            });
            return;
        }

        // search if we already having role with this name
        let dbRow:IGuildRow|undefined = await this.getGuildRow(msg.guild, args[0]);

        if(dbRow) {
            if(!msg.guild.roles.has(dbRow.roleId)) {
                return await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_NOROLE")
                });
            }
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_ROLE")
            });
            return;
        }

        let role:Role|undefined = undefined;

        if(args.length === 1) {
            let roleName = `${DEFAULT_ROLE_PREFIX}${args[0]}`;
            
            // creating role
            let _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_CREATE_ROLECREATING_CONFIRMATION");
            
            let confirmation = await createConfirmationMessage(_confirmationEmbed, msg);
            
            if(!confirmation) {
                await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CANCELED")
                });
                return;
            }

            role = await msg.guild.createRole({
                permissions: [],
                name: roleName,
                mentionable: false,
                hoist: false
            });
        } else {
            role = resolveGuildRole(args[1], msg.guild);
            if(!role) {
                await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESOLVINGFAILED")
                });
                return;
            }
        }

        try {
            await msg.member.addRole(role);
        } catch (err) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ROLEASSIGNATIONFAILED")
            });
            return;
        }

        await this.createGuildRow(msg.guild, args[0]);

        dbRow = await this.getGuildRow(msg.guild, args[0]);

        if(!dbRow) {
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_DBERROR")
            });
            return;
        }

        dbRow.roleId = role.id;
        dbRow.name = args[0];
        dbRow.customize = "{}";
        dbRow.ownerId = msg.member.id;

        await this.updateGuildRow(dbRow);

        await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CREATE_DONE")
        });
    }

    async editGuild(msg:Message) {
        // !guilds edit Overwatch, description, Для фанатов этой отвратительной игры
        if(msg.content === CMD_GUILDS_EDIT) {
            this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_EDIT, msg.member);
            return;
        }

        let args = msg.content.slice(CMD_GUILDS_EDIT.length).split(",");

        let guildName = "", editableParam = "", content = "";
        // due to issues w/ typescript I made them ""

        {
            // nice argument parsing
            let currentElem:string; let i = 0;
            while((currentElem = args.splice(0, 1)[0]) !== undefined) {
                i++; if(i === 3) {
                    break;
                }
                switch(i) {
                    case 1: {
                        guildName = currentElem.trim();
                    } break;
                    case 2: {
                        editableParam = currentElem.trim();
                        content = args.join(",").trim();
                    } break;
                }
            }
        }

        if(["image", "description", "rules", "welcome_msg_channel", "welcome_msg", "icon", "owner", "google-ua", "private", "invite_only", "add_admin", "add_adm", "remove_admin", "rm_admin", "delete_admin"].indexOf(editableParam) === -1) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error,msg.member, "GUILDS_EDIT_INVALIDPARAM")
            });
            return;
        }

        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }
        
        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        if(!rightsCheck(msg.member, dbRow)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
            });
            return;
        }
        
        let customize = JSON.parse(dbRow.customize) as IGuildCustomize;

        let isCalledByAdmin = !rightsCheck(msg.member, dbRow, true);

        let doneString = "";

        switch(editableParam) {
            case "image": case "icon": {
                // fetching first
                if(!content.startsWith("http://") && !content.startsWith("https://")) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
                    });
                    return;
                }
                let resolved = parseURI(content);
                if(resolved.hostname && isHostBanned(resolved.hostname)) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
                    });
                    return;
                }
                try {
                    await fetch(encodeURI(content), {
                        method: "GET"
                    });
                } catch (err) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_IMAGELOADINGFAILED")
                    });
                    return;
                }
                if(editableParam === "image") {
                    customize.image_url = content;
                } else {
                    customize.icon_url = content;
                }
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_IMAGESET");
            } break;
            case "rules": {
                content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
                customize.rules = content;
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_RULESSET");
            } break;
            case "welcome_msg_channel": {
                let channel = discordBot.channels.get(content);
                if(!channel) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_CHANNELNOTFOUND")
                    });
                    return;
                }
                if(channel.type !== "text") {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_WRONGCHANNEL")
                    });
                    return;
                }
                if((channel as TextChannel).guild.id !== msg.guild.id) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OTHERCHANNEL")
                    });
                    return;
                }
                customize.welcome_msg_channel = content;
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_WELCOMECHANNELSET");
            } break;
            case "welcome_msg": {
                content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
                customize.welcome_msg = content;
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_WELCOMEMSGSET");
            } break;
            case "description": {
                content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
                dbRow.description = content;
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_DESCRIPTIONSET");
            } break;
            case "owner": {
                if(isCalledByAdmin) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OWNERERR")
                    });
                    return;
                }
                if(content.startsWith("<@") && content.endsWith(">")) {
                    content = content.slice(2).slice(0, -1);
                    if(content.startsWith("!")) {
                        content = content.slice(1);
                    }
                }
                let member = msg.guild.members.get(content);
                if(!member) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_MEMBERNOTFOUND")
                    });
                    return;
                }
                if(member.id === dbRow.ownerId) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TRANSFEROWNERSHIPTOOWNER")
                    });
                    return;
                }
                let confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Question, msg.member, {
                    key: "GUILDS_EDIT_TRANSFERCONFIRMATION",
                    formatOptions: {
                        username: escapeDiscordMarkdown(member.displayName, true)
                    }
                }), msg);
                if(!confirmation) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
                    });
                    return;
                }
                dbRow.ownerId = member.id;
                if(customize.admins && customize.admins.includes(member.id)) {
                    customize.admins.splice(customize.admins.indexOf(member.id), 1);
                }
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_TRANSFERDONE");
            } break;
            case "google-ua": {
                if(isCalledByAdmin) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
                    });
                    return;
                }
                if(!content.startsWith("UA-")) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GOOGLEUAWRONGCODE")
                    });
                    return;
                }
                customize.ua = content;
                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_GOOGLEUADONE");
            } break;
            case "invite_only": case "private": {
                if(isCalledByAdmin) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
                    });
                    return;
                }

                if(!["true", "false"].includes(content)) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TRUEFALSEERR")
                    });
                    return;
                }
                
                if(content === "true" && customize.invite_only) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
                            key: "GUILDS_EDIT_IOALREADY",
                            formatOptions: {
                                ioAlreadyEnabled: true
                            }
                        })
                    });
                    return;
                } else if(content === "false" && !customize.invite_only) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
                            key: "GUILDS_EDIT_IOALREADY",
                            formatOptions: {
                                ioAlreadyEnabled: false
                            }
                        })
                    });
                    return;
                }

                customize.invite_only = content === "true";

                doneString = await localizeForUser(msg.member, "GUILDS_EDIT_IOCHANGED", {
                    ioEnabled: customize.invite_only
                });
            } break;
            case "add_admin": case "add_adm": {
                if(isCalledByAdmin) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMPERMS")
                    });
                    return;
                }
                if(msg.mentions.members.size === 0) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOMENTIONS")
                    });
                    return;
                }
                if(msg.mentions.members.size > 1) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMSINGLEMENTION")
                    });
                    return;
                }
                if(!customize.admins) {
                    customize.admins = [] as string[];
                }
                let mention = msg.mentions.members.first().id;
                if(customize.admins.includes(mention)) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOTGUILDMEMBER")
                    });
                    return;
                }
                customize.admins.push(mention);
            } break;
            case "remove_admin": case "rm_admin":  case "delete_admin": case "rm_adm": {
                if(isCalledByAdmin) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMADMPERMS")
                    });
                    return;
                }
                if(msg.mentions.members.size === 0) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOMENTIONS")
                    });
                    return;
                }
                if(msg.mentions.members.size > 1) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_SINGLEMENTION")
                    });
                    return;
                }
                if(!customize.admins) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMNOADMINS")
                    });
                    return;
                }
                let mention = msg.mentions.members.first().id;
                customize.admins.splice(customize.admins.indexOf(mention), 1);
            } break;
        }

        dbRow.customize = JSON.stringify(customize);

        await this.updateGuildRow(dbRow);

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
                custom: true,
                string: doneString
            })
        });
    }

    async deleteGuild(msg:Message) {
        let guildName = msg.content.slice(CMD_GUILDS_DELETE.length).trim();
        if(guildName === "") {
            this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_DELETE, msg.member);
            return;
        }
        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }
        
        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        if(!rightsCheck(msg.member, dbRow, true)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
            });
            return;
        }

        let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "GUILDS_DELETE_CONFIRMATION");
        let confirmation = await createConfirmationMessage(confirmationEmbed, msg);

        if(!confirmation) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
            });
        }

        await this.deleteGuildRow(dbRow);

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK,msg.member, "GUILDS_DELETE_DONE")
        });
    }

    async joinLeaveGuild(msg:Message) {
        // !guilds Overwatch
        let guildName = msg.content.slice(BASE_PREFIX.length).trim();
        if(guildName.length === 0) {
            this.sendHelp(msg.channel as TextChannel, undefined, msg.member);
            return;
        }

        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        let role = msg.guild.roles.get(dbRow.roleId);

        if(!role) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_NOROLE")
            });
            return;
        }

        if(!msg.member.roles.has(dbRow.roleId)) {
            await this.joinGuild(msg, dbRow, role, guildName);
        } else {
            await this.leaveGuild(msg, dbRow, role, guildName);
        }
    }

    async leaveGuild(msg:Message, dbRow:IGuildRow|undefined, role:Role|undefined, guildName:string) {
        if(!dbRow || !role) { return; }

        let cz = JSON.parse(dbRow.customize) as IGuildCustomize;

        if(dbRow.ownerId === msg.member.id || (cz.admins && cz.admins.includes(msg.member.id))) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ADMIN")
            });
            return;
        }

        let str = await localizeForUser(msg.member, "GUILDS_LEAVE_CONFIRMATION", {
            guildName: escapeDiscordMarkdown(dbRow.name, true)
        });

        if(cz.invite_only) {
            str += "\n";
            str += await localizeForUser(msg.member, "GUILDS_LEAVE_INVITEWARNING");
        }

        let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
            custom: true,
            string: str
        });
        let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
        if(!confirmation) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
            });
            return;
        }

        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ALREADYDESTROYED")
            });
            return;
        }

        role = msg.guild.roles.get(dbRow.roleId);

        if(!role) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error,msg.member, "GUILDS_LEAVE_ALREADYDELETEDROLE")
            });
            return;
        }

        try {
            await msg.member.removeRole(role);
            if(cz.ua) {
                let visitor = ua(cz.ua, msg.guild.id, {
                    strict_cid_format: false,
                    https: true
                });

                visitor.event("Members", "Left", msg.member.id).send();
            }
        } catch (err) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ROLEFAILED")
            });
            return;
        }

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
                key: "GUILDS_LEAVE_DONE",
                formatOptions: {
                    guildName: escapeDiscordMarkdown(dbRow.name, true)
                }
            })
        });
    }

    async joinGuild(msg:Message, dbRow:IGuildRow|undefined, role:Role|undefined, guildName:string) {
        if(!dbRow || !role) { return; }

        let getEmbed = async (str) => {
            return await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
                custom: true,
                string: str
            }, {
                author: {
                    icon_url: msg.author.avatarURL,
                    name: msg.member.displayName
                }
            });
        };

        let cz = JSON.parse(dbRow.customize) as IGuildCustomize;

        if(cz.invite_only && (!cz.invites || !(cz.invites as string[]).includes(msg.member.id))) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_IOERR")
            });
            return;
        }

        let _msg = (await msg.channel.send("", {
            embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS", {
                guildName: escapeDiscordMarkdown(dbRow.name, true)
            }))
        })) as Message;

        if(cz.rules) {
            let code = (Math.round((20000 + (Math.random() * (100000 - 20000)))).toString(16) + Math.round((20000 + (Math.random() * (100000 - 20000)))).toString(16)).toUpperCase();

            let __msg:Message|undefined = undefined;

            try {
                __msg = await (msg.author.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
                        custom: true,
                        string: cz.rules
                    }, {
                        title: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_TITLE"),
                        fields: [{
                            name: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FIELDS_CODE"),
                            value: code
                        }],
                        footerText: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FOOTER_TEXT")
                    })
                })) as Message;
            } catch (err) {
                await _msg.edit("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
                        key: "GUILDS_JOIN_FAILED_DM",
                        formatOptions: {
                            guildName: escapeDiscordMarkdown(dbRow.name, true)
                        }
                    })
                });
                return;
            }

            await _msg.edit("", {
                embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS_RULES", {
                    guildName: escapeDiscordMarkdown(dbRow.name, true)
                }))
            });

            let confirmed = false;
            try{ 
                let msgs = await waitForMessages(__msg.channel as DMChannel, {
                    time: 60 * 1000,
                    variants: [code, code.toLowerCase(), "-"],
                    maxMatches: 1,
                    max: 1,
                    authors: [msg.author.id]
                });

                confirmed = msgs.first().content.toLowerCase() === code.toLowerCase();
            } catch (err) {
                confirmed = false;
            }

            if(!confirmed) {
                _msg.edit("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
                        key: "GUILDS_JOIN_FAILED_RULES",
                        formatOptions: {
                            guildName: escapeDiscordMarkdown(dbRow.name, true)
                        }
                    })
                });
                return;
            }
        }

        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            _msg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_DESTROYED")
            });
            return;
        }

        role = msg.guild.roles.get(dbRow.roleId);

        cz = JSON.parse(dbRow.customize) as IGuildCustomize;

        if(!role) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEDELETED")
            });
            return;
        }

        try {
            await msg.member.addRole(role);
            if(cz.ua) {
                let visitor = ua(cz.ua, msg.guild.id, {
                    strict_cid_format: false,
                    https: true
                });
                visitor.event("Members", "Joined", msg.member.id).send();
            }
        } catch (err) {
            _msg.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEASSIGN")
            });
            return;
        }

        if(cz.welcome_msg && cz.welcome_msg_channel) {
            let channel = msg.guild.channels.get(cz.welcome_msg_channel);
            if(!channel || channel.type !== "text") {
                return;
            }
            (channel as TextChannel).send(cz.welcome_msg.replace("{usermention}", `<@${msg.author.id}>`).replace("{username}", escapeDiscordMarkdown(msg.author.username, true)));
        }

        if(cz.invite_only) {
            let invites = (cz.invites as string[]);
            invites.splice(invites.indexOf(msg.member.id), 1);
            cz.invites = invites;
            dbRow.customize = JSON.stringify(cz);
            await this.updateGuildRow(dbRow);
        }

        _msg.edit("", {
            embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, {
                key: "GUILDS_JOIN_DONE",
                formatOptions: {
                    guildName: escapeDiscordMarkdown(dbRow.name, true)
                }
            }, {
                author: {
                    icon_url: msg.author.displayAvatarURL,
                    name: msg.member.displayName
                }
            })
        });
    }

    async getGuildInfo(msg:Message) {
        let guildName = msg.content.slice(CMD_GUILDS_INFO.length).trim();
        if(guildName.length === 0) {
            this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_INFO, msg.member);
            return;
        }
        
        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, guildName);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        let role = msg.guild.roles.get(dbRow.roleId);
        if(!role) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
            });
            return;
        }

        let guildAuthor = msg.guild.members.get(dbRow.ownerId);

        let fields:IEmbedOptionsField[] = [];

        let guildMembers = msg.guild.members.filter(member => dbRow ? member.roles.has(dbRow.roleId) : false);

        fields.push({
            name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBERS"),
            value: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBERS_VALUE", {
                count: guildMembers.size
            }),
            inline: true
        });

        let isMember = msg.member.roles.has(dbRow.roleId);

        fields.push({
            name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBER"),
            value: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBER_VALUE", {
                member: isMember
            }),
            inline: true
        });

        let cz = JSON.parse(dbRow.customize) as IGuildCustomize;

        if(cz.invite_only) {
            let str = "";
            if(isMember) {
                if(dbRow.ownerId === msg.member.id) {
                    str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_OWNER");
                } else if(rightsCheck(msg.member, dbRow)) {
                    str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_ADMIN");
                } else {
                    str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_MEMBER");
                }
            } else {
                str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_INVITED", {
                    invited: cz.invites && cz.invites.includes(msg.author.id)
                });
            }
            fields.push({
                name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS"),
                value: str
            });
        }

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Empty, msg.member, {
                custom: true,
                string: dbRow.description || await localizeForUser(msg.member, "GUILDS_INFO_DESCRIPTIONPLACEHOLDER")
            }, {
                fields, 
                author: guildAuthor ? {
                    icon_url: guildAuthor.user.displayAvatarURL,
                    name: guildAuthor.displayName
                } : {
                    icon_url: msg.guild.iconURL,
                    name: msg.guild.name
                },
                imageUrl: cz.image_url,
                thumbUrl: cz.icon_url,
                title: dbRow.name, 
                footer: {
                    icon_url: msg.guild.iconURL,
                    text: msg.guild.name
                },
                ts: role.createdAt
            })
        });
    }

    async membersControl(msg:Message) {
        if(msg.content === CMD_GUILDS_MEMBERS) {
            return;
        }
        let args = msg.content.split(",").map(arg => arg.trim());
        args[0] = args[0].slice(CMD_GUILDS_MEMBERS.length).trim();
        args = args.filter(arg => arg.trim() !== "");
        // !guilds members guildName, [list/kick/add] <@mention>
        // guildName, list
        // guildName, kick, @mention
        // guildName, add, @mention
        if(args.length < 2) {
            // something
            return;
        }

        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, args[0]);
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        if(!msg.guild.roles.has(dbRow.roleId)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
            });
            return;
        }

        if(args[1] === "list") {
            await this.membersControlAction(msg, dbRow, "list");
            return;
        } else if(args[1] === "kick" && args.length > 2) {
            if(msg.mentions.users.size === 0) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_NOMENTIONS")
                });
                return;
            }
            if(!rightsCheck(msg.member, dbRow, false)) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
                });
                return;
            }
            await this.membersControlAction(msg, dbRow, "kick");
        }
    }

    membersControl_fixString(str:string) {
        return replaceAll(str, "`", "'");
    }

    async membersControlAction(msg:Message, dbRow:IGuildRow, action:"list"|"kick"|"add") {
        let statusMsg = (await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_LOADING")
        })) as Message;

        let members = msg.guild.members.filter(m => m.roles.has(dbRow.roleId));

        switch (action) {
            case "list": {
                let str = "#" + await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST", {
                    guildName: this.membersControl_fixString(dbRow.name)
                });
                str += "\n\n";
                for(let member of members.values()) {
                    str += `- ${this.membersControl_fixString(member.displayName)}\n`;
                }
                statusMsg = (await statusMsg.edit("", {
                    embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_SENDING")
                })) as Message;
                try {
                    await msg.author.send(str, {
                        split: true,
                        code: "md"
                    });
                    statusMsg = (await statusMsg.edit("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_MEMBERSCONTROL_SENT")
                    })) as Message;
                } catch (err) {
                    statusMsg = (await statusMsg.edit("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_SENDINGERR")
                    })) as Message;
                }
            } break;
            case "kick": {
                if(msg.mentions.users.size > 20) {
                    statusMsg = (await statusMsg.edit("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_MAXMENTIONS")
                    })) as Message;
                    return;
                }
                let str = "";
                let kicked = 0;
                for(let mention of msg.mentions.users.values()) {
                    let member = msg.guild.members.get(mention.id);
                    let adminRemoved = false;
                    if(!member) {
                        str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBEROFSERVER", {
                            username: escapeDiscordMarkdown(mention.username, true)
                        })) + "\n";
                        continue;
                    }
                    if(rightsCheck(msg.member, dbRow, true)) {
                        // command called by admin or guild owner
                        if(rightsCheck(member, dbRow, false)) {
                            let cz = JSON.parse(dbRow.customize) as IGuildCustomize;
                            let index = cz.admins.indexOf(member.id);
                            cz.admins.splice(index, 1);
                            dbRow.customize = JSON.stringify(cz);
                            await this.updateGuildRow(dbRow);
                            adminRemoved = true;
                        }
                    } else {
                        if(rightsCheck(member, dbRow, false)) {
                            str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_GUILDADMOROWNR", {
                                username: escapeDiscordMarkdown(mention.username, true)
                            })) + "\n";
                            continue;
                        }
                    }
                    if(!member.roles.has(dbRow.roleId)) {
                        str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBER", {
                            username: escapeDiscordMarkdown(member.displayName, true)
                        })) + "\n";
                        continue;
                    }
                    await member.removeRole(dbRow.roleId);
                    str += (await localizeForUser(msg.member, adminRemoved ? "GUILDS_MEMBERSCONTROL_KICKEDADMITEM" : "GUILDS_MEMBERSCONTROL_KICKEDITEM", {
                        username: escapeDiscordMarkdown(member.displayName, true)
                    })) + "\n";
                    kicked++;
                }
                statusMsg = (await statusMsg.edit("", {
                    embed: await generateLocalizedEmbed(kicked === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
                        custom: true,
                        string: str
                    }, {
                        title: await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_KICKED", {
                            members: kicked
                        })
                    })
                })) as Message;
            } break;
        }
    }

    async inviteToGuild(msg:Message) {
        if(msg.content === CMD_GUILDS_INVITE) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_INVITE_INFO")
            });
            return;
        }

        let args = msg.content.split(",").map(arg => arg.trim());
        if(args.length === 1) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_INVITE_USAGE")
            });
            return;
        }

        args[0] = args[0].slice(CMD_GUILDS_INVITE.length + 1);

        let dbRow:IGuildRow|undefined = undefined;
        try {
            dbRow = await this.getGuildRow(msg.guild, args[0]);
            // args[0] supposed to be guild name
        } catch (err) {
            this.log("err", "Failed to get guild", err);
            dbRow = undefined;
        }

        if(!dbRow) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
            });
            return;
        }

        let isRevoke = args[1] === "revoke";

        let cz = JSON.parse(dbRow.customize) as IGuildCustomize;

        if(!rightsCheck(msg.member, dbRow)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
            });
            return;
        }

        if(msg.mentions.users.size === 0) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOMENTIONS")
            });
            return;
        }

        if(!cz.invites && isRevoke) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOINVITES")
            });
            return;
        }

        let invited = 0;
        let revoked = 0;
        let str = ""; 

        if(isRevoke && cz.invites) {
            let a = cz.invites.length;
            for(let [uid, mention] of msg.mentions.users) {
                let index = cz.invites.indexOf(uid);
                if(index === -1) {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTINVITED", {
                        username: escapeDiscordMarkdown(mention.username, true)
                    })) + "\n";
                    continue;
                }
                cz.invites.splice(index, 1);
                str += (await localizeForUser(msg.member, "GUILDS_INVITE_REVOKEDITEM", {
                    username: escapeDiscordMarkdown(mention.username, true)
                })) + "\n";
            }
            for(let uid of cz.invites) {
                let index = cz.invites.indexOf(uid);
                let member = msg.guild.members.get(uid);
                if(member) {
                    if(!member.roles.has(dbRow.roleId)) {
                        continue;
                    } else {
                        str += (await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED_1", {
                            username: escapeDiscordMarkdown(member.displayName, true)
                        })) + "\n";
                    }
                } else {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED", {
                        id: uid + ""
                    })) + "\n";
                }
                cz.invites.splice(index, 1);
            }
            revoked = a - cz.invites.length;
        } else {
            if(!cz.invites) { cz.invites = [] as string[]; }
            for(let [userId, userObj] of msg.mentions.users) {
                let member = msg.guild.members.get(userId);
                if(!member) {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTAMEMBER", {
                        username: escapeDiscordMarkdown(userObj.username, true)
                    })) + "\n";
                    continue;
                }
                if(member.roles.has(dbRow.roleId)) {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_GUILDMEMBER", {
                        username: escapeDiscordMarkdown(userObj.username, true)
                    })) + "\n";
                    continue;
                }
                if(cz.invites.includes(userId)) {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_ALREADYINVITED", {
                        username: escapeDiscordMarkdown(userObj.username, true)
                    })) + "\n";
                    continue;
                }
                cz.invites.push(userId);
                try {
                    await member.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Information, member, {
                            key: "GUILDS_INVITE_INVITEMSG",
                            formatOptions: {
                                prefix: BASE_PREFIX,
                                guildName: escapeDiscordMarkdown(dbRow.name, true),
                                serverName: escapeDiscordMarkdown(msg.guild.name, true),
                                RAWguildName: dbRow.name
                            }
                        })
                    });
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_INVITESENT", {
                        username: escapeDiscordMarkdown(member.displayName, true)
                    })) + "\n";
                } catch (err) {
                    str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTSENT", {
                        username: escapeDiscordMarkdown(member.displayName, true)
                    })) + "\n";
                }
                invited++;
            }
        }

        dbRow.customize = JSON.stringify(cz);

        await this.updateGuildRow(dbRow);

        if(isRevoke) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(revoked === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
                    custom: true, string: str
                }, {
                    title: await localizeForUser(msg.member, "GUILDS_INVITE_REVOKED", { revoked })
                })
            });
        } else {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(invited === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
                    custom: true, string: str
                }, {
                    title: await localizeForUser(msg.member, "GUILDS_INVITE_INVITED", { invited })
                })
            });
        }
    }

    async getGuildsList(msg:Message) {
        let pageVal = msg.content.slice(CMD_GUILDS_LIST.length);
        let list = 1;
        if(pageVal !== "") {
            list = Math.max(1, Math.abs(Math.round(parseInt(pageVal, 10))));
            if(isNaN(list)) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LIST_WRONGUSAGE")
                });
                return;
            }
        }
        let dbResp = await this.getGuilds(msg.guild, (10 * list) - 10, 10);
        if(dbResp.rows.length === 0) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_LIST_EMPTYPAGE")
            });
            return;
        }

        let fields:IEmbedOptionsField[] = [];
        for(let row of dbResp.rows) {
            fields.push({
                inline: true,
                name: row.name,
                value: row.description && row.description.length > 0 ? row.description : await localizeForUser(msg.member, "GUILDS_LIST_DESCRIPTIONPLACEHOLDER")
            });
        }

        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
                key: "GUILDS_LIST_JOININFO", 
                formatOptions: {
                    prefix: BASE_PREFIX
                }
            }, {
                informationTitle: await localizeForUser(msg.member, "GUILDS_LIST_PAGE", {
                    list
                }),
                fields,
            })
        });
    }

    // ==============================
    // DB functions
    // ==============================

    getGID() {
        // very unique IDs
        return Date.now().toString(16).split("").reverse().join("");
    }

    async getGuilds(guild:Guild, offset:number = 0, limit:number = 10) {
        return {
            offset: offset,
            nextOffset: offset + limit,
            rows: await this.db(TABLE_NAME).where({
                guildId: guild.id
            }).offset(offset).limit(limit) as IGuildRow[]
        };
    }

    async getGuildRow(guild:Guild, name:string) {
        return await this.db(TABLE_NAME).where({
            guildId: guild.id,
            name: name
        }).first(...Object.keys(TABLE_SCHEMA)) as IGuildRow;
    }

    async updateGuildRow(guildRow:IGuildRow) {
        return await this.db(TABLE_NAME).where({
            gid: guildRow.gid
        }).update(guildRow);
    }

    async createGuildRow(guild:Guild, name:string) {
        return await this.db(TABLE_NAME).insert({
            guildId: guild.id,
            name: name,
            customize: "{}",
            roleId: "-1",
            description: "",
            gid: this.getGID()
        } as IGuildRow);
    }

    async deleteGuildRow(guildRow:IGuildRow) {
        return await this.db(TABLE_NAME).delete().where({
            gid: guildRow.gid
        });
    }

    async getOrCreateGuildRow(guild:Guild, name:string) {
        let element = await this.getGuildRow(guild, name);
        if(!element) {
            await this.createGuildRow(guild, name);
            element = await this.getGuildRow(guild, name);
            if(!element) {
                throw new Error("Can't create guild row at current moment.");
            }
        }
        return element;
    }

    // ==============================
    // Plugin functions
    // ==============================

    async init() {
        let status = false;
        try {
            this.log("info", "Fetching table status...");
            status = await this.db.schema.hasTable(TABLE_NAME);
        } catch (err) {
            this.log("err", "Can't get table status", err);
            return;
        }

        if(!status) {
            this.log("info", "Table not exists in DB, creating...");
            try {
                await createTableBySchema(TABLE_NAME, TABLE_SCHEMA);
            } catch (err) {
                this.log("err", "Can't create table by schema", err);
                return;
            }
        } else {
            this.log("info", "Table exists in DB");
        }
        
        this.log("ok", "Loaded and ready to work");
        this.handleEvents();
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = Guilds;