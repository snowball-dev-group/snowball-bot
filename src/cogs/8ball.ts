import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js"; 
import * as Random from "random-js";
import { getLogger, generateEmbed, EmbedType, sleep } from "./utils/utils";
import { command, Category, IArgumentInfo } from "./utils/help";

const BALL_NAME = "Шар 8";
const BALL_THINKING = "Шар думает...";
const ICONS = {
    THINKING: "https://i.imgur.com/hIuSpIl.png",
    RESPONSE: "https://twemoji.maxcdn.com/72x72/1f3b1.png"
};


@command(Category.Fun, "8ball", "Магический шар 8.", new Map<string, IArgumentInfo>([
    ["question", {
        optional: false,
        description: "Вопрос, на который можно ответить только положительно или отрицательно."
    }]
]))
class Ball8 extends Plugin implements IModule {
    log = getLogger("8Ball");
    responses = {
        "affirmative": {
            color: 0x2196F3,
            variants: [
                "Бесспорно", "Предрешено", "Никаких сомнений",
                "Определённо да", "Можешь быть уверен в этом"
            ]
        },
        "non-committal": {
            color: 0x4CAF50,
            variants: [
                "Мне кажется — \"да\"", "Вероятнее всего", "Хорошие перспективы",
                "Знаки говорят — \"да\"", "Да"
            ]
        },
        "neutral": {
            color: 0xFFC107,
            variants: [
                "Пока не ясно, попробуй снова", "Спроси позже", "Лучше не рассказывать",
                "Сейчас нельзя предсказать", "Сконцентрируйся и спроси опять"
            ]
        },
        "negative": {
            color: 0xe53935,
            variants: [
                "Даже не думай", "Мой ответ — \"нет\"", "По моим данным — \"нет\"",
                "Перспективы не очень хорошие", "Весьма сомнительно"
            ]
        }
    };
    categories = Object.keys(this.responses);

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
        this.log("ok", "8Ball is loaded");
    }

    async onMessage(msg:Message) {
        if(!msg.content) { return; }
        if(!msg.content.startsWith("!8ball")) { return; }
        
        if(msg.content === "!8ball") {
            return;
        }

        let random = new Random(Random.engines.mt19937().autoSeed());

        let message:Message;
        try {
            message = await msg.channel.send("", {
                embed: generateEmbed(EmbedType.Empty, BALL_THINKING, {
                    author: {
                        icon_url: ICONS.THINKING,
                        name: BALL_NAME
                    },
                    clearFooter: true,
                    thumbUrl: ICONS.THINKING
                })
            }) as Message;
        } catch (err) {
            this.log("err", "Damn! 8Ball can't send message", err);
            return;
        }
        
        await sleep(random.integer(1500, 3000));

        let category = random.pick(this.categories);

        let answer = random.pick(this.responses[category].variants);

        try {
            await message.edit("", {
                embed: generateEmbed(EmbedType.Empty, answer, {
                    author: {
                        icon_url: ICONS.RESPONSE,
                        name: BALL_NAME
                    },
                    color: this.responses[category].color,
                    footer: {
                        text: "В ответ " + msg.member.displayName
                    },
                    thumbUrl: ICONS.RESPONSE
                })
            });
        } catch (err) {
            this.log("err", "Bummer! We can't update message, trying to delete our message", err);
            try { await message.delete(); } catch (err) { this.log("err", "Message also can't be removed...", err); }
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports =  Ball8;