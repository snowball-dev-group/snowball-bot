import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { command as docCmd, Category } from "./utils/help";
import { localizeForUser } from "./utils/ez-i18n";
import { getLogger } from "./utils/utils";

@docCmd(Category.Helpful, "embed", "loc:EMBEDME_CMDMETA_DESCRIPTION", {
    "loc:PROFILES_META_SETBIO_ARG0": {
        optional: false,
        description: "loc:EMBEDME_CMDMETA_ARG_DESCRIPTION"
    }
})
class EmbedME extends Plugin implements IModule {
    log = getLogger("EmbedME");

    constructor() {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        });
    }

    async onMessage(msg: Message) {
        if(msg.author && msg.author.bot) { return; }
        if(!msg.content.startsWith("!embed")) { return; }
        if(msg.content === "!embed") {
            let str = await localizeForUser(msg.member, "EMBEDME_INFO");
            msg.channel.send(`:information_source: ${str}`);
            return;
        }
        let mContent = msg.content.slice("!embed ".length);
        if(mContent.startsWith("`") && mContent.endsWith("`")) {
            mContent = mContent.slice(1).substring(0, mContent.length - 2);
        }
        await msg.channel.send("", {
            embed: {
                author: {
                    icon_url: msg.author.avatarURL,
                    name: msg.member ? msg.member.displayName : msg.author.username
                },
                description: mContent,
                timestamp: msg.createdAt,
                footer: {
                    icon_url: discordBot.user.displayAvatarURL,
                    text: await localizeForUser(msg.member, "EMBEDME_EMBED", {
                        botName: discordBot.user.username
                    })
                }
            },
        });
        if(msg.channel.type === "text") {
            msg.delete();
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = EmbedME;