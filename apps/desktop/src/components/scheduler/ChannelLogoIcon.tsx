import type { IconType } from "react-icons";
import { SiFacebook, SiInstagram, SiNaver, SiThreads, SiYoutube } from "react-icons/si";

type ChannelLogoIconProps = {
  channel: string;
  size?: number;
};

type ChannelIconMeta = {
  icon: IconType;
  title: string;
};

const CHANNEL_ICON: Record<string, ChannelIconMeta> = {
  instagram: {
    icon: SiInstagram,
    title: "Instagram"
  },
  threads: {
    icon: SiThreads,
    title: "Threads"
  },
  naver_blog: {
    icon: SiNaver,
    title: "Naver Blog"
  },
  youtube: {
    icon: SiYoutube,
    title: "YouTube"
  },
  facebook: {
    icon: SiFacebook,
    title: "Facebook"
  }
};

/**
 * Render service logo icon by scheduler channel key.
 */
export const ChannelLogoIcon = ({ channel, size = 13 }: ChannelLogoIconProps) => {
  const normalized = channel.trim().toLowerCase();
  const meta = CHANNEL_ICON[normalized];
  if (!meta) {
    return <span className="ui-channel-logo-fallback">?</span>;
  }

  const Icon = meta.icon;
  return <Icon size={size} title={meta.title} aria-hidden="true" focusable={false} />;
};
