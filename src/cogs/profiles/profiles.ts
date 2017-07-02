import { IModule, ModuleLoader, IModuleInfo, Module } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember, User, Guild } from "discord.js"; 
import { getLogger, EmbedType, IEmbedOptionsField, escapeDiscordMarkdown, IEmbed } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import * as humanizeDuration from "humanize-duration";
import { IProfilesPlugin, IAddedProfilePlugin, AddedProfilePluginType } from "./plugins/plugin";
import { timeDiff } from "../utils/time";
import { default as fetch } from "node-fetch";
import * as util from "util";
import { command as docCmd, Category, IArgumentInfo } from "../utils/help";
import { isPremium } from "../utils/premium";
import { localizeForUser, generateLocalizedEmbed } from "../utils/ez-i18n";

interface IDBUserProfile {
    real_name?:string;
    activity?:string;
    bio?:string;
    customize:string;
    guild_id:string;
    uid:string;
    joined:string;
    status_changed?:string;
}

const TABLE_NAME = "profiles";
const DB_PROFILE_PROPS = {
    real_name: "string?",
    activity: "number?",
    bio: "string?",
    customize: {
        default: "{}",
        type: "string"
    },
    guild_id: "string",
    uid: "string",
    joined: "string",
    status_changed: "string"
};

function isChat(msg:Message) {
    return msg.channel.type === "text";
}

@docCmd(Category.Profiles, "profile", "loc:PROFILES_META_PROFILE", new Map<string, IArgumentInfo>([
    ["loc:PROFILES_META_PROFILE_ARG0", {
        optional: true,
        description: "loc:PROFILES_META_PROFILE_ARG0_DESC"
    }]
]), isChat)
@docCmd(Category.Profiles, "set_bio", "loc:PROFILES_META_SETBIO", new Map<string, IArgumentInfo>([
    ["loc:PROFILES_META_SETBIO_ARG0", {
        optional: false,
        description: "loc:PROFILES_META_SETBIO_ARG0_DESC"
    }]
]), isChat)
@docCmd(Category.Profiles, "edit_profile", "loc:PROFILES_META_EDITPROFILE", new Map<string, IArgumentInfo>([
    ["loc:PROFILES_META_EDITPROFILE_ARG0", {
        optional: false,
        description: "loc:PROFILES_META_EDITPROFILE_ARG0_DESC",
        values: ["remove", "set"]
    }],
    ["loc:PROFILES_META_EDITPROFILE_ARG1", {
        optional: false,
        description: "loc:PROFILES_META_EDITPROFILE_ARG1_DESC"
    }],
    ["loc:PROFILES_META_EDITPROFILE_ARG2", {
        optional: true,
        description: "loc:PROFILES_META_EDITPROFILE_ARG2_DESC"
    }]
]), isChat)
@docCmd(Category.Profiles, "profile_plugins", "loc:PROFILES_META_PROFILEPLUGINS", undefined, isChat)
class Profiles extends Plugin implements IModule {
    plugLoader: ModuleLoader;
    log = getLogger("ProfilesJS");
    db = getDB();
    
    constructor(options:string) {
        super({
            "message": (msg:Message) => this.onMessage(msg),
            "presenceUpdate": (oldMember:GuildMember, newMember:GuildMember) => this.onPresenseUpdate(oldMember, newMember)
        }, true);
        this.init(options);
    }

    // =====================================
    // MESSAGES HANDLING
    // =====================================

    async onMessage(msg:Message) {
        if(msg.channel.type !== "text") { return; }
        if(msg.content === "!profile_plugins") {
            this.sendPluginsList(msg);
        } else if(msg.content.startsWith("!profile")) {
            this.showProfile(msg);
        } else if(msg.content.startsWith("!edit_profile")) {
            this.editProfile(msg);
        } else if(msg.content.startsWith("!set_bio")) {
            this.editBio(msg);
        }
        // else if(msg.content.startsWith("!status")) {
        //     this.editActivity(msg);
        // }
    }

