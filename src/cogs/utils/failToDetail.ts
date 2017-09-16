import { Message } from "discord.js";

export function messageToExtra(msg: Message, extra?: { [key: string]: any }) {
    let generatedExtra =  {
        guildId: msg.guild ? msg.guild : undefined,
        channelId: msg.channel.type === "dm" ? "DM" : msg.channel.id,
        userId: msg.author.id, content: msg.content,
    };
    if(extra) { generatedExtra = { ...generatedExtra, ...extra }; }
    return generatedExtra;
}