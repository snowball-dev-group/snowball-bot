import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Role } from "discord.js";
import { commandRedirect, objectToMap, EmbedType, generateEmbed, getLogger } from "./utils/utils";
import * as knex from "knex";
import { default as giveMeDbPls } from "./utils/db";
import { notByBot } from "./checks/commands";

class Guilds extends Plugin implements IModule { 
    db:knex = giveMeDbPls();
    prepared = false;
    guildPrefix = "[Гильдия] ";
    log = getLogger("Guilds");

    constructor() {
        super({
            "message": (msg) => this.messageHandler(msg)
        });
        this.prepare();
    }

    async prepare() {
        let status = await this.db.schema.hasTable("guilds");
        if(!status) {
            try {
                await this.db.schema.createTable("guilds", (tb) => {
                    tb.string("id").unique().notNullable().unique(); // guild id to simple requests on edits
                    tb.string("name").notNullable(); // name of guild
                    tb.string("description").notNullable(); // description of guild
                    tb.string("owner_id").notNullable(); // id of owner (Discord snowflake)
                    tb.string("server_id").notNullable(); // id of server where guild placed (Discord snowflake)
                    tb.string("role_id").notNullable(); // id of role for guild (Discord snoflake)
                    tb.string("customize").notNullable(); // json with preferences like logo and etc
                });
                this.log("ok", "Successfully prepared: DB schema was created");
                this.prepared = true;
                return true;
            } catch (err) {
                this.log("err", "Can't prepare module: DB schema can't be created:", err);
                this.prepared = false;
                return false;
            }
        } else {
            this.log("ok", "Successfully prepared: DB schema is already created!");
            this.prepared = true;
            return true;
        }
    }

    async unload() {
        this.log("info", "Guilds module says bye");
        this.prepared = false;
        this.unhandleEvents();
        return true;
    }

    /**
     * Gets called on every message, should do checks if guilds are disabled, command disabled
     * @param msg {Message} Original message
     */
    @notByBot
    messageHandler(msg:Message) {
        commandRedirect(msg.content, objectToMap<Function>({
            "!guild create": (args) => this.createGuild(msg, args),
            "!guild edit": (args) => this.editGuild(msg, args),
            "!guild info": (args) => this.printInfo(msg, args),
            "!guild list": (args) => this.printList(msg, args),
            "!guild": (args) => this.scanRedirect(msg, args)
        }));
    }

    /**
     * Creates guild in database & server
     * @param msg {Message} Original message
     * @param args {String} Arguments after command or command itself
     */
    async createGuild(msg:Message, args:string) {
        if(!this.prepared) { msg.channel.sendMessage("-.-"); return; }
        if(args === "!guild create") {
            msg.reply("", { 
                embed: generateEmbed(EmbedType.Error, "Невозможно создать гильдию", {
                    fields: [{
                        name: "Ошибка аргументации",
                        value: "Не предоставлены аргументы: владелец; название гильдии; описание"
                    }]
                })
            });
            return;
        }

        msg.channel.startTyping();

        let argsArray = args.split("|");
        let guildInfo = {
            name: argsArray[1],
            owner: msg.mentions.users.first().id,
            description: argsArray[2]
        };

        if(!guildInfo.name) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, `Не предоставлено имя гильдии!`) });
            return;
        } else if(guildInfo.name.length < 2) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, `Имя гильдии сильно маленькое.`) });
            return;
        } else if(guildInfo.name.length > 16) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, `Имя гильдии сильно большое.`) });
            return;
        }

        if(!guildInfo.description) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Не предоставлено описание гильдии!")});
            return;
        } else if(guildInfo.description.length < 6) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Описание гильдии сильно маленькое.")});
            return;
        } else if(guildInfo.description.length > 64) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Описание гильдии сильно большое.")});
            return;
        }

        if(!guildInfo.owner) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Владелец гильдии не предоставлен!")});
            return;
        } else if(!msg.guild.members.has(guildInfo.owner)) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Владелец гильдии не является участником сервера.")});
            return;
        }

        let guildRole:Role;
        try {
            guildRole = await msg.guild.createRole({
                name: `${this.guildPrefix} ${guildInfo.name}`,
                permissions: []
            });
        } catch (err) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, `Невозможно создать роль гильдии: \`${err.message}\``) });
            return;
        }

        try {
            await this.db.insert({
                id: Date.now().toString(36),
                name: guildInfo.name,
                description: guildInfo.description,
                owner_id: guildInfo.owner,
                server_id: msg.guild.id,
                role_id: guildRole.id,
                customize: "{}"
            });
        } catch (err) {
            msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, `Невозможно создать гильдию: \`${err.message}\``)});
            try {
                await guildRole.delete();
            } catch (err) {
                msg.channel.sendMessage("", {embed: generateEmbed(EmbedType.Error, "Роль гильдии не удалена...")});
            }
        }
    }

    /**
     * Edits guild in database & server
     * @param msg {Message} Original message
     * @param args {String} Arguments after command or command itself
     */
    async editGuild(msg:Message, args:string) {

    }

    async printList(msg:Message, args:string) {
        
    }

    /**
     * Prints information about guild
     * @param msg {Message} Original message
     * @param args {String} Arguments after command or command itself
     */
    async printInfo(msg:Message, args:string) {

    }

    /**
     * Scans call and redirects commands fine
     * @param msg {Message} Original message
     * @param args {String} Arguments after command or command itself
     */
    async scanRedirect(msg:Message, args:string) {

    }
}

module.exports = Guilds;