import { IModule, ModuleLoader, IModuleInfo, Module } from "../../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "../plugin";
import { Message, GuildMember, User, Guild } from "discord.js"; 
import { getLogger, generateEmbed, EmbedType, IEmbedOptionsField } from "../utils/utils";
import { default as getDB, createTableBySchema } from "../utils/db";
import * as humanizeDuration from "humanize-duration";
import { IProfilesPlugin, IAddedProfilePlugin } from "./plugins/plugin";
import { timeDiff } from "../utils/time"

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

class Profiles extends Plugin implements IModule {
    plugLoader: ModuleLoader;
    log = getLogger("ProfilesJS");
    db = getDB();
    
    constructor(options:string) {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        }, true);
        this.init(options);
    }

    // =====================================
    // MESSAGES HANDLING
    // =====================================

    async onMessage(msg:Message) {
        if(msg.content.startsWith("!profile")) {
            this.showProfile(msg);
        } else if(msg.content.startsWith("!edit_profile")) {
            this.editProfile(msg);
        }
    }

    // =====================================
    // MAIN FUNCTIONS
    // =====================================

    async showProfile(msg:Message) {
        let profileOwner:GuildMember|undefined;
        if(msg.content === "!profile") {
            profileOwner = msg.member;
        } else if(msg.content.startsWith("!profile ") && msg.mentions.users.size === 1) {
            let ment = msg.mentions.users.first();
            if(!(profileOwner = msg.guild.members.get(ment.id))) {
                msg.channel.sendMessage("", {
                    embed: generateEmbed(EmbedType.Error, "Упомянутый пользователь не является участником данной гильдии.")
                })
                return;
            }
        } else {
            return;
        }

        let profile = await this.getProfile(profileOwner, msg.guild);
        
        await this.sendProfile(msg, profile, profileOwner);
    }

    async editProfile(msg:Message) {
        if(msg.content === "!edit_profile") {
            await msg.channel.sendMessage("", {
                embed: {
                    description: "Вы можете редактировать профиль добавляя или удаляя разные элементы.\nНе путайте эту команду с `!set_bio` `!set_status`! Данная команда позволяет вам настраивать элементы профиля, а не менять их значения (статус, биография)."
                }
            });
            return;
        }
        let param = msg.content.slice("!edit_profile ".length);
        let profile = await this.getProfile(msg.member, msg.guild);
        if(param.startsWith("set ")) {
            param = param.slice("set ".length);
            let arg = param.slice(param.indexOf(" "));
            if(arg === "") {
                await msg.channel.sendMessage("", {
                    embed: generateEmbed(EmbedType.Error, "Аргументы не предоставлены. Установка невозможна.")
                })
                return;
            }

            let mod:Module|undefined = undefined;

            if(!(mod = this.plugLoader.loadedModulesRegistry.get(param))) {
                await msg.channel.sendMessage("", {
                    embed: generateEmbed(EmbedType.Error, "Такой плагин не найден.")
                });
                return;
            }

            if(!mod.loaded) {
                await msg.channel.sendMessage("", {
                    embed: generateEmbed(EmbedType.Error, "Плагин не загружен. Установка невозможна.")
                })
                return;
            }

            let plugin = mod.base as IProfilesPlugin;

            let completeInfo:IAddedProfilePlugin|undefined = undefined;
            try {
                completeInfo = await plugin.setup(arg, msg.member, msg);
            } catch (err) {
                return;
            }

            let customize = JSON.parse(profile.customize);

            if(!customize.plugins) {
                customize.plugins = {
                    [param]: completeInfo.json
                };
            } else {
                customize.plugins[param] = completeInfo.json;
            }

            await msg.channel.sendMessage("", {
                embed: generateEmbed(EmbedType.OK, "Так выглядит новый плагин в вашем профиле:", {
                    okTitle: "Настройка завершена!",
                    fields: [completeInfo.example]
                })
            })
        } else if(param === "set") {
            await msg.channel.sendMessage("", {
                embed: generateEmbed(EmbedType.Information, "`set [ключ] [значение]`", {
                    fields: [{
                        name: "`ключ`", inline: false, value: "название плагина или надстройки"
                    }, {
                        name: "`значение`", inline: false, value: "значение для плагина или надстройки\nУ каждого плагина индивидуальные значения, учтите это!"
                    }]
                })
            });
            return;
        }
        
    }

    getUserStatusEmoji(user:User|GuildMember) {
        switch(user.presence.status) {
            case "online": { return "<:vpOnline:212789758110334977>"; }
            case "idle": { return "<:vpAway:212789859071426561>"; }
            case "dnd": { return "<:vpDnD:236744731088912384>"; }
            default: { return "<:vpOffline:212790005943369728>"; }
        }
    }

    getUserStatusString(user:User|GuildMember) {
        switch(user.presence.status) {
            case "online": { return "онлайн"; }
            case "idle": { return "отошел"; }
            case "dnd": { return "не беспокоить"; }
            default: { return "не в сети"; }
        }
    }

    async sendProfile(msg:Message, dbProfile:IDBUserProfile, member:GuildMember) {
        let statusString = "";
        statusString += this.getUserStatusEmoji(member) + " ";
        statusString += this.getUserStatusString(member);

        switch(member.presence.status) {
            case "online": case "idle": case "offline": {
                if(!dbProfile.status_changed) { break; }
                let changedAt = new Date(dbProfile.status_changed).getTime();
                let diff = Date.now() - changedAt;
                statusString += humanizeDuration(diff, { language: "ru", largest: 2 })
            } break;
            default: break;
        }

        let fields:IEmbedOptionsField[] = [];

        if(dbProfile.bio) {
            fields.push({
                inline: false,
                name: "О себе:",
                value: dbProfile.bio
            });
        }

        let pushedMessage:Message|undefined = undefined;

        let getEmbed = () => {
            return {
                title: dbProfile.real_name ? dbProfile.real_name : undefined,
                description: statusString,
                fields: fields,
                footer: {
                    text: `Участник уже ${humanizeDuration(timeDiff(dbProfile.joined, Date.now(), "ms"))}`,
                    icon_url: msg.guild.iconURL
                },
                timestamp: member.user.createdAt
            };
        }

        let pushUpdate = async () => {
            if(!pushedMessage) {
                return pushedMessage = await msg.channel.sendMessage("", {
                    embed: getEmbed()
                }) as Message;
            }
            return pushedMessage.edit("", {
                embed: getEmbed()
            });
        };

        if(dbProfile.customize !== "{}") {
            let customize = JSON.parse(dbProfile.customize);
            await pushUpdate();
            if(customize.plugins) {
                Object.keys(customize.plugins).forEach(pluginName => {
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
                    let fNum = fields.length;

                    fields.push({
                        name: pluginName,
                        value: "Загрузка...",
                        inline: true
                    });
                    
                    plugin.getEmbed(customize[pluginName]).then(field => {
                        fields[fNum] = field;
                        pushUpdate();
                    }).catch(() => {
                        // failed to load...
                    });
                });
            }
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
        }).first.apply(this, Object.keys(DB_PROFILE_PROPS));
    }

    async getOrCreateProfile(member:GuildMember, guild:Guild) {
        let currentUser = await this.getProfile(member, guild);
        if(!currentUser) {
            await this.createProfile(member, guild);
            currentUser = await this.getProfile(member, guild)
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
        })

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
        this.unhandleEvents();
        return true;
    }
}

module.exports = Profiles;