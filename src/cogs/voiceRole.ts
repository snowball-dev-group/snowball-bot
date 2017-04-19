import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Guild, Role, GuildMember } from "discord.js"; 
import { default as getDB } from "./utils/db";
import { getLogger } from "./utils/utils";
import * as knex from "knex";

const TABLE_NAME = "voice_role";
const PREFIX = "!voiceRole";
const SNOWFLAKE_REGEXP = /[0-9]{15,19}/;
const SPECIFIC_DONE = false;

interface GuildRow {
    /**
     * Discord snowflake, guild ID
     */
    guild_id:string;

    /**
     * Discord snowflake, role ID
     * or `-` if role not set
     */
    voice_role:string|"-";

    /**
     * JSON of specific roles
     */
    specific_roles:string;
}

class VoiceRole extends Plugin implements IModule {
    db:knex;
    log = getLogger("VoiceRole");
    loaded = false;

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg),
            "voiceStateUpdate": (oldMember:GuildMember, newMember:GuildMember) => this.vcUpdated(oldMember, newMember)
        }, true);
        this.log("info", "Loading 'VoiceRole' plugin");
        this.initialize();
    }

    async initialize() {
        this.log("info", "Asking for DB...");
        // stage one: DB initialization
        try {
            this.db = getDB();
        } catch (err) {
            this.log("err", "Asking for DB failed:", err);
            return;
        }
        this.log("ok", "Asking for DB has done");

        // stage two: checking table
        this.log("info", "Checking table");
        let dbStatus:boolean = false;
        try {
            dbStatus = await this.db.schema.hasTable(TABLE_NAME);
        } catch (err) {
            this.log("err", "Error checking if table is created");
            return;
        }

        // stage three: create table if not exists 
        if(!dbStatus) {
            this.log("warn", "Table in DB is not created. Going to create it right now");
            let creationStatus = await this.createTable();
            if(!creationStatus) {
                this.log("err", "Table creation failed.");
                return;
            }
        }

        // stage four: report successfull status
        this.loaded = true;

        // stage five: handling events
        this.handleEvents();

        // done
        this.log("ok", "'VoiceRole' plugin loaded and ready to work");
    }

    async createTable() {
        try {
            await this.db.schema.createTable(TABLE_NAME, (tb) => {
                tb.string("guild_id").notNullable();
                tb.string("voice_role").defaultTo("-");
                tb.string("specific_roles").defaultTo("{}");
            });
            this.log("ok", "Created table for 'voice roles'");
            return true;
        } catch (err) {
            this.log("err", "Failed to create table. An error occured:", err);
            return false;
        }
    }

    async onMessage(msg:Message) {
        if(msg.channel.type !== "text") { return; }
        if(!msg.content) { return; }
        if(msg.content.startsWith(PREFIX)) {
            await this.voiceRoleSetting(msg);
        }
    }

    vcUpdated(oldMember:GuildMember, newMember:GuildMember) {
        if(oldMember.voiceChannel && newMember.voiceChannel) {
            if(oldMember.voiceChannel.guild.id !== newMember.voiceChannel.guild.id) {
                // moved from one server to another (╯°□°）╯︵ ┻━┻
                // better not to wait this
                this.VCR_Remove(oldMember);
                this.VCR_Give(newMember);
            } else {
                // just moved from channel to channel on same server
                // hand
            }
        } else if(oldMember.voiceChannel && !newMember.voiceChannel) {
            this.VCR_Remove(newMember);
        } else if(!oldMember.voiceChannel && newMember.voiceChannel) {
            this.VCR_Give(newMember);
        }
    }

    resolveRole(resolvableName:string, guild:Guild) {
        let byName = guild.roles.find('name', resolvableName);
        if(byName) {
            return byName;
        }

        if(SNOWFLAKE_REGEXP.test(resolvableName) && guild.roles.has(resolvableName)) {
            return guild.roles.get(resolvableName);
        }

        return null;
    }

    async searchGuildRow(guild:Guild) : Promise<GuildRow|null> {
        return await this.db(TABLE_NAME).where({
            guild_id: guild.id
        }).first();
    }

    async getGuildRow(guild:Guild) {
        let element:null|GuildRow = await this.searchGuildRow(guild);
        
        if(!element) {
            await this.db(TABLE_NAME).insert({
                guild_id: guild.id,
                voice_role: "-",
                specific_roles: "{}"
            });
        } else {
            return element;
        }

        return this.searchGuildRow(guild);
    }

    async updateGuildRow(row:GuildRow) {
        return await this.db(TABLE_NAME).where({
            guild_id: row.guild_id
        }).update(row);
    }

    async VCR_Cleanup(guild:Guild, role?:Role) {
        if(!role) {
            let row = await this.getGuildRow(guild);
            if(!row || row.voice_role === "-") {
                return;
            }
            if(!guild.roles.has(row.voice_role)) {
                row.voice_role = "-";
                await this.updateGuildRow(row);
                return;
            }
            role = guild.roles.get(row.voice_role);
        }

        guild.members.filter((m:GuildMember) => {
            if(!role) { /* fuck ts logic pls */ return false; }
            return m.roles.has(role.id);
        }).forEach(m => {
            if(!role) { return; }
            m.removeRole(role);
        });

        return;
    }

    async VCR_Give(member:GuildMember) {
        let row = await this.getGuildRow(member.guild);
        if(!row) { return; }

        if(row.voice_role === "-") {
            return;
        }

        if(member.guild.roles.has(row.voice_role)) {
            await member.addRole(row.voice_role);
        } else {
            row.voice_role = "-";
            await this.updateGuildRow(row);
        }
    }

    async VCR_Remove(member:GuildMember) {
        let row = await this.getGuildRow(member.guild);
        if(!row) { return; }

        if(row.voice_role === "-") {
            return;
        }

        if(member.guild.roles.has(row.voice_role)) {
            await member.removeRole(row.voice_role);
        } else {
            row.voice_role = "-";
            await this.updateGuildRow(row);
        }
    }

    async voiceRoleSetting(msg:Message) {
        let guildId = msg.guild.id;
        
        let hasPermissionToChange = msg.member.hasPermissions(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES_OR_PERMISSIONS"]) || msg.member.hasPermission("ADMINISTRATOR");
        
        if(!hasPermissionToChange) {
            msg.channel.sendMessage(":warning: У вас недостаточно прав для изменения параметров 'голосовой роли' на этом сервере.");
            return;
        }

        let cmd = msg.content.slice(PREFIX.length + 1);
        if(cmd === "" || cmd === "help") {
            const SPECIFIC_CMD = "\n• `specific set [канал], [роль]` - установить специальную голосовую роль\n• `specific delete [канал], [роль]` - удалить специальную голосовую роль";
            msg.channel.sendMessage("Доступные настройки:\n• `set [роль]` - установить голосовую роль\n• `delete` - сбросить роль" + SPECIFIC_DONE ? SPECIFIC_CMD : "");
            return;
        }

        const ROLE_NOT_FOUND = ":warning: Роль с таким именем / ID не найдена на сервере.";
        const ERROR_HAPPENED = ":warning: Произошла ошибка.";
        const DATA_NOT_SAVED = ":warning: Невозможно сохранить новые данные.";

        if(cmd.startsWith("set ")) {
            // #SetGuildVoiceRole
            let resolvableRole = this.resolveRole(cmd.slice("set ".length), msg.guild);
            if(!resolvableRole) {
                msg.channel.sendMessage(ROLE_NOT_FOUND);
                return;
            }

            let row = await this.getGuildRow(msg.guild);

            if(!row) {
                msg.channel.sendMessage(ERROR_HAPPENED);
                return;
            }

            if(row.voice_role !== "-") {
                await this.VCR_Cleanup(msg.guild);
            }

            row.voice_role = resolvableRole.id;

            try {
                await this.updateGuildRow(row);
                msg.react("👍");
            } catch (err) {
                msg.channel.sendMessage(DATA_NOT_SAVED);
            }
            

            return;
        } else if(cmd === "set") {
            // #HelpSetGuildVoiceRole
            msg.channel.sendMessage("• `set [роль]` - установить 'голосовую роль'\n\t○ `роль` может быть названием реальной роли на сервере, её ID\n\t:warning: Голосовая роль на сервере может быть всего одна.");
            return;
        }

        if(cmd.startsWith("delete")) {
            // #DeleteGuildVoiceRole
            let resolvableRole = this.resolveRole(cmd.slice("delete ".length), msg.guild);
            if(!resolvableRole) {
                msg.channel.sendMessage(ROLE_NOT_FOUND);
                return;
            }

            let row = await this.getGuildRow(msg.guild);

            if(!row) {
                msg.channel.sendMessage(ERROR_HAPPENED);
                return;
            }

            if(row.voice_role !== "-") {
                await this.VCR_Cleanup(msg.guild);
            }

            row.voice_role = "-";

            try {
                await this.updateGuildRow(row);
                msg.react("👍");
            } catch (err) {
                msg.channel.sendMessage(DATA_NOT_SAVED);
            }
            
            return;
        } else if(cmd === "delete") {
            // #HelpDeleteGuildVoiceRole
            msg.channel.sendMessage("• `delete` - убрать 'голосовую роль'\n\t○ `роль` может быть названием реальной роли на сервере, её ID");
            return;
        }

        if(SPECIFIC_DONE) {
            const SPECIFIC_ARGS_DESCRIPTION = "\n\t○ `канал` может быть названием голосового канала, его ID\n\t○ `роль` может быть названием реальной роли на сервере, её ID";

            if(cmd.startsWith("specific set")) {
                //
            } else if(cmd === "specific set") {
                // #HelpSpecificSetGuildVoiceRole
                msg.channel.sendMessage("• `specific set [канал], [роль]` - установить специальную 'голосовую роль'" + SPECIFIC_ARGS_DESCRIPTION + "\n:warning: Канал может иметь только две специальные 'голосовые роли'!");
                return;
            }

            if(cmd.startsWith("specific delete")) {
                //
            } else if(cmd === "specific delete") {
                // #HelpSpecificDeleteGuildVoiceRole
                msg.channel.sendMessage("• `specific delete [канал], [роль]` - убрать специальную 'голосовую роль'" + SPECIFIC_ARGS_DESCRIPTION);
            }
        }


    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = VoiceRole;