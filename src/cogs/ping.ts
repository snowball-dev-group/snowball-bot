import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./Plugin";
import { Message } from "discord.js"; 
import { command } from "./checks/commands";

class Ping extends Plugin implements IModule {
    log:Function = logger("PingJS");

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    @command("!ping")
    async onMessage(msg:Message) {
        await msg.react("🏃");
        let startDate = Date.now();
        msg = await msg.channel.sendMessage(":information_source: Pong!");
        let diff = Date.now() - startDate;
        this.log("info", `Ping for sendMessage to Channel#${msg.channel.id}: ${diff}ms`);
        msg.edit(`:information_source: Pong - \`${diff}ms\`!`);
    }

    unload() {
        this.unhandleEvents();
        return new Promise<boolean>((res) => res(true));
    }
}

module.exports = Ping;