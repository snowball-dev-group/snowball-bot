import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./Plugin";
import { Message } from "discord.js"; 
import { command, CommandEquality as cq, notByBot } from "./checks/commands";

class EmbedME extends Plugin implements IModule {
    log:Function = logger("EmbedME");

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    @notByBot
    @command("!embed", cq.SemiEqual)
    async onMessage(msg:Message) {
        if(msg.content === "!embed") { 
            msg.channel.sendMessage(":warning: Используйте эту команду, чтобы встроить своё сообщение в `встраиваемый объект`. Это не работает с изображениями, видео. Поддерживает скрытые ссылки: `[имя](http://example.org/)`, а также смайлики с других серверов, но для этого используйте `<:Name:ID>` и оберните сообщение в блок кода");
            return;
        }
        let mContent = msg.content.slice("!embed ".length);
        if(mContent.startsWith("`") && mContent.endsWith("`")) {
            mContent = mContent.slice(1).substring(0, mContent.length - 2);
        }
        await msg.channel.sendMessage("", {
            embed: {
                author: {
                    icon_url: msg.author.avatarURL,
                    name: msg.member.displayName
                },
                description: mContent,
                timestamp: msg.createdAt,
                footer: {
                    icon_url: discordBot.user.avatarURL,
                    text: "Встроено " + discordBot.user.username
                }
            },
        });
        msg.delete();
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = EmbedME;