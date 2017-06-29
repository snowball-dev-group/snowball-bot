import { IModule } from "../../../types/ModuleLoader";
import { IEmbedOptionsField } from "../../utils/utils";
import { Message, GuildMember } from "discord.js";

export enum AddedProfilePluginType {
    Embed,
    Customs
}

export interface ICustoms {
    image_url?:string;
    thumbnail_url?:string;
}

export interface IAddedProfilePlugin {
    json: string;
    type: AddedProfilePluginType;
};

export interface IProfilesPlugin extends IModule {
    getCustoms?(info, caller:GuildMember): Promise<ICustoms>;
    getEmbed?(info, caller:GuildMember) : Promise<IEmbedOptionsField>;
    setup(args:string, member?:GuildMember, message?:Message) : Promise <IAddedProfilePlugin>;
    getSetupArgs(caller:GuildMember): Promise<string|null>;
}