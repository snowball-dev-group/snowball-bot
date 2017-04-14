import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, TextChannel, GuildMember } from "discord.js"; 
import { inChannel, shouldHaveAuthor } from "./checks/commands";
import { default as _getDB } from "./db";
import * as knex from "knex";
import { convertNumbers } from "./utils/letters";
import * as Random from "random-js";
import { generateEmbed, EmbedType, getLogger, escapeDiscordMarkdown } from "./utils/utils";

let DBInitializationState = {
    NotInitialized: 0,
    MainTableInitialized: 1,
    ScoreboardInitialized: 2,
    FullyInitialized: 1 | 2
};

enum XPOperation {
    DoNotChange = 0,
    Raise = 1,
    Lower = 2
}

interface CountOperationRow {
    count:Number;
    author:string;
    date:string;
    operation:"-"|"+";
    number:string;
}

interface ScoreboardUserRow {
    user:string;
    exp:number;
    streak:number;
}

interface ScoreboardUserUpdateInfo {
    user:string;
    addition:number;
    xp:number;
    streak:number;
    member:GuildMember;
    operation:XPOperation;
}

const TABLENAME_MAIN = "countv2";
const TABLENAME_SCOREBOARD = TABLENAME_MAIN + "_scoreboard";
const CHANNELID_MAIN = "302128461600784384";
const CHANNELID_SCOREBOARD = "302129535913164803";
const POINTS_GAIN = 2;
const POINTS_RAISED = 1;
const POINTS_LOWERED = 2;

const STRINGS = {
    TOP_10: "🏆 Топ-10",
    LATEST_CHANGES: "📈 Последние изменения"
};


class CountV2 extends Plugin implements IModule {
    log:Function = getLogger("CountV2Channel");
    dbClient:knex;
    countRegex:RegExp;
    dbInitialized:number = DBInitializationState.NotInitialized;
    scoreboardMessages: {
        top10?: Message,
        latestChanges?: Message
    } = {
        top10: undefined,
        latestChanges: undefined
    };
    latestScoreboardUpdate = new Date();

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
        this.dbClient = _getDB();

        this.dbClient.schema.hasTable(TABLENAME_MAIN).then(itHas => {
            if(itHas) {
                this.log("ok", `DB: we have table '${TABLENAME_MAIN}', can safely continue work...`);
                this.dbInitialized = this.dbInitialized | DBInitializationState.MainTableInitialized;
                return;
            }
            this.log("warn", `DB: seems we doesn't have table '${TABLENAME_MAIN}' in database, going to create it right now`);
            this.dbClient.schema.createTable(TABLENAME_MAIN, (tb) => {
                tb.integer("count").notNullable();
                tb.string("author").notNullable();
                tb.string("date").notNullable();
                tb.string("operation").notNullable();
                tb.string("number").notNullable(); // next number
            }).catch(err => {
                this.log("err", "DB: we can't prepare DB", err);
            }).then(() => {
                this.log("ok", "DB: we successfully prepared our DB and checking for existing elements");
                // this.dbInitialized = this.dbInitialized | DBInitializationState.MainTableInitialized;
                this.dbClient(TABLENAME_MAIN).first().then((elem) => {
                    if(!elem) {
                        this.firstTime();
                    }
                });
            });
        });

        this.dbClient.schema.hasTable(TABLENAME_SCOREBOARD).then(itHas => {
            if(itHas) {
                this.log("ok", `DB: we have table '${TABLENAME_SCOREBOARD}', can safely continue working with players scores`);
                this.dbInitialized = this.dbInitialized | DBInitializationState.ScoreboardInitialized;
                return;
            }
            this.log("warn", `DB: seems we don't have table '${TABLENAME_SCOREBOARD}' in database, going to create it right now`);
            this.dbClient.schema.createTable(TABLENAME_SCOREBOARD, (tb) => {
                tb.string("user").notNullable();
                tb.integer("exp").notNullable();
                tb.integer("streak").notNullable(); 
            }).catch(err => {
                this.log("err", "DB: we can't prepare DB", err);
            }).then(() => {
                this.log("ok", "DB: we successfully prepared our scoreboard table");
                this.dbInitialized = this.dbInitialized | DBInitializationState.ScoreboardInitialized;
            });
        });

        this.countRegex = /^\d{0,}$/i;

