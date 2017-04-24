import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { Context } from "vm";
import { isOwner, command, CommandEquality as cmdEquality } from "./checks/commands";
import { replaceAll, generateEmbed, EmbedType } from "./utils/utils";
import logger = require("loggy");
import util = require("util");
import VM = require("vm");

const PREFIX = "``";
const PREFIX_LENGTH = PREFIX.length;

class EvalJS extends Plugin implements IModule {
    log:Function = logger("EvalJS");

    constructor() {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        });
    }

    safeEval(script:string, context:Context) {
        let s = new VM.Script(script);
        let c = VM.createContext(context);
        return s.runInContext(c, {
            timeout: 5000,
            displayErrors: true
        });
    }

    /**
     * Making our function a bit safe
     * @param cb Function that will be called
     */
    makeSafe(cb) {
        return () => {
            try {
                cb();
            } catch (err) {
                this.log("err", "Safe function calling thrown an error", err);
            }
        };
    }

    @isOwner
    @command("!eval", ["!e", "!ev"], cmdEquality.NotEqual)
    async onMessage(message:Message, usedPrefix?:string) {
        let afterCmd = message.content.slice(`${usedPrefix} `.length).trim();
        if(!afterCmd.startsWith(PREFIX) || !afterCmd.endsWith(PREFIX)) { return; }
        
        // Parsing our script
        let script = afterCmd.substring(PREFIX_LENGTH, afterCmd.length - PREFIX_LENGTH);
        let startTime = Date.now();
        try {
            // Trying to run it
            // Actually, it named `safeEval` but it's absolutely not safe
            // For example, if you set timer and throw error there
            
            let output = this.safeEval(script, {
                ...global,
                this: this,
                $bot: discordBot,
                $msg: message,
                setTimeout: (handler, ms) => setTimeout(this.makeSafe(handler), ms),
                setInterval: (handler, ms) => setInterval(this.makeSafe(handler), ms),
            });
            let diff = Date.now() - startTime;
            
            let outputMsg:Message;
            try {
                outputMsg = await message.channel.sendMessage("", {
                    embed: generateEmbed(EmbedType.Information, "Generating output. Please, wait...", {
                        informationTitle: "Busy"
                    })
                }) as Message;
            } catch (err) {
                this.log("Can't send message with output:", err);
                return;
            }

            let depth = 5;
            let outputInsp:string = replaceAll(util.inspect(output, false, depth), "`", "'");
            while(outputInsp.length > 2000 && depth > 0) {
                outputInsp = replaceAll(util.inspect(output, false, --depth), "`", "'");
            }

            if(depth === 0 || outputInsp.length > 2000) {
                outputMsg.edit(undefined, {
                    embed: generateEmbed(EmbedType.Error, "Can't send output, it's longer than 2000 chars", {
                        errorTitle: "There's an error"
                    })
                });
                return;
            }

            outputMsg.edit(undefined, {
                embed: generateEmbed(EmbedType.OK, "```js\n"+ outputInsp + "\n```", {
                    okTitle: "Executed",
                    fields: [{
                        inline: false,
                        name: "Time spent",
                        value: `${diff}ms`
                    }]
                })
            });
        } catch (err) {
            let diff = Date.now() - startTime;
            message.channel.sendMessage("", {
                embed: generateEmbed(EmbedType.Error, "\n```js\n" + replaceAll(util.inspect(err), "`", "'") + "\n```", {
                    errorTitle: "Fault.",
                    fields: [{
                        inline: false,
                        name: "Time spent",
                        value: `${diff}ms`
                    }]
                })
            });
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = EvalJS;