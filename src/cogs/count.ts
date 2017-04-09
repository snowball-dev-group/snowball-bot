import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./plugin";
import { Message } from "discord.js"; 
import { inChannel, shouldHaveAuthor } from "./checks/commands";
import * as knex from "knex";

class Count extends Plugin implements IModule {
    log:Function = logger("CountChannel");
    dbClient:knex;
    countRegex:RegExp;
    dbInitialized:boolean = false;

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
        this.dbClient = knex({
            client: 'sqlite3',
            connection: {
                filename: __dirname + "/../data/count.sqlite"
            }
        });

        this.dbClient.schema.createTableIfNotExists("count", (tb) => {
            tb.integer("count");
            tb.string("author");
            tb.string("date");
        }).catch((err) => {
            this.log("err", "Can't create table: ", err);
        });

        setTimeout(() => {
            this.dbClient.schema.hasTable("count").then((hasOrNot) => {
                if(hasOrNot) { this.dbInitialized = true; this.log("ok", "DB initialized"); }
                else { this.log("err", "Can't initalize db"); }
            });
        }, 2000);

        this.countRegex = /^\d{0,}$/i;
    }

    @inChannel("295643316610007050")
    @shouldHaveAuthor
    async onMessage(msg:Message) {
        if(!this.dbInitialized) { return; }
        if(msg.channel.type === "dm") { return; }
        if(!msg.content) { msg.delete(); return; }
        let override = msg.content.startsWith("!");
        if(!this.countRegex.test(override ? msg.content.slice(1) : msg.content)) { msg.delete(); return; }
        
        if(override) {
            if(msg.author.id === botConfig.botOwner) {
                let mNumber = parseInt(msg.content.slice(1), 10);
                if(isNaN(mNumber)) { msg.delete(); return; }
                await this.dbClient("count").insert({
                    author: msg.author.id,
                    count: mNumber,
                    date: Date.now() + ""
                });
                return;
            } else {
                msg.delete();
                return;
            }
        }

        let row = await this.dbClient("count").orderBy("count", "DESC").first('count', 'author', 'date');

        if(!row) { this.log("err", "Not found element"); return; }

        let rowDate = parseInt(row.date, 10);

        if(row.author === msg.author.id && ((Date.now() - rowDate) / 1000) < 180) { msg.delete(); return; }

        let mNumber = parseInt(msg.content, 10);
        if(isNaN(mNumber)) { msg.delete(); return; }

        if((row.count + 1) !== mNumber) {
            msg.delete();
            return;
        }

        await this.dbClient("count").insert({
            author: msg.author.id,
            count: mNumber,
            date: Date.now() + ""
        });

        if(Math.floor(Math.random() * 6) > 4 && row.author !== msg.client.user.id) {
            msg.channel.sendMessage(mNumber+1);
        }
    }

    unload() {
        this.unhandleEvents();
        return new Promise<boolean>((res) => res(true));
    }
}

module.exports = Count;