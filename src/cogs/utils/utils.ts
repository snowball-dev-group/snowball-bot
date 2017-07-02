import * as createLogger from "loggy";
import { Guild } from "discord.js";
import { identify, localizeForUser } from "./ez-i18n";

export function stringifyError(err, filter = null, space = 2) {
    let plainObject = {};
    Object.getOwnPropertyNames(err).forEach(function(key) {
        plainObject[key] = err[key];
    });
    return JSON.stringify(plainObject, filter, space);
}

export function escapeRegExp(str:string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function colorNumberToHex(color) {
    let hex = color.toString(16);
    while (hex.length < 6) {
        hex = `0${hex}`;
    };
    return `${hex}`.toUpperCase();
}

export function replaceAll(str:string, search:string, replacement:string) {
    search = escapeRegExp(search);
    return str.replace(new RegExp(search, "g"), replacement);
};

export function objectToMap<T>(obj) {
    let map = new Map<string, T>();
    Object.keys(obj).forEach(key => {
        map.set(key, obj[key]);
    });
    return map;
}

export function commandRedirect(content:string, redirects:Map<string, Function>) {
    redirects.forEach((val, key) => {
        let keySpaced = `${key} `;
        let itsStarts = content.startsWith(keySpaced);
        if(itsStarts || content === key) {
            val(itsStarts ? content.slice(keySpaced.length) : content);
        }
    });
}

export function escapeDiscordMarkdown(str:string, usernames:boolean = false) {
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
    Question
}
// customFooter?:string

export interface IEmbedOptionsField {
    name:string;
    value:string;
    inline?:boolean;
}

export interface IEmbedOptions {
    footerText?:string;
    footer?:{
        text:string;
        icon_url?:string;
    };
    color?:number;
    author?:{
        name:string,
        icon_url?:string,
        url?:string
    };
    fields?:IEmbedOptionsField[];
    title?:string;
    errorTitle?:string;
    okTitle?:string;
    informationTitle?:string;
    tadaTitle?:string;
    progressTitle?:string;
    questionTitle?:string;
    imageUrl?:string;
    clearFooter?:boolean;
    thumbUrl?:string;
    ts?:Date;
}

export interface IEmbed {
    title?:string;
    description?:string;
    url?:string;
    timestamp:string|number;
    color?:number;
    footer?: {
        text:string;
        icon_url?:string;
    };
    image?: {
        url:string;
        height?:number;
        width?:number;
    };
    thumbnail?:{
        url:string;
        height?:number;
        width?:number;
    };
    video?:{
        url:string;
        height?:number;
        width?:number;
    };
    provider:{
        name:string;
        url?:string;
    };
    author?: {
        icon_url?:string;
        name:string;
        url?:string;
    };
    fields?:IEmbedOptionsField[];
}

interface ILocalizedEmbedString {
    key:string;
    formatOptions:any;
}

interface ICustomString {
    custom:boolean;
    string:string;
}

function isCustomString(object: any): object is ICustomString {
    return "custom" in object;
}

export async function generateLocalizedEmbed(type:EmbedType, user:identify, descriptionKey:string|ILocalizedEmbedString|ICustomString, options:IEmbedOptions = {}) {
    // EMBED_ERROR
    // EMBED_INFORMATION
    // EMBED_SUCCESS
    // EMBED_TADA
    // EMBED_PROGRESS
    // EMBED_QUESTION
    switch(type) {
        case EmbedType.Error: {
            if(options.errorTitle) { break; }
            options.errorTitle = await localizeForUser(user, "EMBED_ERROR");
        } break;
        case EmbedType.Information: {
            if(options.informationTitle) { break; }
            options.informationTitle = await localizeForUser(user, "EMBED_INFORMATION");
        } break;
        case EmbedType.OK: {
            if(options.okTitle) { break; }
            options.okTitle = await localizeForUser(user, "EMBED_SUCCESS");
        } break;
        case EmbedType.Tada: {
            if(options.tadaTitle) { break; }
            options.tadaTitle = await localizeForUser(user, "EMBED_TADA");
        } break;
        case EmbedType.Progress: {
            if(options.progressTitle) { break; }
            options.progressTitle = await localizeForUser(user, "EMBED_PROGRESS");
        } break;
        case EmbedType.Question: {
            if(options.questionTitle) { break; }
            options.questionTitle = await localizeForUser(user, "EMBED_QUESTION");
        } break;
    }
    if(typeof descriptionKey === "string" && descriptionKey.startsWith("custom:")) {
        descriptionKey = descriptionKey.slice("custom:".length);
        return generateEmbed(type, descriptionKey, options);
    } else {
        if(typeof descriptionKey === "string") {
            return generateEmbed(type, await localizeForUser(user, descriptionKey), options);
        } else {
            if(isCustomString(descriptionKey)) {
                return generateEmbed(type, descriptionKey.string, options);
            } else {
                return generateEmbed(type, await localizeForUser(user, descriptionKey.key, descriptionKey.formatOptions), options);
            }
        }
    }
}

export function generateEmbed(type:EmbedType, description:string, options?:IEmbedOptions) {
    let embed:any = {};
    // embed pre-fill 
    embed.author = {};
    embed.description = description;
    switch(type) {
        case EmbedType.Error: {
            embed.author.name = "Ошибка";
            embed.author.icon_url = "https://i.imgur.com/9IwsjHS.png";
            embed.color = 0xe53935;
        } break;
        case EmbedType.Information: {
            embed.author.name = "Информация";
            embed.author.icon_url = "https://i.imgur.com/cztrSSi.png";
            embed.color = 0x2196F3;
        } break;
        case EmbedType.OK: {
            embed.author.name = "Успех!";
            embed.author.icon_url = "https://i.imgur.com/FcnCpHL.png";
            embed.color = 0x43A047;
        } break;
        case EmbedType.Tada: {
            embed.author.name = "Та-да!";
            embed.author.icon_url = "https://i.imgur.com/FcnCpHL.png";
            embed.thumbnail = {
                url: "https://i.imgur.com/EkYEqfC.png"
            };
        } break;
        case EmbedType.Progress: {
            embed.author.name = "Загрузка...";
            embed.author.icon_url = "https://i.imgur.com/Lb04Jg0.gif";
            embed.color = 0x546E7A;
        } break;
        case EmbedType.Question: {
            embed.author.name = "Подтверждение...";
            embed.author.icon_url = "https://i.imgur.com/CFzVpVt.png";
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
            if(type !== EmbedType.Empty){
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
    (type:"log"|"info"|"ok"|"warn"|"err"|"error"|"warning"|"trace"|"info_trace"|"warn_trace"|"err_trace", arg, ...args:any[]):ILogger;
}

export interface ILogger {
    name:string;
    log:ILoggerFunction;
}

export function getLogger(name:string):ILoggerFunction {
    if(!name) { throw new Error("No logger name provided"); }
    return createLogger(name);
}

export function resolveGuildRole(nameOrID:string, guild:Guild, strict=true) {
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

export function resolveGuildChannel(nameOrID:string, guild:Guild, strict=true) {
    if(/[0-9]+/.test(nameOrID)) {
        let ch = guild.channels.get(nameOrID);
        if(ch) { return ch; }
    }

    return guild.channels.find((vc) => {
        if(strict) { return vc.name === nameOrID; }
        else { return vc.name.includes(nameOrID); }
    });
}

export function sleep<T>(delay: number=1000, value?: T): Promise<T> {
  return new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(value);
      }, delay);
  });
}