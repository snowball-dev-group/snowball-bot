import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./Plugin";
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
    @command("!eval", undefined, cmdEquality.NotEqual, this.messageFallback)
    async onMessage(message:Message) {
        let afterCmd = message.content.slice("!eval ".length).trim();
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

            message.channel.sendMessage(undefined, {
                embed: generateEmbed(EmbedType.OK, "```js\n"+ replaceAll(util.inspect(output, false), "`", "'") + "\n```", {
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
            message.channel.sendMessage(undefined, {
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

    async fallback(msg:Message) {
        if(msg.content.startsWith("!eval ")) {
            msg.channel.sendMessage(undefined, {
                embed: generateEmbed(EmbedType.Error, "Arguments mismatch.", {
                    fields: [{
                        name: "Example",
                        value: "```!eval ``something`` ```"
                    }]
                })
            });
            return;
        } else if(msg.content === "!eval") {
            msg.channel.sendMessage(undefined, {
                embed: generateEmbed(EmbedType.Information, "To run this command provide code to eval. This command works only for bot owner.", undefined)
            });
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = EvalJS;