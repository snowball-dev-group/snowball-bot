import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./Plugin";
import { Message } from "discord.js"; 
import { isOwner } from "./checks/commands";
import { commandRedirect, objectToMap, generateEmbed, EmbedType } from "./utils/utils";
import * as needle from "needle";

class OwnerCommands extends Plugin implements IModule {
    log:Function = logger("OwnerCMDs");

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    @isOwner
    async onMessage(msg:Message) {
        commandRedirect(msg.content, objectToMap<Function>({
            "!change_name": async (username) => {
                try {
                    let oldName = discordBot.user.username;
                    let newUser = await discordBot.user.setUsername(username);
                    msg.react("✅");
                    msg.channel.sendMessage(`✅ Имя успешно изменено с \`${oldName}\` на \`${newUser.username}\``);
                } catch (err) {
                    msg.react("🚫");
                    msg.channel.sendMessage(`🚫 Невозможно изменить имя: \`${err.message}\``);
                }
            },
            "!change_avy": async () => {
                try {
                    needle.get(msg.attachments.first().url, async (err, resp, body) => {
                        if(err) {
                            msg.channel.sendMessage("", generateEmbed(EmbedType.Error, `Ошибка обновления аватарки: \`${err.message}\``));;
                            return;
                        }
                        try {
                            let newUser = await discordBot.user.setAvatar(new Buffer(resp.body));
                            msg.channel.sendMessage("", generateEmbed(EmbedType.OK, "Аватарка бота успешно изменена:", newUser.avatarURL));
                        } catch (err) {
                            msg.channel.sendMessage("", generateEmbed(EmbedType.Error, `Ошибка обновления аватарки: \`${err.message}\``));
                        }
                    });
                } catch (err) {
                    this.log("err", "Error downloading avy");
                    msg.channel.sendMessage("", generateEmbed(EmbedType.Error, `Ошибка загрузки аватарки: \`${err.message}\``));
                }
            }
        }));
    }



    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = OwnerCommands;