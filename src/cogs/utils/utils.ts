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

export function escapeDiscordMarkdown(str:string, usernames:boolean = false) {
    str = replaceAll(str, "`", "'");
    str = replaceAll(str, "*", "\\*");
    str = replaceAll(str, " _", " \\_");
    str = replaceAll(str, "_ ", "\\_ ");
    if(usernames) {
        str = replaceAll(str, "_", "\\_");
    }
    return str;
}

export enum EmbedType {
    Error,
    OK,
    Information,
    Empty
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
    fields?:Array<IEmbedOptionsField>;
    title?:string;
    errorTitle?:string;
    okTitle?:string;
    informationTitle?:string;
    imageUrl?:string;
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
        case EmbedType.Empty: break;
    }
    if(options) {
        if(options.title) {
            embed.title = options.title;
        }
        if(options.fields) {
            embed.fields = options.fields;
        }
        if(type === EmbedType.Error && options.errorTitle) {
            embed.author.name = options.errorTitle;
        } else if(type === EmbedType.Information && options.informationTitle) {
            embed.author.name = options.informationTitle;
        } else if(type === EmbedType.OK && options.okTitle) {
            embed.author.name = options.okTitle;
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
            embed.footer = {
                text: discordBot.user.username,
                icon_url: discordBot.user.displayAvatarURL
            };
        }
        if(options.imageUrl) {
            embed.image = {
                url: options.imageUrl
            };
        }
        if(options.color) {
            embed.color = options.color;
        }
    }
    return embed;
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