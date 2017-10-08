import { Message } from "discord.js";

export function messageToExtra(msg: Message, extra?: { [key: string]: any }) {
    let generatedExtra =  {
        guild: msg.guild,
        channel: msg.channel,
        user: msg.author,
        msgContent: msg.content,
        msgId: msg.id
    };
    if(extra) { generatedExtra = { ...generatedExtra, ...extra }; }
    return generatedExtra;
}