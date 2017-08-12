import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, GuildMember, User } from "discord.js";
import * as Random from "random-js";
import { getLogger, EmbedType, sleep } from "./utils/utils";
import { command, Category } from "./utils/help";
import { generateLocalizedEmbed, localizeForUser } from "./utils/ez-i18n";

const ICONS = {
    THINKING: "https://i.imgur.com/hIuSpIl.png",
    RESPONSE: "https://twemoji.maxcdn.com/72x72/1f3b1.png"
};


@command(Category.Fun, "8ball", "loc:8BALL_META_DEFAULT", {
    "loc:8BALL_META_DEFAULT_ARG0": {
        optional: false,
        description: "loc:8BALL_META_DEFAULT_ARG0_DESC"
    }
})
class Ball8 extends Plugin implements IModule {
    log = getLogger("8Ball");
    responses = {
        "affirmative": {
            color: 0x2196F3,
            variants: [
                "8BALL_ANSWER_CERTAIN", "8BALL_ANSWER_DECIDEDLY", "8BALL_ANSWER_WODOUBT",
                "8BALL_ANSWER_DEFINITELY", "8BALL_ANSWER_RELY"
            ]
        },
        "non-committal": {
            color: 0x4CAF50,
            variants: [
                "8BALL_ANSWER_NC_PROB", "8BALL_ANSWER_NC_MOSTLIKELY", "8BALL_ANSWER_NC_OUTLOOK",
                "8BALL_ANSWER_NC_SIGNS", "8BALL_ANSWER_NC_YES"
            ]
        },
        "neutral": {
            color: 0xFFC107,
            variants: [
                "8BALL_ANSWER_NEUTRAL_HAZY", "8BALL_ANSWER_NEUTRAL_LATER", "8BALL_ANSWER_NEUTRAL_NOT",
                "8BALL_ANSWER_NEUTRAL_CANTPREDICT", "8BALL_ANSWER_NEUTRAL_CONCENTRATE"
            ]
        },
        "negative": {
            color: 0xe53935,
            variants: [
                "8BALL_ANSWER_NEGATIVE_DONT", "8BALL_ANSWER_NEGATIVE_MYREPLY", "8BALL_ANSWER_NEGATIVE_SOURCES",
                "8BALL_ANSWER_NEGATIVE_OUTLOOK", "8BALL_ANSWER_NEGATIVE_DOUBTFUL"
            ]
        }
    };
    categories = Object.keys(this.responses);

    constructor() {
        super({
            "message": (msg: Message) => this.onMessage(msg)
        });
        this.log("ok", "8Ball is loaded");
    }

    async onMessage(msg: Message) {
        if(!msg.content) { return; }
        if(!msg.content.startsWith("!8ball")) { return; }

        if(msg.content === "!8ball") {
            return;
        }

        let u = msg.member || msg.author;

        let random = new Random(Random.engines.mt19937().autoSeed());

        let localName = await localizeForUser(u, "8BALL_NAME");

        let message: Message;
        try {
            message = (await msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Empty, u, "8BALL_THINKING", {
                    author: {
                        name: localName,
                        icon_url: ICONS.THINKING
                    },
                    thumbUrl: ICONS.THINKING,
                    thumbWidth: 64,
                    thumbHeight: 64,
                    clearFooter: true
                })
            })) as Message;
        } catch(err) {
            this.log("err", "Damn! 8Ball can't send message", err);
            return;
        }

        await sleep(random.integer(1500, 3000));

        let category = random.pick<string>(this.categories);

        let answer = random.pick<string>(this.responses[category].variants);

        try {
            await message.edit("", {
                embed: await generateLocalizedEmbed(EmbedType.Empty, u, answer, {
                    author: {
                        icon_url: ICONS.RESPONSE,
                        name: localName
                    },
                    color: this.responses[category].color,
                    footerText: await localizeForUser(u, "8BALL_INREPLY", {
                        username: u instanceof GuildMember ? u.displayName : (u as User).username
                    }),
                    thumbUrl: ICONS.RESPONSE,
                    thumbWidth: 64,
                    thumbHeight: 64
                })
            });
        } catch(err) {
            this.log("err", "Bummer! We can't update message, trying to delete our message", err);
            try { await message.delete(); } catch(err) { this.log("err", "Message also can't be removed...", err); }
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = Ball8;