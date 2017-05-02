import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js"; 
import { getHelp, command, Category } from "./utils/help";

@command(Category.Helpful, "sb_help", "Отправляет справку по всем командам Snowball")
class HelpfulCommand extends Plugin implements IModule {

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    async onMessage(msg:Message) {
        if(msg.channel.type !== "text") {
            return;
        }

        if(msg.content !== "!sb_help") {
            return;
        }

        await msg.channel.send(getHelp(), {
            split: true,
            code: "md"
        });
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = HelpfulCommand;