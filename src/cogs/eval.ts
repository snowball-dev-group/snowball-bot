import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./Plugin";
import { Message } from "discord.js";
import { Context } from "vm";
import { isOwner, command, CommandEquality as cmdEquality } from "./checks/commands";
import { stringifyError, replaceAll } from "./utils/utils";
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
    @command("!eval", cmdEquality.NotEqual)
    async onMessage(message:Message) {
        let afterCmd = message.content.slice("!eval ".length).trim();
        if(!afterCmd.startsWith(PREFIX) || !afterCmd.endsWith(PREFIX)) { return; }
        
        // Parsing our script
        let script = afterCmd.substring(PREFIX_LENGTH, afterCmd.length - PREFIX_LENGTH);
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
            await message.reply(":white_check_mark: **Executed:**\n```js\n"+ replaceAll(util.inspect(output, false), "`", "'") + "\n```");
        } catch (err) {
            await message.reply(":x: **Error:**\n```js\n" + replaceAll(stringifyError(err), "`", "'") + "\n```");
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = EvalJS;