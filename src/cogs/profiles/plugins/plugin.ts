import { IModule } from "../../../types/ModuleLoader";
import { IEmbedOptionsField } from "../../utils/utils";
import { Message, GuildMember } from "discord.js";

export interface IAddedProfilePlugin {
    json: string,
    example: IEmbedOptionsField
};

export interface IProfilesPlugin extends IModule {
    name:string;
    getEmbed(info) : Promise<IEmbedOptionsField>;
    setup(args:string, member:GuildMember, message:Message) : Promise <IAddedProfilePlugin>
}