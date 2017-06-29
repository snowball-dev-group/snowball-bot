import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js"; 
import { command, Category, IArgumentInfo } from "./utils/help";
import { init, checkPremium, givePremium, deletePremium, isPremium as isPremiumUser } from "./utils/premium";
import { getLogger, generateEmbed, EmbedType, escapeDiscordMarkdown } from "./utils/utils";
import { createConfirmationMessage } from "./utils/interactive";
import * as timestring from "timestring";
import * as moment from "moment-timezone";
import * as humanizeDuration from "humanize-duration";

const PREMIUMCTRL_PREFIX = `!premiumctl`;

let whoCan = [botConfig.botOwner];

function isAdm(msg:Message) {
    return isChat(msg) && whoCan.indexOf(msg.author.id) !== -1;
}

function isChat(msg:Message) {
    return msg.channel.type === "text";
}

interface IPlgCfg {
    whoCanGive:string[];
}

@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} checkout`, "Проверяет статус подписки", new Map<string, IArgumentInfo>([
    ["упоминание", {
        optional: true,
        description: "упоминание человека, чью подписку требуется проверить",
        specialCheck: isAdm
    }]
]), isChat)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} give`, "Выдает подписку", new Map<string, IArgumentInfo>([
    ["упоминание", {
        optional: false,
        description: "упоминание человека, кому нужно выдать подписку"
    }],
    [", срок подписки", {
        optional: false,
        description: "время, на которое подписка будет выдана"
    }]
]), isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} renew`, "Продлевает подписку", new Map<string, IArgumentInfo>([
    ["упоминание", {
        optional: false,
        description: "упоминание человека, кому нужно продлить подписку"
    }],
    [", срок продления", {
        optional: false,
        description: "время, на которое подписка будет продлена подписка"
    }]
]), isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} delete`, "Обнуляет подписку", new Map<string, IArgumentInfo>([
    ["упоминание", {
        optional: false,
        description: "упоминание человека, чью подписку требуется обнулить"
    }]
]), isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} resync`, "Запускает синхронизацию Premium ролей на всех серверах", undefined, isAdm)
class PremiumControl extends Plugin implements IModule {
    log = getLogger("PremiumControl");

    constructor(cfg) {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        }, true);

        if(cfg) {
            (cfg as IPlgCfg).whoCanGive.forEach(w => whoCan.push(w));
        }

        this.init();
    }

    // ================================
    // MESSAGE HANDLING
    // ================================

    async onMessage(msg:Message) {
        if(msg.channel.type !== "text") { return; }
        if(!msg.content || !msg.content.startsWith(PREMIUMCTRL_PREFIX)) { return; }
        let args = msg.content.split(" ");
        if(args.length === 1 && args[0] === PREMIUMCTRL_PREFIX) {
            return;
        }
        args.shift();
        try {
            switch(args.shift()) {
                // give <#12345678901234>, 1mth
                case "give": return await this.givePremium(msg, args);
                // remove <#12345678901234>
                case "remove": return await this.removePremium(msg, args);
                // renew <#12345678901234>, 1mth
                case "renew": return await this.renewPremium(msg, args);
                // checkout <#12345678901234>
                case "checkout": return await this.checkoutPremium(msg, args);
                // resync
                case "resync": return await this.runResync(msg);
            }
        } catch (err) {
            this.log("err", "Error due running command `", msg.content + "`:", err);
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "Ошибка запуска команды.")
            });
        }
    }

    // ================================
    // MAIN COMMANDS
    // ================================

    async runResync(msg:Message) {
        let _pgMsg = (await msg.channel.send("", {
            embed: generateEmbed(EmbedType.Progress, "Синхронизация...")
        })) as Message;
        await this.performGuildsSync();
        _pgMsg.edit("", {
            embed: generateEmbed(EmbedType.OK, "Синхронизация завершена")
        });
    }

    async givePremium(msg:Message, args:string[], internalCall = false) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "У Вас нет прав на использование этой команды")
            });
            return;
        }
        // args: ["<#12345678901234>,", "1mth"]
        if(!internalCall) {
            args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
            if(args.length !== 2) {
                msg.channel.send("", {
                    embed: generateEmbed(EmbedType.Information, `Правильный вызов этой команды: \`${PREMIUMCTRL_PREFIX} give [упоминание], [время]\``)
                });
                return;
            }
            if(msg.mentions.users.size !== 1) {
                msg.channel.send("", {
                    embed: generateEmbed(EmbedType.Error, "Пользователи упомянуты неправильно")
                });
                return;
            }
        }

        let subscriber = msg.mentions.users.first();
        let currentPremium = await checkPremium(subscriber);
        if(currentPremium) {
            let dtString = moment(currentPremium.due_to, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
            let confirmation = await createConfirmationMessage(generateEmbed(EmbedType.Question, `Настоящий пользователь уже является премиальным подписчиком до ${dtString}. Вы действительно хотите заменить премиум? Вы можете продлить его подписку используя \`${PREMIUMCTRL_PREFIX} renew [упоминание], [время]\``), msg);
            if(!confirmation) { 
                msg.channel.send("", {
                    embed: generateEmbed(EmbedType.Error, "Операция отменена")
                });
                return;
            }
        }

        let cDate = new Date(Date.now() + (timestring(args[1]) * 1000));
        let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let confirmation = await createConfirmationMessage(generateEmbed(EmbedType.Question, `Вы действительно хотите выдать **${escapeDiscordMarkdown(subscriber.username)}** подписку до ${dtString}?`), msg);
        if(!confirmation) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.OK, "Операция отменена")
            });
            return;
        }

        let _cMsg = (await msg.channel.send("", {
            embed: generateEmbed(EmbedType.Progress, "Выдача премиальной подписки, ожидайте...")
        })) as Message;

        let complete = await givePremium(subscriber, cDate, true);

        if(!complete) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Выдача премиальной подписки безуспешна. Изучите консоль разработчика для получения подробных сведений")
            });
            return;
        }

        await _cMsg.edit("", {
            embed: generateEmbed(EmbedType.Progress, "Получено успешное сообщение, запрашиваю данные о подписке...")
        });

        currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Неизвестная ошибка сервера, премиальная подписка не выдана или истекла за момент обращения")
            });
            return;
        }

        dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
        msgStr += `Подписка выполнена: ${dtSubString}\n`;
        msgStr += `Действительна до: ${dtString}`;

        await _cMsg.edit("", {
            embed: generateEmbed(EmbedType.Progress, "Пожалуйста, изучите данные подписки и подтвердите")
        });
        confirmation = await createConfirmationMessage(generateEmbed(EmbedType.Information, msgStr), msg);
        if(!confirmation) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Что-то пошло не так...")
            });
            return;
        }
        _cMsg.edit("", {
            embed: generateEmbed(EmbedType.OK, "Подписка выполнена!")
        });
    }

    async renewPremium(msg:Message, args:string[]) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "У Вас нет прав на использование этой команды")
            });
            return;
        }
        // args: ["<#12345678901234>,", "1mth"]
        args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
        if(args.length !== 2) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, `Правильный вызов этой команды: \`${PREMIUMCTRL_PREFIX} give [упоминание], [время]\``)
            });
            return;
        }
        if(msg.mentions.users.size !== 1) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "Пользователи упомянуты неправильно")
            });
            return;
        }

        let subscriber = msg.mentions.users.first();
        let currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            let _redirectMsg = await (msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, "Пользователь не является подписчиком, перенаправление...")
            })) as Message;
            setTimeout(() => _redirectMsg.delete(), 5000);
            await this.givePremium(msg, args, true);
            return;
        }

        let cDate = new Date(currentPremium.due_to.getTime() + (timestring(args[1]) * 1000));
        let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let confirmation = await createConfirmationMessage(generateEmbed(EmbedType.Question, `Вы действительно хотите продлить премиальную подписку **${escapeDiscordMarkdown(subscriber.username)}** до ${dtString}?`), msg);
        if(!confirmation) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.OK, "Операция отменена")
            });
            return;
        }

        let complete = false;
        try {
            complete = await givePremium(subscriber, cDate, false);
        } catch (err) {
            if((err as Error).name === "ERR_PREMIUM_DIFFLOW") {
                msg.channel.send("", {
                    embed: generateEmbed(EmbedType.Error, "Невозможно продлить подписку: разница меньше 0")
                });
            }
            return;
        }

        let _cMsg = (await msg.channel.send("", {
            embed: generateEmbed(EmbedType.Progress, "Продление премиальной подписки...")
        })) as Message;

        if(!complete) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Продление премиальной подписки безуспешно. Изучите консоль разработчика для получения подробных сведений")
            });
            return;
        }

        await _cMsg.edit("", {
            embed: generateEmbed(EmbedType.Progress, "Получено успешное сообщение, запрашиваю данные о подписке...")
        });

        currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Неизвестная ошибка сервера, премиальная подписка не выдана или истекла за момент обращения")
            });
            return;
        }

        dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
        msgStr += `Подписка выполнена: ${dtSubString}\n`;
        msgStr += `Действительна до: ${dtString}`;

        await _cMsg.edit("", {
            embed: generateEmbed(EmbedType.Progress, "Пожалуйста, изучите данные подписки и подтвердите")
        });
        confirmation = await createConfirmationMessage(generateEmbed(EmbedType.Information, msgStr), msg);
        if(!confirmation) {
            _cMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Что-то пошло не так...")
            });
            return;
        }
        _cMsg.edit("", {
            embed: generateEmbed(EmbedType.OK, "Подписка продлена!")
        });
    }

    async checkoutPremium(msg:Message, args:string[]) {
        if(isAdm(msg) && msg.mentions.users.size > 1) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, "Вы должны упомянуть одного пользователя, чью подписку Вы хотите проверить, либо не упомянать никого, если хотите проверить статус своей подписки.")
            });
            return;
        } else if(!isAdm(msg) && msg.mentions.users.size !== 0) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, "У Вас нет права проверять чужие подписки")
            });
            return;
        }

        let subscriber = msg.mentions.users.size === 0 ? msg.author : msg.mentions.users.first();

        let currentPremium = await checkPremium(subscriber);

        if(!currentPremium) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "Данный пользователь не является премиальным подписчиком")
            });
            return;
        }

        let dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let durString = this.humanize(currentPremium.due_to.getTime() - Date.now());

        let msgStr = "";
        msgStr += `Подписка выполнена: ${dtSubString}\n`;
        msgStr += `Действительна до: ${dtString}\n`;
        msgStr += `Осталось: ${durString}`;

        msg.channel.send("", {
            embed: generateEmbed(EmbedType.Information, msgStr, {
                author: {
                    name: subscriber.tag
                }
            })
        });
    }

    async removePremium(msg:Message, args:string[]) {
        if(!isAdm(msg)) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Error, "У Вас нет прав на использование этой команды")
            });
            return;
        }
        if(msg.mentions.users.size !== 1) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, "Вы должны упомянуть одного пользователя, чью подписку Вы хотите проверить")
            });
            return;
        }

        let subscriber = msg.mentions.users.first();

        let currentPremium = await checkPremium(subscriber);
        if(!currentPremium) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.Information, "Пользователь не имеет премиальной подписки")
            });
            return;
        }

        let dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
        let durString = this.humanize(currentPremium.due_to.getTime() - Date.now());

        let sep = "----------------";
        let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n${sep}\n`;
        msgStr += `Подписка выполнена: ${dtSubString}\n`;
        msgStr += `Действительна до: ${dtString}\n`;
        msgStr += `Осталось: ${durString}\n`;
        msgStr += `${sep}\nВы действительно хотите удалить подписку?`;

        let confirmation = await createConfirmationMessage(generateEmbed(EmbedType.OK, msgStr), msg);

        if(!confirmation) {
            msg.channel.send("", {
                embed: generateEmbed(EmbedType.OK, "Операция отменена")
            });
            return;
        }

        try {
            await deletePremium(subscriber);
        } catch (err) {
            if((err as Error).name === "PREMIUM_ALRDYNTSUB") {
                msg.channel.send("", {
                    embed: generateEmbed(EmbedType.Information, "Пользователь уже не является премиальным подписчиком")
                });
            }
            return;
        }

        msg.channel.send("", {
            embed: generateEmbed(EmbedType.OK, "Премиальная подписка удалена")
        });
    }

    // ================================
    // MISC STUFF
    // ================================

    async performGuildsSync() {
        let guilds = {
            fs: discordBot.guilds.get("209767264210255883"),
            dnserv: discordBot.guilds.get("307494339662184449")
        };

        let roles = {
            dnserv: "313795444230848512",
            fs: "263636550426820608"
        };

        if(guilds.dnserv) {
            for (let m of guilds.dnserv.members.values()) {
                let isPremium = await isPremiumUser(m);
                if(!isPremium && m.roles.has(roles.dnserv)) {
                    await m.removeRole(roles.dnserv);
                } else if(isPremium && !m.roles.has(roles.dnserv)) {
                    await m.addRole(roles.dnserv);
                }
            }
        }

        if(guilds.fs) {
            for (let m of guilds.fs.members.values()) {
                let isPremium = await isPremiumUser(m);
                if(!isPremium && m.roles.has(roles.fs)) {
                    await m.removeRole(roles.fs);
                } else if(isPremium && !m.roles.has(roles.fs)) {
                    await m.addRole(roles.fs);
                }
            }
        }
    }

    // ================================
    // PLUGIN FUNCTIONS
    // ================================

    humanize(duration:number, largest:number = 2, round:boolean = true) {
        return humanizeDuration(duration, { language: "ru", largest, round: true });
    }

    intrvl:NodeJS.Timer;

    async init() {
        let subpluginInit = await init();
        if(!subpluginInit) {
            this.log("err", "Subplugin initalization failed");
            return;
        }
        this.intrvl = setInterval(() => this.performGuildsSync(), 3600000);
        this.handleEvents();
    }

    async unload() {
        clearInterval(this.intrvl);
        this.unhandleEvents();
        return true;
    }
}

module.exports = PremiumControl;