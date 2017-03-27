import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./Plugin";
import { Message } from "discord.js"; 
import { isOwner } from "./checks/commands";
import { commandRedirect, objectToMap } from "./utils/utils";
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
                            return msg.channel.sendMessage("", {
                                embed: {
                                    color: 0xe53935,
                                    author: {
                                        name: "Ошибка",
                                        icon_url: "https://i.imgur.com/9IwsjHS.png"
                                    },
                                    description: `Ошибка обновления аватарки: \`${err.message}\``,
                                    footer: {
                                        text: discordBot.user.username
                                    }
                                }
                            });
                        }
                        try {
                            let newUser = await discordBot.user.setAvatar(new Buffer(resp.body));
                            msg.channel.sendMessage("", {
                                embed: {
                                    color: 0x43A047,
                                    image: {
                                        url: newUser.displayAvatarURL
                                    },
                                    author: {
                                        name: "Успех!",
                                        icon_url: "https://i.imgur.com/FcnCpHL.png"
                                    },
                                    description: "Аватарка бота успешно изменена:",
                                    footer: {
                                        text: newUser.username
                                    }
                                }
                            });
                        } catch (err) {
                            msg.channel.sendMessage("", {
                                embed: {
                                    color: 0xe53935,
                                    author: {
                                        name: "Ошибка",
                                        icon_url: "https://i.imgur.com/9IwsjHS.png"
                                    },
                                    description: `Ошибка обновления аватарки: \`${err.message}\``,
                                    footer: {
                                        text: discordBot.user.username
                                    }
                                }
                            });
                        }
                    });
                } catch (err) {
                    this.log("err", "Error downloading avy");
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