    async onPresenseUpdate(old:GuildMember, member:GuildMember) {
        let profile = await this.getOrCreateProfile(member, member.guild);
        if(old.presence.status !== member.presence.status) {
            if(old.presence.game && member.presence.game) {
                if(old.presence.game.equals(member.presence.game)) {
                    return; // nothing changed
                }
            }
        } else {
            if(old.presence.game && member.presence.game && old.presence.game.equals(member.presence.game)) {
                return; // game not changed ?
            }
        }
        profile.status_changed = (new Date()).toISOString();
        this.updateProfile(profile);
    }

    // =====================================
    // MAIN FUNCTIONS
    // =====================================

    async sendPluginsList(msg:Message) {
        let str = "# " + await localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_TITLE");

        for (let [name, plugin] of this.plugLoader.loadedModulesRegistry) {
            str += `\n- ${name}`;
            if(!plugin.base) { return; }
            let plug = plugin.base as IProfilesPlugin;
            str += `\n  - : ${await localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_ARGUMENTS", {
                arguments: (await plug.getSetupArgs(msg.member)) || await localizeForUser(msg.member, "PROFILES_PROFILEPLUGINS_ARGUMENTS_EMPTY")
            })}\n`;
        }

        await msg.channel.send(str, {
            code: "md",
            split: true
        });
    }