        let cid; let runs = 0;
        cid = setInterval(() => {
            runs++;
            if(this.dbInitialized === DBInitializationState.FullyInitialized) {
                this.log("ok", "DB is initialized");
                clearInterval(cid);
            } else {
                if(runs >= 10) {
                    clearInterval(cid);
                    this.log("err", "Timeout: waiting for DB initialization");
                }
                return;
            }
            this.log("info", "Updating scoreboard messages");
            this.updateScoreboardMessages();
        }, 1000);
    }

    async firstTime() {
        let elem = {
            date: Date.now(),
            count: 1322,
            number: 1337,
            author: botConfig.botOwner,
            operation: "+"
        };

        let ch:TextChannel;
        if(!(ch = discordBot.channels.get(CHANNELID_MAIN) as TextChannel)) {
            return false;
        }

        try {
            await this.dbClient(TABLENAME_MAIN).insert(elem);
        } catch (err) {
            this.log("err", "First start: Can't but element into database", err);
        }
        
        ch.sendMessage("**Первый запуск!**\n__Число__: 1322.\n__Далее__: **+15**");
    }

    @inChannel(CHANNELID_MAIN)
    @shouldHaveAuthor
    async onMessage(msg:Message) {
        if(this.dbInitialized !== DBInitializationState.FullyInitialized) { return; }
        if(msg.channel.type === "dm") { return; } // never reply in direct messages
        if(!msg.content) { msg.delete(); return; }
        if(msg.author.id === discordBot.user.id) { return; }

        let override = msg.content.startsWith("!");
        if(!this.countRegex.test(override ? msg.content.slice(1) : msg.content)) { msg.delete(); return; }
        
        if(override) {
            // TODO: Override function
            msg.delete();
            return;
        }

        let nNumber = parseInt(msg.content, 10);

        let latestRow:CountOperationRow|undefined = undefined;
        try {
            latestRow = await this.dbClient(TABLENAME_MAIN).orderBy("date", "DESC").first('count', 'author', 'date', 'operation', 'number');
        } catch (err) {
            this.log("err", "Can't get latest row from database", err);
            latestRow = undefined;
        }
        
        if(!latestRow) { return; }
        
        let rRowNumber = parseInt(latestRow.number, 10);

        if(nNumber !== rRowNumber) {
            msg.delete();
            let r = await this.giveXP(msg.member, XPOperation.Lower);
            if(!r) {
                this.log("warn", "Invalid result returned by XP giving function, not updating scoreboard...");
            } else {
                await this.updateScoreboardMessages(r);
            }
            return;
        }

        let operation = "+";

        let random = new Random(Random.engines.mt19937().autoSeed());
        
        operation = random.pick(["+", "-"]);

        let nextNumber = rRowNumber;
        let diffNumber = random.integer(1, 50);

        nextNumber += operation === "+" ? diffNumber : -Math.abs(diffNumber);


        let r = await this.giveXP(msg.member, XPOperation.Raise);
        
        if(!r) {
            this.log("warn", "Invalid result returned by XP giving function, not updating scoreboard");
            return;
        }

        try {
            await msg.channel.sendMessage(`✅ **Правильное число: ${rRowNumber}**.\nДалее: **${operation}** ${diffNumber}`);
        } catch (err) {
            msg.delete();
            this.log('warn', "Can't send message", err);
            return;
        }

        try {
            await this.dbClient(TABLENAME_MAIN).insert({
                date: Date.now(),
                count: rRowNumber,
                number: nextNumber,
                author: msg.author.id,
                operation
            });
        } catch (err) {
            this.log("err", "Can't put element into database", err);
            await msg.react("😦");
            msg.author.sendMessage("😦 Прости, в настоящий момент возникли неполадки с базой данных");
            return;
        }

        await this.updateScoreboardMessages(r);
    }

    async giveXP(member:GuildMember, xpOperation:XPOperation) : Promise<ScoreboardUserUpdateInfo|undefined> {
        let userRow:ScoreboardUserRow|undefined = undefined;

        try {
            userRow = await this.dbClient(TABLENAME_SCOREBOARD).where({
                user: member.id
            }).first('user', 'exp', 'streak');
        } catch (err) {
            this.log("warn", "Can't poll user out'a DB");
            userRow = undefined;
        }

        if(!userRow) {
            userRow = {
                user: member.id,
                exp: 0,
                streak: 0
            };
            try {
                await this.dbClient(TABLENAME_SCOREBOARD).insert(userRow);
            } catch (err) {
                this.log("err", "Can't insert new user row to database", err);
                return undefined;
            }
        }

        if(!userRow) {
            return undefined;
        }

        if(xpOperation === XPOperation.DoNotChange) {
            return {
                user: userRow.user,
                addition: 0,
                xp: userRow.exp,
                streak: userRow.streak,
                member: member,
                operation: xpOperation
            };
        } else {
            if(userRow.streak < 0 && xpOperation === XPOperation.Raise) {
                userRow.streak = -1;
            } else if(userRow.streak > 0 && xpOperation === XPOperation.Lower) {
                userRow.streak = 1;
            }

            userRow.streak += (xpOperation === XPOperation.Lower ? -1 : 1);
            
            let pointsGain = userRow.streak * POINTS_GAIN;

            userRow.exp += xpOperation === XPOperation.Lower ? -Math.abs(POINTS_LOWERED) : POINTS_RAISED;
            userRow.exp += pointsGain;

            try {
                await this.dbClient(TABLENAME_SCOREBOARD).where({
                    user: userRow.user
                }).update(userRow);
            } catch (err) {
                this.log("err", "Can't update element in database");
                return undefined;
            }

            return {
                user: userRow.user,
                addition: pointsGain,
                xp: userRow.exp,
                streak: userRow.streak,
                member: member,
                operation: xpOperation
            };
        }
    }

    async newScoreboardMessage() {
        if(!discordBot.channels.has(CHANNELID_SCOREBOARD)) {
            throw new Error("Scoreboard channel not found");
        }
        let ch = discordBot.channels.get(CHANNELID_SCOREBOARD) as TextChannel;

        let messages = await ch.fetchMessages();
        messages.forEach((message) => {
            if(message.embeds.length === 0 && message.author.id !== botConfig.botOwner) {
                message.delete();
                return;
            }
            let puprose = message.embeds[0].footer.text;
            switch(puprose) {
                case STRINGS.TOP_10: {
                    this.scoreboardMessages.top10 = message;
                } break;
                case STRINGS.LATEST_CHANGES: {
                    this.scoreboardMessages.latestChanges = message;
                } break;
                default: break;
            }
        });

        if(!this.scoreboardMessages.top10) {
            let msg = await ch.sendMessage(undefined, {
                embed: generateEmbed(EmbedType.Empty, "**Загрузка...**", {
                    footerText: STRINGS.TOP_10
                })
            }) as Message;
            this.scoreboardMessages.top10 = msg;
        }

        if(!this.scoreboardMessages.latestChanges) {
            let msg = await ch.sendMessage(undefined, {
                embed: generateEmbed(EmbedType.Empty, "**Загрузка...**", {
                    footerText: STRINGS.LATEST_CHANGES 
                })
            }) as Message;
            this.scoreboardMessages.latestChanges = msg;
        }
    }

    async updateScoreboardMessages(playerUpdate?:ScoreboardUserUpdateInfo) {
        if(!this.scoreboardMessages.latestChanges || !this.scoreboardMessages.top10) {
            try {
                this.log("info", "Probably cache was purged or plugin just started working, fetching messages from channel...");
                await this.newScoreboardMessage();
            } catch (err) {
                this.log("err", "Can't update scoreboard messages, can't update scoreboard.", err);
                return;
            }
        }

        if(this.scoreboardMessages.latestChanges && playerUpdate) {
            let lines = this.scoreboardMessages.latestChanges.embeds[0].description.split("\n").filter(l => l!=="**Загрузка...**");
            if(lines.length === 10) {
                lines.splice(0, 1); // adding one line
            }

            // sorry, sorry... i'm sorry: 
            // https://hydra-media.cursecdn.com/overwatch.gamepedia.com/e/e4/Mei_-_Sorry%2C_Sorry%2C_I%27m_Sorry_Sorry.mp3
            let newLine = `${playerUpdate.operation === XPOperation.Lower ? "🔻" : "🔺"} **${escapeDiscordMarkdown(playerUpdate.member.displayName, true)}**: ${playerUpdate.operation === XPOperation.Lower ? -Math.abs(POINTS_LOWERED) : POINTS_RAISED} ${playerUpdate.streak !== 0 ? `(${playerUpdate.addition} (${playerUpdate.streak > 0 ? "**бонус за правильные ответы**" : "**штраф за неправильные ответы**"}))` : ""}`;

            lines.push(newLine);

            let embed:any = {};
            embed.description = lines.join("\n");
            embed.footer = { text: STRINGS.LATEST_CHANGES };

            await this.scoreboardMessages.latestChanges.edit("", {
                embed: embed
            });
        }

        if(this.scoreboardMessages.top10) {
            let top10:ScoreboardUserRow[];
            try {
                top10 = await this.dbClient(TABLENAME_SCOREBOARD).orderBy("exp", "DESC").limit(10);
            } catch (err) {
                this.log("err", "Can't get top 10 from database");
                return;
            }

            let lines:string[] = [];
            top10.forEach((row, index) => {
                if(row.exp < 10) { return; }
                index = index + 1;
                let str = index === 1 ? "🥇" : index === 2 ? "🥈" : index === 3 ? "🥉" : `**\`${index}.\`**`;
                if(!this.scoreboardMessages.top10) {
                    str += ` ??? **-** ${row.exp} очков`;
                } else {
                    let member:GuildMember|undefined;
                    if(!(member = this.scoreboardMessages.top10.guild.members.get(row.user))) {
                        str += ` ??? **-** ${row.exp} очков`;
                    } else {
                        str += ` ${escapeDiscordMarkdown(member.displayName, true)} **-** ${row.exp} очков`;
                    }
                }
                lines.push(str);
            });

            let embed:any = {};
            embed.description = lines.join("\n");
            embed.footer = { text: STRINGS.TOP_10 };

            await this.scoreboardMessages.top10.edit("", {
                embed: embed
            });
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = CountV2;