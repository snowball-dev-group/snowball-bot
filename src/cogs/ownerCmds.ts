import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./Plugin";
import { Message } from "discord.js"; 
import { isOwner } from "./checks/commands";
import { commandRedirect, objectToMap } from "./utils/utils";
import * as needle from "needle";

enum EmbedType {
    Error, OK
}

class OwnerCommands extends Plugin implements IModule {
    log:Function = logger("OwnerCMDs");

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    generateEmbed(type:EmbedType, description:string, imageUrl?:string) {
        return {
            description: description,
            image: imageUrl ? {
                url: imageUrl
            } : undefined,
            color: type === EmbedType.Error ? 0xe53935 : type === EmbedType.OK ? 0x43A047 : undefined,
            author: type === EmbedType.Error ? {
                name: "Ошибка",
                icon_url: "https://i.imgur.com/9IwsjHS.png"
            } : type === EmbedType.OK ? {
                name: "Успех!",
                icon_url: "https://i.imgur.com/FcnCpHL.png"
            } : undefined,
            footer: {
                text: discordBot.user.username
            }
        };
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
                            msg.channel.sendMessage("", this.generateEmbed(EmbedType.Error, `Ошибка обновления аватарки: \`${err.message}\``));;
                            return;
                        }
                        try {
                            let newUser = await discordBot.user.setAvatar(new Buffer(resp.body));
                            msg.channel.sendMessage("", this.generateEmbed(EmbedType.OK, "Аватарка бота успешно изменена:", newUser.avatarURL));
                        } catch (err) {
                            msg.channel.sendMessage("", this.generateEmbed(EmbedType.Error, `Ошибка обновления аватарки: \`${err.message}\``));
                        }
                    });
                } catch (err) {
                    this.log("err", "Error downloading avy");
                    msg.channel.sendMessage("", this.generateEmbed(EmbedType.Error, `Ошибка загрузки аватарки: \`${err.message}\``));
                }
            }
        }));
    }



    unload() {
        this.unhandleEvents();
        return new Promise<boolean>((res) => res(true));
    }
}

module.exports = OwnerCommands;