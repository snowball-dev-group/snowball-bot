import { IModule } from "../../../types/ModuleLoader";
import { IEmbedOptionsField } from "../../utils/utils";
import { Message, GuildMember } from "discord.js";
import { default as ProfilesModule } from "../profiles";

export enum AddedProfilePluginType {
	Embed,
	Customs
}

export interface ICustoms {
	image_url?: string;
	thumbnail_url?: string;
}

export interface IAddedProfilePlugin {
	json: string;
	type: AddedProfilePluginType;
}

export interface IProfilesPlugin extends IModule {
	getCustoms?(info, caller: GuildMember, profilesModule: ProfilesModule): Promise<ICustoms>;
	getEmbed?(info, caller: GuildMember, profilesModule: ProfilesModule): Promise<IEmbedOptionsField>;
	setup(args: string, member: GuildMember, message: Message, profilesModule: ProfilesModule): Promise<IAddedProfilePlugin>;
	getSetupArgs(caller: GuildMember): Promise<string | null>;
}
