import * as createLogger from "loggy";
import { Guild } from "discord.js";
import { replaceAll } from "./text";

export function stringifyError(err, filter = null, space = 2) {
    let plainObject = {};
    Object.getOwnPropertyNames(err).forEach(function (key) {
        plainObject[key] = err[key];
    });
    return JSON.stringify(plainObject, filter, space);
}

export function colorNumberToHex(color) {
    let hex = color.toString(16);
    while(hex.length < 6) {
        hex = `0${hex}`;
    };
    return `${hex}`.toUpperCase();
}

export function objectToMap<T>(obj) {
    let map = new Map<string, T>();
    Object.keys(obj).forEach(key => {
        map.set(key, obj[key]);
    });
    return map;
}

export function commandRedirect(content: string, redirects: Map<string, Function>) {
    redirects.forEach((val, key) => {
        let keySpaced = `${key} `;
        let itsStarts = content.startsWith(keySpaced);
        if(itsStarts || content === key) {
            val(itsStarts ? content.slice(keySpaced.length) : content);
        }
    });
}

export function escapeDiscordMarkdown(str: string, usernames: boolean = false) {
    str = replaceAll(str, "`", "'");
    str = replaceAll(str, "*", "\\*");
    str = replaceAll(str, "[", "\\[");
    str = replaceAll(str, "]", "\\]");

    if(usernames) {
        str = replaceAll(str, "_", "\\_");
    } else {
        str = replaceAll(str, " _", " \\_");
        str = replaceAll(str, "_ ", "\\_ ");
    }
    return str;
}

export enum EmbedType {
    Error,
    OK,
    Information,
    Progress,
    Empty,
    Tada,
    Question,
    Warning
}
// customFooter?:string

export interface IEmbedOptionsField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface IEmbedOptions {
    footerText?: string;
    footer?: {
        text: string;
        icon_url?: string;
    };
    color?: number;
    author?: {
        name: string,
        icon_url?: string,
        url?: string
    };
    fields?: IEmbedOptionsField[];
    title?: string;
    errorTitle?: string;
    okTitle?: string;
    informationTitle?: string;
    tadaTitle?: string;
    progressTitle?: string;
    questionTitle?: string;
    warningTitle?: string;
    imageUrl?: string;
    clearFooter?: boolean;
    thumbUrl?: string;
    thumbWidth?: number;
    thumbHeight?: number;
    ts?: Date;
}

export interface IEmbed {
    title?: string;
    description?: string;
    url?: string;
    timestamp?: string | number;
    color?: number;
    footer?: {
        text: string;
        icon_url?: string;
    };
    image?: {
        url: string;
        height?: number;
        width?: number;
    };
    thumbnail?: {
        url: string;
        height?: number;
        width?: number;
    };
    video?: {
        url: string;
        height?: number;
        width?: number;
    };
    provider?: {
        name: string;
        url?: string;
    };
    author?: {
        icon_url?: string;
        name: string;
        url?: string;
    };
    fields?: IEmbedOptionsField[];
}

export const ICONS = {
    ERROR: "https://i.imgur.com/9IwsjHS.png",
    INFO: "https://i.imgur.com/cztrSSi.png",
    OK: "https://i.imgur.com/FcnCpHL.png",
    PROGRESS: "https://i.imgur.com/Lb04Jg0.gif",
    CONFIRMATION: "https://i.imgur.com/CFzVpVt.png",
    WARNING: "https://i.imgur.com/Lhq89ac.png",
    TADA: "https://i.imgur.com/EkYEqfC.png"
};

export const COLORS = {
    ERROR: 0xe53935,
    INFO: 0x2196F3,
    OK: 0x43A047,
    PROGRESS: 0x546E7A,
    CONFIRMATION: 0x4DB6AC,
    WARNING: 0xFF9800
};

