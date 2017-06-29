import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { getHelp, command, Category } from "./utils/help";
import { generateEmbed, EmbedType } from "./utils/utils";
import { localizeForUser } from "./utils/ez-i18n";

@command(Category.Helpful, "sb_help", "loc:HELPFULCMD_CMDMETA_DESCRIPTION")
class HelpfulCommand extends Plugin implements IModule {

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    async onMessage(msg:Message) {
        if(msg.content !== "!sb_help") {
            return;
        }

        if(msg.channel.type !== "text" && msg.channel.type !== "dm") {
            return;
        }

        let infoMsg:Message|undefined = undefined;
        if(msg.channel.type !== "dm") {
            infoMsg = await msg.channel.send("", {
                embed: generateEmbed(EmbedType.Progress, await localizeForUser(msg.member, "HELPFULCMD_SENDINGTOPM"))
            }) as Message;
        }

        try {
            let hStr = await getHelp(msg);
            await msg.author.send(hStr, {
                split: true,
                code: "md"
            });
            if(infoMsg) {
                infoMsg = await infoMsg.edit("", {
                    embed: generateEmbed(EmbedType.OK, await localizeForUser(msg.member, "HELPFULCMD_SENTTOPM"))
                });
            }
        } catch (err) {
            if(infoMsg) {
                infoMsg = await infoMsg.edit("", {
                    embed: generateEmbed(EmbedType.Error, await localizeForUser(msg.member, "HELPFULCMD_ERRSENDING"))
                });
            }
        }

    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = HelpfulCommand;