    async showProfile(msg:Message) {
        let profileOwner:GuildMember|undefined;
        if(msg.content === "!profile") {
            profileOwner = msg.member;
        } else if(msg.content.startsWith("!profile ") && msg.mentions.users.size === 1) {
            let ment = msg.mentions.users.first();
            if(!(profileOwner = msg.guild.members.get(ment.id))) {
                msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_NOTAMEMBER")
                });
                return;
            }
        } else {
            return;
        }

        let profile = await this.getOrCreateProfile(profileOwner, msg.guild);
        
        await this.sendProfile(msg, profile, profileOwner);
    }

    async addBadge(msg:Message) {
        if(msg.author.id !== botConfig.botOwner) {
            return;
        }
        let args = msg.content.slice("!add_badge ".length).split(",").map(arg => arg.trim());
        if(args.length !== 4) {
            // uid, gid, add/remove, badgeid
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_ADDBADGE_ARGSERR")
            });
            return;
        }
    }

    async editProfile(msg:Message) {
        if(msg.content === "!edit_profile") {
            await msg.channel.send("", {
                embed: {
                    description: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PROFILES_PROFILE_DESCRIPTION")
                }
            });
            return;
        }
        let param = msg.content.slice("!edit_profile ".length);
        let profile = await this.getOrCreateProfile(msg.member, msg.guild);
        if(param.startsWith("set ")) {
            param = param.slice("set ".length);
            let firstSpaceIndex = param.indexOf(" ");
            let arg = firstSpaceIndex !== -1 ? param.slice(firstSpaceIndex + 1) : "";
            param = param.slice(0, firstSpaceIndex === -1 ? param.length + 1 : firstSpaceIndex);

            if(["image"].indexOf(param) !== -1) {
                let customize = JSON.parse(profile.customize);
                if(param === "image") {
                    if(arg === "" || (!arg.startsWith("http://") && !arg.startsWith("https://"))) {
                        await msg.channel.send("", {
                            embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_INVALID_LINK")
                        });
                        return;
                    }
                    try {
                        await fetch(encodeURI(arg));
                    } catch (err) {
                        await msg.channel.send("", {
                            embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_DOWNLOAD_FAILED")
                        });
                        return;
                    }
                    
                    customize["image_url"] = encodeURI(arg);
                    await msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PROFILES_PROFILE_IMAGE_SET", {
                            imageUrl: encodeURI(arg)
                        })
                    });
                }

                customize = JSON.stringify(customize);

                profile.customize = customize;

                await this.updateProfile(profile);

                return;
            }

            let mod:Module|undefined = undefined;

            if(!(mod = this.plugLoader.loadedModulesRegistry.get(param))) {
                await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_404")
                });
                return;
            }

            if(!mod.loaded) {
                await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_NOT_LOADED")
                });
                return;
            }

            let plugin = mod.base as IProfilesPlugin;

            let completeInfo:IAddedProfilePlugin|undefined = undefined;
            try {
                completeInfo = await plugin.setup(arg, msg.member, msg);
            } catch (err) {
                await msg.channel.send("", {
                    embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_SETUP_FAILED", {
                        fields: [{
                            name: "Подробности",
                            value: "\`\`\`js\n"+ util.inspect(err) + "\`\`\`"
                        }]
                    })
                });
                return;
            }

            let customize = JSON.parse(profile.customize);

            if(!customize.plugins) {
                customize.plugins = {};
            }

            if(completeInfo.type === AddedProfilePluginType.Embed) {
                let embedsCount = Object.keys(customize.plugins).map(e => customize.plugins[e]).filter(e => e.type === AddedProfilePluginType.Embed).length;
                if(embedsCount > 4 && !(await isPremium(msg.member))) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_PREMIUMERR")
                    });
                    return;
                }
                if(embedsCount > 9) {
                    msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_MAXPLUGINSERR")
                    });
                    return;
                }
            }

            customize.plugins[param] = completeInfo;

            customize = JSON.stringify(customize);

            profile.customize = customize;

            await this.updateProfile(profile);

            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "PROFILES_PROFILE_SETUP_COMPLETE")
            });
        } else if(param === "set") {
            let strs = {
                key: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY"),
                value: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_VALUE"),
                keyDef: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY_DEFINITION"),
                valueDef: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_VALUE_DEFINITION")
            };
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, `\`set [${strs.key}] [${strs.value}]\``, {
                    fields: [{
                        name: `\`${strs.key}\``, inline: false, value: strs.keyDef
                    }, {
                        name: `\`${strs.value}\``, inline: false, value: strs.valueDef
                    }]
                })
            });
            return;
        } else if(param === "remove") {
            let strs = {
                key: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY"),
                keyDef: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_KEY_DEFINITION")
            };
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, `\`remove [${strs.key}]\``, {
                    fields: [{
                        name: `\`${strs.key}\``, inline: false, value: strs.keyDef
                    }]
                })
            });
        } else if(param.startsWith("remove ")) {
            param = param.slice("remove ".length);

            let customize = JSON.parse(profile.customize);

            let doneStr = "";

            if(["image"].indexOf(param) !== -1) {
                if(param === "image") {
                    doneStr = await localizeForUser(msg.member, "PROFILES_PROFILE_IMAGE_REMOVED");
                    delete customize["image_url"];
                }
            } else {
                if(!this.plugLoader.loadedModulesRegistry.has(param)) {
                    await msg.channel.send("", {
                        embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_PLUGIN_404")
                    });
                    return;
                }
                delete customize["plugins"][param];
                doneStr = await localizeForUser(msg.member, "PROFILES_PROFILE_PLUGIN_REMOVED", {
                    pluginName: param
                });
            }

            customize = JSON.stringify(customize);

            profile.customize = customize;

            await this.updateProfile(profile);

            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, `custom:${doneStr}`)
            });
        }
    }

    async editBio(msg:Message) {
        if(msg.content === "!set_bio") {
            let strs = {
                aboutMe: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_ABOUTME"),
                def_aboutMe: await localizeForUser(msg.member, "PROFILES_PROFILE_ARGS_ABOUTME_DEFINITON")
            };
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, `\`!set_bio [${strs.aboutMe}]\``, {
                    fields: [{
                        name: `\`${strs.aboutMe}\``,
                        inline: false,
                        value: strs.def_aboutMe
                    }]
                })
            });
            return;
        }
        let newBio = msg.content.slice("!set_bio ".length);
        if(newBio.length >= 1024) {
            await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PROFILES_PROFILE_ARGS_ABOUTME_INVALIDTEXT")
            });
            return;
        }

        let profile = await this.getOrCreateProfile(msg.member, msg.guild);
        profile.bio = newBio;
        await this.updateProfile(profile);

        await msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PROFILES_PROFILE_UPDATED")
        });

        return;
    }

    // async editActivity(msg:Message) {
    // }

    getUserStatusEmoji(user:User|GuildMember|string) {
        switch(typeof user !== "string" ? user.presence.status : user) {
            case "online": { return "<:online:313949006864711680>"; }
            case "idle": { return "<:away:313949134954561536>"; }
            case "dnd": { return "<:dnd:313949206119186432>"; }
            case "streaming": { return "<:streaming:313949265888280586>"; }
            default: { return "<:offline:313949330283167748>"; }
        }
    }

    async getUserStatusString(user:User|GuildMember|string, localizingFor: GuildMember | User) {
        let lF = async (str:string) => { return await localizeForUser(localizingFor, `PROFILES_STATUS_${str.toUpperCase()}`); };
        switch(typeof user !== "string" ? user.presence.status : user) {
            case "online": { return await lF("online"); }
            case "idle": { return await lF("idle"); }
            case "dnd": { return await lF("dnd"); }
            case "streaming": { return lF("streaming"); }
            case "playing": { return lF("playing"); }
            default: { return lF("offline"); }
        }
    }

    humanize(duration:number, largest:number = 2, round:boolean = true, lang = "ru") {
        return humanizeDuration(duration, { language: lang, largest, round: true });
    }

    async sendProfile(msg:Message, dbProfile:IDBUserProfile, member:GuildMember) {
        let statusString = "";
        statusString += await this.getUserStatusEmoji(member) + " ";
        statusString += await this.getUserStatusString(member, msg.member);

        if(member.presence.game) {
            statusString = "";

            if(member.presence.game.streaming) {
                statusString += await this.getUserStatusEmoji("streaming") + " ";
                statusString += await this.getUserStatusString("streaming", msg.member) + " ";
                statusString += `[${escapeDiscordMarkdown(member.presence.game.name)}](${member.presence.game.url})`;
            } else {
                statusString += await this.getUserStatusEmoji(member) + " ";
                statusString += await this.getUserStatusString("playing", msg.member) + " ";
                statusString += `в **${escapeDiscordMarkdown(member.presence.game.name)}**`;
            }
        }

        if(member.id === botConfig.botOwner) {
            statusString = `<:adm_badge:313954950143279117> ${statusString}`;
        } else if((await isPremium(member))) {
            statusString = `<:premium:315520823504928768> ${statusString}`;
        }

        if(dbProfile.status_changed) {
            let changedAt = new Date(dbProfile.status_changed).getTime();
            let diff = Date.now() - changedAt;
            let sDiff = this.humanize(diff, undefined, undefined, await localizeForUser(msg.member, "+SHORT_CODE"));
            statusString += ` (${sDiff})`;
        }

        let fields:IEmbedOptionsField[] = [];

        if(dbProfile.bio) {
            fields.push({
                inline: false,
                name: await localizeForUser(msg.member, "PROFILES_PROFILE_ABOUTME"),
                value: dbProfile.bio
            });
        }

        let pushedMessage:Message|undefined = undefined;

        let joinedDate = new Date(dbProfile.joined).getTime();

        if(joinedDate === 0) {
            dbProfile.joined = member.joinedAt.toISOString();
            await this.updateProfile(dbProfile);
            joinedDate = member.joinedAt.getTime();
        }

        let embed = {
            author: {
                icon_url: member.user.displayAvatarURL.replace("?size=2048", "?size=512"),
                name: member.displayName
            },
            title: dbProfile.real_name ? dbProfile.real_name : undefined,
            description: statusString,
            fields: fields,
            footer: {
                text: await localizeForUser(msg.member, "PROFILES_PROFILE_MEMBERTIME", {
                    duration: this.humanize(timeDiff(joinedDate, Date.now(), "ms"), undefined, undefined, await localizeForUser(msg.member, "+SHORT_CODE"))
                }),
                icon_url: msg.guild.iconURL
            },
            image: undefined,
            thumbnail: {
                url: member.user.displayAvatarURL
            },
            timestamp: member.user.createdAt.toISOString()
        } as IEmbed;

        let pushing = false;
        let repushAfterPush = false;

        let pushUpdate = async () => {
            if(pushing) {
                repushAfterPush = true;
                return;
            }
            pushing = true;
            if(!pushedMessage) {
                pushedMessage = await msg.channel.send("", {
                    embed: embed as any
                }) as Message;
                pushing = false;
                if(repushAfterPush) {
                    repushAfterPush = true;
                    pushUpdate();
                }
                return pushedMessage;
            }
            try {
                pushedMessage = (await pushedMessage.edit("", {
                    embed: embed as any
                }) as Message);
                pushing = false;
            } catch (err) {
                repushAfterPush = true;
            }

            if(repushAfterPush) {
                repushAfterPush = false;
                pushUpdate();
            }
            return pushedMessage;
        };

        if(dbProfile.customize !== "{}") {
            let customize = JSON.parse(dbProfile.customize);

            if(customize["image_url"]) {
                embed.image = { url: customize["image_url"] };
            }

            if(customize["video_url"]) {
                embed.video = { url: customize["video_url"] };
            }

            if(customize.plugins) {
                for(let pluginName of Object.keys(customize.plugins)) {
                    let mod:Module|undefined = undefined;
                    if(!(mod = this.plugLoader.loadedModulesRegistry.get(pluginName))) {
                        // not found, skipping
                        return;
                    }

                    if(!mod.loaded) {
                        // not loaded, skipping
                        return;
                    }

                    let plugin = mod.base as IProfilesPlugin;

                    let addedPlugin = customize.plugins[pluginName] as IAddedProfilePlugin;

                    if(addedPlugin.type === AddedProfilePluginType.Embed) {
                        if(!plugin.getEmbed) { return; }

                        let fNum = fields.length;

                        fields.push({
                            name: pluginName,
                            value: await localizeForUser(msg.member, "PROFILES_PROFILE_LOADING"),
                            inline: true
                        });

                        let pluginLogPrefix = `${dbProfile.uid} -> ${pluginName}|`;

                        let canEdit = true;
                        let t:NodeJS.Timer = setTimeout(async () => {
                            this.log("err", pluginLogPrefix, "timed out.");
                            canEdit = false;
                            fields[fNum] = {
                                name: pluginName,
                                value: await localizeForUser(msg.member, "PROFILES_PROFILE_TIMEDOUT"),
                                inline: true
                            };
                            pushUpdate();
                        }, 20000);
                        
                        plugin.getEmbed(addedPlugin.json, msg.member).then(field => {
                            if(!canEdit) { return; }
                            if(t) { clearTimeout(t); }
                            fields[fNum] = field;
                            if(pushedMessage && ((Date.now() - pushedMessage.createdAt.getTime()) / 1000) < 3) {
                                setTimeout(() => pushUpdate(), 1000);
                            } else {
                                pushUpdate();
                            }
                        }).catch(async (err) => {
                            this.log("err", pluginLogPrefix, "Error at plugin", err);
                            if(t) { clearTimeout(t); }
                            fields[fNum] = {
                                name: pluginName,
                                value: await localizeForUser(msg.member, "PROFILES_PROFILE_FAILED", {
                                    msg: err.message
                                })
                            };
                            pushUpdate();
                        });
                    } else if(addedPlugin.type === AddedProfilePluginType.Customs) {
                        if(!plugin.getCustoms) { return; }

                        let pluginLogPrefix = `${dbProfile.uid} -> ${pluginName}|`;

                        let canEdit = true;
                        let t:NodeJS.Timer = setTimeout(() => {
                            this.log("err", pluginLogPrefix, "timed out.");
                            canEdit = false;
                        }, 20000);

                        plugin.getCustoms(addedPlugin.json, msg.member).then(customs => {
                            if(!canEdit) { return; }
                            if(t) { clearTimeout(t); }
                            if(customs.image_url) {
                                embed.image = {url: customs.image_url};
                            }
                            if(customs.thumbnail_url) {
                                embed.thumbnail = {url: customs.thumbnail_url};
                            }
                            pushUpdate();
                        }).catch(err => {
                            this.log("err", pluginLogPrefix, "Error at plugin", err);
                            if(t) { clearTimeout(t); }
                        });
                    }
                }
                await pushUpdate();
            } else { await pushUpdate(); }
        } else { await pushUpdate(); }
    }

    // =====================================
    // WORKING WITH DATABASE
    // =====================================

    async createProfile(member:GuildMember, guild:Guild) {
        return await this.db(TABLE_NAME).insert({
            uid: member.id,
            real_name: null,
            guild_id: guild.id,
            bio: null,
            activity: null,
            customize: "{}",
            joined: member.joinedAt.toISOString(),
            status_changed: (new Date()).toISOString()
        });
    }

    async updateProfile(dbProfile:IDBUserProfile) {
        return await this.db(TABLE_NAME).where({
            uid: dbProfile.uid,
            guild_id: dbProfile.guild_id
        }).update(dbProfile);
    }

    async getProfile(member:GuildMember, guild:Guild) : Promise<IDBUserProfile> {
        return await this.db(TABLE_NAME).where({
            guild_id: guild.id,
            uid: member.id
        }).first(...Object.keys(DB_PROFILE_PROPS));
    }

    async getOrCreateProfile(member:GuildMember, guild:Guild) {
        let currentUser = await this.getProfile(member, guild);
        if(!currentUser) {
            await this.createProfile(member, guild);
            currentUser = await this.getProfile(member, guild);
        } else {
            return currentUser;
        }
        if(!currentUser) {
            throw new Error("User cannot be created at current moment.");
        }
        return currentUser;
    }


    // =====================================
    // PLUGIN SCRIPTS
    // =====================================

    async init(options:any) {
        try {
            this.db = getDB();
        } catch (err) {
            this.log("err", "Cannot connect to database");
            return;
        }
        
        let status = false;
        try {
            status = await this.db.schema.hasTable(TABLE_NAME);
        } catch (err) {
            this.log("err", "Can't check table status: ", err);
            return;
        }

        if(!status) {
            this.log("warn", "Table is not created, creating...");
            try {
                await createTableBySchema(TABLE_NAME, DB_PROFILE_PROPS);
                this.log("ok", "Table is created!");
            } catch (err) {
                this.log("err", "Cannot create table right now", err);
                return;
            }
        }

        let plugins = new Map<string, IModuleInfo>(this._convertToModulesMap(options));

        this.plugLoader = new ModuleLoader({
            name: "Profiles:Plugins",
            basePath: "./cogs/profiles/plugins/",
            registry: plugins,
            fastLoad: Array.from(plugins.keys())
        });

        this.handleEvents();
    }

    /**
     * Convert modules object to Map object
     * @param obj {Array} Array of module info entries
     */
    _convertToModulesMap(obj:IModuleInfo[]) {
        let modulesMap = new Map();
        obj.forEach((moduleInfo) => {
            modulesMap.set(moduleInfo.name, moduleInfo);
        });
        return modulesMap;
    }

    async unload() {
        this.plugLoader.unloadAll();
        this.unhandleEvents();
        return true;
    }
}

module.exports = Profiles;