export function generateEmbed(type: EmbedType, description: string, options?: IEmbedOptions) {
    let embed: any = {};
    // embed pre-fill 
    embed.author = {};
    embed.description = description;
    switch(type) {
        case EmbedType.Error: {
            embed.author.name = "Ошибка";
            embed.author.icon_url = ICONS.ERROR;
            embed.color = COLORS.ERROR;
        } break;
        case EmbedType.Information: {
            embed.author.name = "Информация";
            embed.author.icon_url = ICONS.INFO;
            embed.color = COLORS.INFO;
        } break;
        case EmbedType.OK: {
            embed.author.name = "Успех!";
            embed.author.icon_url = ICONS.OK;
            embed.color = COLORS.OK;
        } break;
        case EmbedType.Tada: {
            embed.author.name = "Та-да!";
            embed.author.icon_url = ICONS.OK;
            embed.thumbnail = {
                url: ICONS.TADA
            };
            embed.color = COLORS.OK;
        } break;
        case EmbedType.Progress: {
            embed.author.name = "Загрузка...";
            embed.author.icon_url = ICONS.PROGRESS;
            embed.color = COLORS.PROGRESS;
        } break;
        case EmbedType.Question: {
            embed.author.name = "Подтверждение...";
            embed.author.icon_url = ICONS.CONFIRMATION;
            embed.color = COLORS.CONFIRMATION;
        } break;
        case EmbedType.Warning: {
            embed.author.name = "Предупреждение!";
            embed.author.icon_url = ICONS.WARNING;
            embed.thumbnail = {
                url: ICONS.WARNING
            };
            embed.colors = COLORS.WARNING;
        } break;
        case EmbedType.Empty: break;
    }
    if(options) {
        if(options.title) {
            embed.title = options.title;
        }
        if(options.fields) {
            embed.fields = options.fields;
        }
        // that's fine
        if(type === EmbedType.Error && options.errorTitle) {
            embed.author.name = options.errorTitle;
        } else if(type === EmbedType.Information && options.informationTitle) {
            embed.author.name = options.informationTitle;
        } else if(type === EmbedType.OK && options.okTitle) {
            embed.author.name = options.okTitle;
        } else if(type === EmbedType.Tada && options.tadaTitle) {
            embed.author.name = options.tadaTitle;
        } else if(type === EmbedType.Progress && options.progressTitle) {
            embed.author.name = options.progressTitle;
        } else if(type === EmbedType.Question && options.questionTitle) {
            embed.author.name = options.questionTitle;
        } else if(type === EmbedType.Warning && options.warningTitle) {
            embed.author.name = options.warningTitle;
        }
        if(options.author) {
            // full override
            embed.author = options.author;
        }
        if(options.footer) {
            embed.footer = options.footer;
            if(options.footerText) {
                embed.footer.text = options.footerText;
            }
        } else if(options.footerText) {
            embed.footer = {
                text: options.footerText
            };
        } else {
            if(type !== EmbedType.Empty) {
                embed.footer = {
                    text: discordBot.user.username,
                    icon_url: discordBot.user.displayAvatarURL
                };
            }
        }
        if(options.clearFooter) {
            embed.footer = undefined;
        }
        if(options.imageUrl) {
            embed.image = {
                url: options.imageUrl
            };
        }
        if(options.thumbUrl) {
            embed.thumbnail = {
                url: options.thumbUrl
            };
            if(options.thumbWidth && options.thumbWidth > 0) {
                embed.thumbnail.width = options.thumbWidth;
            }
            if(options.thumbHeight && options.thumbHeight > 0) {
                embed.thumbnail.height = options.thumbHeight;
            }
        }
        if(options.color) {
            embed.color = options.color;
        }
        if(options.ts) {
            embed.timestamp = options.ts.toISOString();
        }
    }
    return embed;
}

export interface ILoggerFunction {
    (type: "log" | "info" | "ok" | "warn" | "err" | "error" | "warning" | "trace" | "info_trace" | "warn_trace" | "err_trace", arg, ...args: any[]): ILogger;
}

export interface ILogger {
    name: string;
    log: ILoggerFunction;
}

export function getLogger(name: string): ILoggerFunction {
    if(!name) { throw new Error("No logger name provided"); }
    return createLogger(name);
}

export function resolveGuildRole(nameOrID: string, guild: Guild, strict = true) {
    if(/[0-9]+/.test(nameOrID)) {
        // it's can be ID
        let role = guild.roles.get(nameOrID);
        if(role) { return role; }
    }
    // going to search
    return guild.roles.find((role) => {
        if(strict) { return role.name === nameOrID; }
        else { return role.name.includes(nameOrID); }
    }); // it can return undefined, it's okay
}

export function resolveGuildChannel(nameOrID: string, guild: Guild, strict = true) {
    if(/[0-9]+/.test(nameOrID)) {
        let ch = guild.channels.get(nameOrID);
        if(ch) { return ch; }
    }

    return guild.channels.find((vc) => {
        if(strict) { return vc.name === nameOrID; }
        else { return vc.name.includes(nameOrID); }
    });
}

export function sleep<T>(delay: number = 1000, value?: T): Promise<T> {
    return new Promise<T>((resolve) => {
        setTimeout(() => {
            resolve(value);
        }, delay);
    });
}