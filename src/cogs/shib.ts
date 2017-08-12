import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { inChannel, shouldHaveAuthor } from "./checks/commands";

class SHIBCHANNEL extends Plugin implements IModule {

    constructor() {
        super({
            "message": (msg: Message) => this.onMessage(msg),
            "messageUpdate": (old, newMsg: Message) => this.onMessage(newMsg)
        });
    }

    @inChannel("300019335055802368")
    @shouldHaveAuthor
    async onMessage(msg: Message) {
        if(msg.author.id === "235849760253280257") { return; }
        if(msg.content !== "!shib" && msg.attachments.size < 1) { msg.delete(); }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = SHIBCHANNEL;