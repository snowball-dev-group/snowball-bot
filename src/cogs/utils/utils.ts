import * as createLogger from "loggy";

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

export function replaceAll(str:string, search:string, replacement:string) {
    search = escapeRegExp(search);
    return str.replace(new RegExp(search, 'g'), replacement);
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

export function escapeDiscordMarkdown(str:string) {
    str = replaceAll(str, "`", "'");
    str = replaceAll(str, "*", "\\*");
    str = replaceAll(str, " _", " \\_");
    str = replaceAll(str, "_ ", "\\_ ");
    return str;
}

export enum EmbedType {
    Error,
    OK,
    Custom
}
// customFooter?:string

export interface IEmbedOptionsField {
    name:string;
    value:string;
    inline?:boolean;
}

export interface IEmbedOptions {
    customFooter?:string;
    customColor?:string;
    customAuthor?:{
        name:string,
        icon_url?:string,
        url?:string
    };
    fields?:Array<IEmbedOptionsField>;
}

export function generateEmbed(type:EmbedType, description:string, imageUrl?:string, options?:IEmbedOptions) {
    return {
        description: description,
        image: imageUrl ? {
            url: imageUrl
        } : undefined,
        color: type === EmbedType.Error ? 0xe53935 : type === EmbedType.OK ? 0x43A047 : options ? options.customColor : undefined,
        author: type === EmbedType.Error ? {
            name: "Ошибка",
            icon_url: "https://i.imgur.com/9IwsjHS.png"
        } : type === EmbedType.OK ? {
            name: "Успех!",
            icon_url: "https://i.imgur.com/FcnCpHL.png"
        } : (options && options.customAuthor) ? options.customAuthor : undefined,
        footer: options && options.customFooter ? {
            text: options.customFooter
        } : {
            text: discordBot.user.username
        }
    };
}

interface ILoggerFunction {
    (type:"log"|"info"|"ok"|"warn"|"err"|"error"|"warning"|"trace"|"info_trace"|"warn_trace"|"err_trace", arg, ...args:any[]):ILogger;
}

interface ILogger {
    name:string;
    log:ILoggerFunction;
}

export function getLogger(name:string):ILoggerFunction {
    if(!name) { throw new Error("No logger name provided"); }
    return createLogger(name);
}