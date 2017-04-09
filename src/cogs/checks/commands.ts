import { Message } from "discord.js";
// import { IModule } from "../../types/ModuleLoader";

/**
 * Equality of command and content of message
 */
export enum CommandEquality {
    /**
     * Message content should be fully equal to command
     * @example "!ping" and "!ping" = OK
     * @example "!pong" and "!ping" = KO
     * @example "!ping this" and "!ping" = KO
     */
    Equal,
    /**
     * Message content can be fully equal to command or have arguments
     * @example "!ping" and "!ping" = OK
     * @example "!pong" and "!ping" = KO
     * @example "!ping this" and "!ping" = OK
     */
    SemiEqual,
    /**
     * Message content should have something behind command
     * @example "!ping" and "!ping" = KO
     * @example "!pong" and "!ping" = KO
     * @example "!ping this" and "!ping" = OK
     */
    NotEqual
}


/**
 * Command decorator
 * @param cmd {String} Command
 * @param eq {CommandEquality} Equality of command and content of message
 */
export function command(cmd:string, aliases?:string[], eq:CommandEquality = CommandEquality.Equal) {
    return (target, propertyKey: string, descriptor: TypedPropertyDescriptor<(msg: Message) => any>) => {
        if (typeof descriptor.value !== "function") {
            throw new SyntaxError("This only works for 'message' event handler");
        }

        return {
            ...descriptor,
            value: function commandWrapper(msg:Message) {
                if(!descriptor.value) { return; }
                if(!msg.content || msg.content.trim().length === 0) {
                    return;
                }
                if(aliases) {
                    aliases = aliases.concat(cmd);
                    for(let i = 0; i < aliases.length; i++) {
                        const alias = aliases[i];
                        if(!alias) { continue; }
                        if(eq === CommandEquality.Equal && msg.content !== alias) {
                            continue;
                        } else if(eq === CommandEquality.SemiEqual || eq === CommandEquality.NotEqual) {
                            if(!msg.content.startsWith(alias + " ") && msg.content !== alias) {
                                continue;
                            }
                        }
                    }
                    return;
                } else {
                    if(eq === CommandEquality.Equal && msg.content !== cmd) {
                        return;
                    } else if(eq === CommandEquality.SemiEqual || eq === CommandEquality.NotEqual) { 
                        if(!msg.content.startsWith(cmd + " ") && msg.content !== cmd) {
                            return;
                        }
                    }
                }
                
                return descriptor.value.apply(this, [msg]);
            }
        };
    };
};

/**
 * Message in channel
 * @param channelId {string} Channel where message should be sent
 */
export function inChannel(channelId:string) {
    return (target, propertyKey: string, descriptor: TypedPropertyDescriptor<(msg: Message) => Promise<void>>) => {
        if (typeof descriptor.value !== "function") {
            throw new SyntaxError("This only works for 'message' event handler");
        }

        return {
            ...descriptor,
            value: function commandWrapper(msg:Message) {
                if(!descriptor.value) { return; }
                if(msg.channel.id !== channelId) { return; }
                
                return descriptor.value.apply(this, [msg]);
            }
        };
    };
};

/**
 * Owner decorator
 * @example Use it only for command which can be accessed only but owner such as !shutdown, !restart and etc.
 */
export function isOwner(target, propertyKey: string, descriptor: TypedPropertyDescriptor<(msg: Message) => Promise<void>>) {
    if (typeof descriptor.value !== 'function') {
        throw new SyntaxError('This only works for events handlers');
    }

    return {
        ...descriptor,
        value: function commandWrapper(msg:Message) {
            if(!descriptor.value) { return; }
            if(!msg.author) { return; }
            if(msg.author.id !== botConfig.botOwner) { return; }
            
            return descriptor.value.apply(this, [msg]);
        }
    };
}

/**
 * Message should have author
 * @example Use it only to check if message sent from webhook or not
 */
export function shouldHaveAuthor(target, propertyKey: string, descriptor: TypedPropertyDescriptor<(msg: Message) => any>) {
    if (typeof descriptor.value !== 'function') {
        throw new SyntaxError('This only works for events handlers');
    }

    return {
        ...descriptor,
        value: function commandWrapper(msg:Message) {
            if(!descriptor.value) { return; }
            if(!msg.author) { return; }
            
            return descriptor.value.apply(this, [msg]);
        }
    };
}

/**
 * Message should be sent not by bot
 * @example Use it if you want to check if message sent not by bot
 */
export function notByBot(target, propertyKey: string, descriptor: TypedPropertyDescriptor<(msg: Message) => any>) {
    if (typeof descriptor.value !== 'function') {
        throw new SyntaxError('This only works for events handlers');
    }

    return {
        ...descriptor,
        value: function commandWrapper(msg:Message) {
            if(!descriptor.value) { return; }
            if(!msg.author) { return; }
            if(msg.author.bot) { return; }
            return descriptor.value.apply(this, [msg]);
        }
    };
}

// TODO: Command parsing decorator